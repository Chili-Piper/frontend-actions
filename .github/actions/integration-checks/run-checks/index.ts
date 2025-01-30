import { exec } from "@actions/exec";
import JSON5 from "json5";
import path from "node:path";
import fs from "node:fs";
import { info, getInput, setFailed, setOutput } from "@actions/core";
import * as yaml from "js-yaml";
import {
  Timer,
  monoRepo,
  pickShardedFrontends,
  restoreNonMonoRepoCache,
  restoreTypescriptCache,
} from "./shared";
import frontendsConfig from "./frontends.json";

const gitUser = "srebot";
const apiClientSubDir = "frontend-packages/api-client";
const turboTeam = getInput("turbo_team");
const turboToken = getInput("turbo_token");

process.env.NODE_OPTIONS = "--max_old_space_size=6291";

// hardcoded. we are not using it for security reasons but instead for cache isolation
const TURBO_REMOTE_CACHE_SIGNATURE_KEY =
  "b6d61a99d783570abb966e86694217da9ba00901b47dfcf531c2b4e6eb8efced";

async function prefetchMonoRepoTags({
  versions,
  directory,
}: {
  versions: string[];
  directory: string;
}) {
  const dedupedVersions = [...new Set(versions)];
  const tags = dedupedVersions.flatMap((version) => ["tag", `v${version}`]);
  await exec("git", ["fetch", "--no-tags", "origin", ...tags, "--quiet"], {
    cwd: directory,
  });
}

async function checkout({
  checkoutToken,
  repository,
  version,
  directory,
}: {
  checkoutToken: string;
  repository: string;
  version?: string;
  directory: string;
}) {
  if (fs.existsSync(directory)) {
    if (version) {
      await exec("git", ["checkout", "-f", `v${version}`], {
        cwd: directory,
      });
      return;
    }

    await exec("git", ["checkout", "-f", "master"], {
      cwd: directory,
    });
    return;
  }

  const tagArgs = version ? [`--branch=v${version}`] : [];

  const repo = `https://${gitUser}:${checkoutToken}@github.com/${repository}.git`;

  info(`Checking out ${repo} ${tagArgs[0] ?? ""}`);
  await exec("git", ["clone", "--depth=1", ...tagArgs, repo, directory]);
}

function editJSON(path: string, cb: (data: any) => void) {
  const fileContent = fs.readFileSync(path, "utf-8");
  const data = JSON5.parse(fileContent);
  cb(data);
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function setApiClientResolution({
  apiClientPath,
  directory,
}: {
  directory: string;
  apiClientPath: string;
}) {
  editJSON(`${directory}/package.json`, (packageJson) => {
    if (!packageJson.resolutions) {
      packageJson.resolutions = {};
    }
    packageJson.resolutions["@chilipiper/api-client"] = apiClientPath;
  });
}

// Supress lib:types error so its cached even on error
// we want it because since we want to collect fails across projects
// its useful to cache failed actions so we avoid running it multiple times
function supressTSLibChecksError({ directory }: { directory: string }) {
  editJSON(`${directory}/package.json`, (packageJson) => {
    packageJson.scripts[
      "lib:types"
    ] = `${packageJson.scripts["lib:types"]}>/dev/null & echo & echo Ignoring libs errors so command is cached...`;
  });
}

// Create separate cache for action so it doesnt get mixed with frontend repo caches
function isolateActionTurboCache({ directory }: { directory: string }) {
  editJSON(`${directory}/turbo.json`, (turboJson) => {
    if (!turboJson.remoteCache) {
      turboJson.remoteCache = {};
    }

    turboJson.remoteCache.signature = true;
  });
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
    const localApiClientPath = `${directory}/${apiClientSubDir}`;
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
    env: {
      ...process.env,
      YARN_CACHE_FOLDER: `${path.resolve(directory, ".yarn", "cache")}`,
    },
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
    env: {
      ...process.env,
      TURBO_REMOTE_CACHE_SIGNATURE_KEY,
      TURBO_TOKEN: turboToken,
      TURBO_TEAM: turboTeam,
    },
  });
}

