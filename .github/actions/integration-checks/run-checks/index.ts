import { exec } from "@actions/exec";
import path from "node:path";
import fs from "node:fs";
import { info, getInput, setFailed, setOutput } from "@actions/core";
import * as yaml from "js-yaml";
import frontendsConfig from "./frontends.json";

const gitUser = "srebot";

async function checkout({
  checkoutToken,
  repository,
  version,
  directory,
}: {
  checkoutToken: string;
  repository: string;
  version: string;
  directory: string;
}) {
  const tagArgs = version ? [`--branch=v${version}`] : [];

  const repo = `https://${gitUser}:${checkoutToken}@github.com/${repository}.git`;

  info(`Checking out ${repo} ${tagArgs[0] ?? ""}`);
  await exec("git", ["clone", "--depth=1", ...tagArgs, repo, directory]);
}

async function install({ directory }: { directory: string }) {
  info("Installing deps...");
  await exec("yarn", undefined, {
    cwd: directory,
  });
}

function setApiClientResolution({
  apiClientPath,
  directory,
}: {
  directory: string;
  apiClientPath: string;
}) {
  const packageJson = JSON.parse(
    fs.readFileSync(`${directory}/package.json`, "utf-8")
  );
  if (!packageJson.resolutions) {
    packageJson.resolutions = {};
  }
  packageJson.resolutions["@chilipiper/api-client"] = apiClientPath;
  fs.writeFileSync(
    `${directory}/package.json`,
    JSON.stringify(packageJson, null, 2)
  );
}

async function installApiClient({
  apiClientPath,
  directory,
  isMonoRepo,
}: {
  directory: string;
  apiClientPath: string;
  isMonoRepo: boolean;
}) {
  if (isMonoRepo) {
    const localApiClientPath = `${directory}/frontend-packages/api-client`;
    info(`Copying api-client from ${apiClientPath}`);
    const packageJson = fs.readFileSync(
      `${localApiClientPath}/package.json`,
      "utf-8"
    );
    fs.rmSync(localApiClientPath, { recursive: true, force: true });
    fs.cpSync(apiClientPath, localApiClientPath, { recursive: true });
    fs.writeFileSync(`${localApiClientPath}/package.json`, packageJson);
    return;
  }
  info(`Linking api-client ${apiClientPath}`);
  setApiClientResolution({ directory, apiClientPath });
  await exec(`yarn add @chilipiper/api-client@${apiClientPath}`, undefined, {
    cwd: directory,
  });
}

function runChecks({
  command,
  directory,
}: {
  command: string;
  directory: string;
}) {
  info(`Running type checks with command ${command}`);
  return exec(command, undefined, {
    cwd: directory,
    ignoreReturnCode: true,
  });
}

function disableMocksDirCheck({ apiClientPath }: { apiClientPath: string }) {
  const tsConfig = JSON.parse(
    fs.readFileSync(`${apiClientPath}/tsconfig.json`, "utf-8")
  );
  if (!tsConfig.exclude) {
    tsConfig.exclude = [];
  }
  tsConfig.exclude.push("mocks");
  fs.writeFileSync(
    `${apiClientPath}/tsconfig.json`,
    JSON.stringify(tsConfig, null, 2)
  );
}

async function run() {
  try {
    const frontendVersionsJSON = getInput("frontend");
    const frontendVersions = (yaml.load(frontendVersionsJSON) ?? {}) as Record<
      string,
      string
    >;
    const checkoutToken = getInput("checkout_token");
    const apiClientPath = getInput("api_client_path");
    const frontendsKeys = Object.keys(frontendsConfig) as Array<
      keyof typeof frontendsConfig
    >;

    const failedFrontends = new Set<string>();

    await disableMocksDirCheck({ apiClientPath });

    for (const frontendKey of frontendsKeys) {
      const frontend = frontendsConfig[frontendKey];
      await checkout({
        checkoutToken,
        directory: frontendKey,
        repository: frontend.repository,
        version: frontendVersions[frontendKey],
      });
      await installApiClient({
        apiClientPath,
        directory: frontendKey,
        isMonoRepo: frontend.repository === "Chili-Piper/frontend",
      });
      await install({ directory: frontendKey });

      for (const command of frontend.commands) {
        const exitCode = await runChecks({
          command: command.exec,
          directory: command.directory,
        });

        if (exitCode !== 0) {
          failedFrontends.add(frontendKey);
        }
      }
    }

    if (failedFrontends.size > 0) {
      setOutput(
        "failed_frontends",
        JSON.stringify(Array.from(failedFrontends))
      );
      setFailed(
        `Failed frontends: [${Array.from(failedFrontends).join(", ")}]`
      );
      return;
    }
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
