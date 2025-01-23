import { exec } from "@actions/exec";
import path from "node:path";
import { info, getInput, setFailed } from "@actions/core";
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

  await exec("git", ["clone", "--depth=1", ...tagArgs, repo, directory]);
}

async function install(directory: string) {
  await exec("yarn", undefined, {
    cwd: directory,
    failOnStdErr: true,
  });
}

async function installApiClient({
  apiClientPath,
  directory,
}: {
  directory: string;
  apiClientPath: string;
}) {
  await exec(`yarn add @chilipiper/api-client@${apiClientPath}`, undefined, {
    cwd: directory,
    failOnStdErr: true,
  });
}

function runChecks({
  command,
  directory,
}: {
  command: string;
  directory: string;
}) {
  return exec(command, undefined, {
    cwd: directory,
  });
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

    const failedFrontends: Array<string> = [];

    for (const frontendKey of frontendsKeys) {
      const frontend = frontendsConfig[frontendKey];
      await checkout({
        checkoutToken,
        directory: frontendKey,
        repository: frontend.repository,
        version: frontendVersions[frontendKey],
      });
      await install(frontendKey);
      await installApiClient({ apiClientPath, directory: frontendKey });
      const exitCode = await runChecks({
        command: frontend.command,
        directory: path.join(frontendKey, frontend.directory),
      });

      if (exitCode !== 0) {
        failedFrontends.push(frontendKey);
      }
    }

    if (failedFrontends.length > 0) {
      setFailed(`Failed frontends: [${failedFrontends.join(", ")}]`);
      return;
    }
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