function disableMocksDirCheck(directory: string) {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      disableMocksDirCheck(filePath);
    } else {
      const content = fs.readFileSync(filePath, "utf8");
      const updatedContent = `// @ts-nocheck\n\n${content}`;
      fs.writeFileSync(filePath, updatedContent, "utf8");
    }
  }
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

    const endDisableMocksTimerEnd = Timer.start(
      "Disabling TS check for api-client mocks dir"
    );
    disableMocksDirCheck(`${apiClientRepoPath}/${apiClientSubDir}/mocks`);
    endDisableMocksTimerEnd();

    // Moving api-client to a separate folder and reusing its repo saves around 30/40s
    // of CI runtime
    const reuseMonoRepoTimerEnd = Timer.start(
      "Reusing monorepo clone from parent action"
    );
    const apiClientPath = path.resolve("api-client-directory", apiClientSubDir);
    fs.cpSync(`${apiClientRepoPath}/${apiClientSubDir}`, apiClientPath, {
      recursive: true,
    });
    reuseMonoRepoTimerEnd();
    const monoRepoPath = apiClientRepoPath;

    const shardedFrontendsTimerEnd = Timer.start("Picking sharded frontends");
    const frontendsKeys = pickShardedFrontends(frontendVersions);
    shardedFrontendsTimerEnd();

    const failedFrontends = new Set<string>();

    const prefetchingMonoRepoTagsTimerEnd = Timer.start(
      "Prefetching monorepo tags"
    );
    await prefetchMonoRepoTags({
      directory: monoRepoPath,
      versions: frontendsKeys
        .filter((key) => frontendsConfig[key].repository === monoRepo)
        .map((key) => frontendVersions[key])
        .filter((item) => item),
    });
    prefetchingMonoRepoTagsTimerEnd();

    // force first iteration to have last version as undefined (fallback to master)
    // so we skip checkout if first frontend version is master branch
    let lastFrontendKey = "";
    for (const frontendKey of frontendsKeys) {
      const frontend = frontendsConfig[frontendKey];
      const isMonoRepo = frontend.repository === monoRepo;
      const directory = isMonoRepo ? monoRepoPath : frontendKey;

      if (!isMonoRepo) {
        const checkoutTimerEnd = Timer.start(
          `Checking out into ${frontendKey} ${frontendVersions[frontendKey]}`
        );
        await checkout({
          checkoutToken,
          directory,
          repository: frontend.repository,
          version: frontendVersions[frontendKey],
        });
        checkoutTimerEnd();
        const restoreCacheTimerEnd = Timer.start(
          `Restoring cache for ${frontendKey}`
        );
        await restoreNonMonoRepoCache(directory);
        restoreCacheTimerEnd();

        const restoreTSCacheTimerEnd = Timer.start("restoring TSBuild cache...");
        await restoreTypescriptCache(directory);
        restoreTSCacheTimerEnd();

        const apiClientInstallTimerEnd = Timer.start(
          `Installing api-client for ${frontendKey}`
        );
        await installApiClient({
          apiClientPath,
          directory,
          isMonoRepo,
        });
        apiClientInstallTimerEnd();
      }

      if (isMonoRepo) {
        const isSameAsLastVersion =
          frontendVersions[frontendKey] === frontendVersions[lastFrontendKey];

        // If is same version as last, no need to checkout & reinstall. Reuse configuration.
        // No need to cache monorepo as it will already be cached by frontend-repo-setup parent action
        if (!isSameAsLastVersion) {
          const checkoutTimerEnd = Timer.start(
            `Checking out into ${frontendKey} ${frontendVersions[frontendKey]}`
          );
          await checkout({
            checkoutToken,
            directory,
            repository: frontend.repository,
            version: frontendVersions[frontendKey],
          });
          checkoutTimerEnd();

          const restoreTSCacheTimerEnd = Timer.start("restoring TSBuild cache...");
          const appPath = `${monoRepoPath}/apps/${frontendKey}`;
          await restoreTypescriptCache(appPath);
          restoreTSCacheTimerEnd();

          const apiClientInstallTimerEnd = Timer.start(
            `Installing api-client for ${frontendKey}`
          );
          await installApiClient({
            apiClientPath,
            directory,
            isMonoRepo,
          });
          apiClientInstallTimerEnd();
          supressTSLibChecksError({ directory: monoRepoPath });
          isolateActionTurboCache({ directory: monoRepoPath });
        } else {
          info(
            `Version for ${frontendKey} is same as last run ${lastFrontendKey}. Skipping checkout & install`
          );
        }
      }

      info(`Running check commands for ${frontendKey}`);

      for (const command of frontend.commands) {
        const runCheckTimerEnd = Timer.start(
          `Running ${command.exec} for ${frontendKey} ${frontendVersions[frontendKey]}`
        );
        const exitCode = await runChecks({
          command: command.exec,
          directory: path.join(directory, command.directory),
        });
        runCheckTimerEnd();

        if (exitCode !== 0) {
          failedFrontends.add(frontendKey);
        }
      }

      lastFrontendKey = frontendKey;
    }

    if (failedFrontends.size > 0) {
      setOutput(
        "failed_frontends",
        JSON.stringify(Array.from(failedFrontends))
      );
      const shouldFail = getInput("should_fail") === "true";
      const errorMessage = `Failed frontends: [${Array.from(
        failedFrontends
      ).join(", ")}]`;
      if (shouldFail) {
        setFailed(errorMessage);
      } else {
        info(errorMessage);
      }
      return;
    }
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
