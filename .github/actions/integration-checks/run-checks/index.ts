import { exec } from "@actions/exec";
import path from "node:path";
import fs from "node:fs";
import glob from "glob";
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

const includePatterns = [
  "**/node_modules/**/*", // Include all node_modules
  ".yarn/cache/**/*", // Include yarn cache
];
const excludePatterns = [
  "**/node_modules/.cache/turbo/**/*", // Exclude turbo cache
];

function copyCacheDeps(src: string, dest: string) {
  try {
    // Process include patterns
    for (const pattern of includePatterns) {
      const matches = glob.sync(pattern, {
        cwd: src,
        dot: true,
        nodir: true,
      });

      for (const match of matches) {
        const sourcePath = path.join(src, match);
        const destPath = path.join(dest, match);

        // Check if the file matches any exclude pattern
        const isExcluded = excludePatterns.some((excludePattern) =>
          glob.sync(excludePattern, { cwd: src, dot: true }).includes(match)
        );

        if (!isExcluded) {
          fs.cpSync(sourcePath, destPath, { recursive: true, force: true });
        }
      }
    }
  } catch (error) {
    setFailed(`Error during copy operation: ${error}`);
  }
}

async function install({
  directory,
  apiClientRepoPath,
}: {
  apiClientRepoPath: string;
  directory: string;
}) {
  const localApiClientPath = `${directory}/frontend-packages/api-client`;
  if (fs.existsSync(localApiClientPath)) {
    copyCacheDeps(apiClientRepoPath, directory);
  }

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
  const localApiClientPath = `${directory}/frontend-packages/api-client`;
  if (fs.existsSync(localApiClientPath)) {
    fs.rmSync(localApiClientPath, { recursive: true, force: true });
    fs.cpSync(apiClientPath, localApiClientPath, { recursive: true });
    return;
  }
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
    const apiClientRepoPath = getInput("api_client_repo_path");
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
      await install({ directory: frontendKey, apiClientRepoPath });
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
