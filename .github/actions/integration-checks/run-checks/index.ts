import { exec } from "@actions/exec";
import { info, getInput, setFailed } from "@actions/core";
import * as yaml from "js-yaml";
import frontendsConfig from "./frontends.json";

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

  await exec("git", ["clone", "--depth=1", ...tagArgs, repository, directory], {
    failOnStdErr: true,
    errStream: process.stderr,
    env: {
      GIT_AUTH_TOKEN: checkoutToken,
    },
  });
  await exec(`cd ${directory}`, undefined, {
    failOnStdErr: true,
    errStream: process.stderr,
  });
}

async function install() {
  await exec("yarn", undefined, {
    failOnStdErr: true,
    errStream: process.stderr,
  });
}

async function installApiClient(apiClientPath: string) {
  await exec(`yarn add @chilipiper/api-client@${apiClientPath}`, undefined, {
    failOnStdErr: true,
    errStream: process.stderr,
  });
}

function runChecks(command: string) {
  return exec(command, undefined, {
    failOnStdErr: false,
    errStream: process.stderr,
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
      await install();
      await installApiClient(apiClientPath);
      const exitCode = await runChecks(frontend.command);

      if (exitCode !== 0) {
        failedFrontends.push(frontendKey);
      }
    }

    if (failedFrontends.length > 0) {
      setFailed(`Failed frontends: [${failedFrontends.join(", ")}]`);
      return
    }
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
