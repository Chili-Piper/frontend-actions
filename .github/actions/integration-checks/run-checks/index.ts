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
  restoreYarnCache,
  restoreTypescriptCache,
  saveYarnCache,
  saveTypescriptCache,
} from "./shared";
import frontendsConfig from "./frontends.json";
// @ts-expect-error
import exclusiveTSC from "raw-loader!./exclusiveTSC.js";

const gitUser = "srebot";
const apiClientSubDir = "frontend-packages/api-client";

process.env.NODE_OPTIONS = "--max_old_space_size=4194";

const nowhereStream = fs.createWriteStream("/dev/null");

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
  if (await fs.promises.stat(directory).catch(() => false)) {
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

async function install({
  directory,
  force,
}: {
  directory: string;
  force?: boolean;
}) {
  info("Installing deps...");
  await exec(`yarn --no-immutable${force ? " --force" : ""}`, undefined, {
    cwd: directory,
    outStream: nowhereStream,
    env: {
      ...process.env,
      YARN_CACHE_FOLDER: `${path.resolve(directory, ".yarn", "cache")}`,
    },
  });
}

async function editJSON(path: string, cb: (data: any) => void) {
  const fileContent = await fs.promises.readFile(path, "utf-8");
  const data = JSON5.parse(fileContent);
  cb(data);
  await fs.promises.writeFile(path, JSON.stringify(data, null, 2));
}

function setApiClientResolution({
  apiClientPath,
  directory,
}: {
  directory: string;
  apiClientPath: string;
}) {
  return editJSON(`${directory}/package.json`, (packageJson) => {
    if (!packageJson.resolutions) {
      packageJson.resolutions = {};
    }
    packageJson.resolutions["@chilipiper/api-client"] = apiClientPath;
  });
}

function ignoreTestFiles(directory: string) {
  return editJSON(`${directory}/tsconfig.json`, (tsconfig) => {
    if (!tsconfig.exclude) {
      tsconfig.exclude = [];
    }
    tsconfig.exclude.push(
      "**/*.stories.tsx",
      "**/*.stories.ts",
      "**/*.test.tsx",
      "**/*.test.ts",
      "**/*.spec.tsx",
      "**/*.spec.ts"
    );
  });
}

// temporary fix while FE wont update to new TS version
function disableStrictIteratorChecks(directory: string) {
  return editJSON(
    `${directory}/frontend-packages/design-system/tsconfig.json`,
    (tsconfig) => {
      if (!tsconfig.compilerOptions) {
        tsconfig.compilerOptions = {};
      }
      tsconfig.compilerOptions.strictBuiltinIteratorReturn = false;
    }
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
    const localApiClientPath = `${directory}/${apiClientSubDir}`;
    info(`Copying api-client from ${apiClientPath}`);
    const packageJson = await fs.promises.readFile(
      `${localApiClientPath}/package.json`,
      "utf-8"
    );
    await fs.promises.rm(localApiClientPath, { recursive: true, force: true });
    await fs.promises.cp(apiClientPath, localApiClientPath, {
      recursive: true,
    });
    await fs.promises.writeFile(
      `${localApiClientPath}/package.json`,
      packageJson
    );
    return;
  }
  info(`Linking api-client ${apiClientPath}`);
  await setApiClientResolution({ directory, apiClientPath });
  await exec(`yarn add @chilipiper/api-client@${apiClientPath}`, undefined, {
    cwd: directory,
    outStream: nowhereStream,
    env: {
      ...process.env,
      YARN_CACHE_FOLDER: `${path.resolve(directory, ".yarn", "cache")}`,
    },
  });
}

async function runChecks({
  command,
  directory,
}: {
  command: string;
  directory: string;
}) {
  info(`Running type checks with command ${command}`);
  await fs.promises.writeFile(
    `${directory}/exclusiveTSC.js`,
    exclusiveTSC,
    "utf-8"
  );
  return exec("node", ["exclusiveTSC.js"], {
    cwd: directory,
    ignoreReturnCode: true,
  });
}

async function disableMocksDirCheck(directory: string) {
  const files = await fs.promises.readdir(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      await disableMocksDirCheck(filePath);
    } else {
      const content = await fs.promises.readFile(filePath, "utf8");
      const updatedContent = `// @ts-nocheck\n\n${content}`;
      await fs.promises.writeFile(filePath, updatedContent, "utf8");
    }
  }
}

async function run(
  frontendsKeys: Array<keyof typeof frontendsConfig>,
  frontendVersions: Record<string, string>,
  apiClientRepoPath: string
) {
  try {
    const checkoutToken = getInput("checkout_token");

    const endDisableMocksTimerEnd = Timer.start(
      "Disabling TS check for api-client mocks dir"
    );
    await disableMocksDirCheck(`${apiClientRepoPath}/${apiClientSubDir}/mocks`);
    endDisableMocksTimerEnd();

    // Moving api-client to a separate folder and reusing its repo saves around 30/40s
    // of CI runtime
    const reuseMonoRepoTimerEnd = Timer.start(
      "Reusing monorepo clone from parent action"
    );
    const apiClientPath = path.resolve("api-client-directory", apiClientSubDir);
    await fs.promises.cp(
      `${apiClientRepoPath}/${apiClientSubDir}`,
      apiClientPath,
      {
        recursive: true,
      }
    );
    reuseMonoRepoTimerEnd();
    const monoRepoPath = apiClientRepoPath;

    const shardedFrontendsTimerEnd = Timer.start("Picking sharded frontends");
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
      let foundTSCacheMatch = false;

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
        const exactMatch = await restoreYarnCache(directory);
        restoreCacheTimerEnd();

        await install({ directory });

        if (!exactMatch) {
          const saveCacheTimerEnd = Timer.start(
            `Saving cache for ${frontendKey}`
          );
          await saveYarnCache(directory);
          saveCacheTimerEnd();
        } else {
          info(`Skipping saving cache since it was an exact match`);
        }

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

          // temporary workaround
          await editJSON(`${directory}/package.json`, (packagejson) => {
            packagejson.devDependencies["typescript"] = "5.6.3";
            packagejson.resolutions["typescript"] = "5.6.3";
          });
          await disableStrictIteratorChecks(directory);

          await install({ directory });

          const restoreTSCacheTimerEnd = Timer.start(
            "restoring TSBuild cache..."
          );
          foundTSCacheMatch = await restoreTypescriptCache({
            directory,
            app: "monorepo",
            version: frontendVersions[frontendKey],
          });
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
        } else {
          info(
            `Version for ${frontendKey} is same as last run ${lastFrontendKey}. Skipping checkout & install`
          );
        }
      }

      info(`Running check commands for ${frontendKey}`);

      for (const command of frontend.commands) {
        const ignoreTestFilesTimerEnd = Timer.start(
          `Ignoring test files before running tests for ${frontendKey}`
        );
        await ignoreTestFiles(path.join(directory, command.directory));
        ignoreTestFilesTimerEnd();
        const runCheckTimerEnd = Timer.start(
          `Running ${command.exec} for ${frontendKey} ${frontendVersions[frontendKey]}`
        );
        const exitCode = await runChecks({
          command: command.exec,
          directory: path.join(directory, command.directory),
        });
        runCheckTimerEnd();

        if (!foundTSCacheMatch && isMonoRepo) {
          const saveTSCacheTimerEnd = Timer.start(
            `Saving TS cache for ${frontendKey}`
          );
          await saveTypescriptCache({
            directory,
            app: "monorepo",
            version: frontendVersions[frontendKey],
          });
          saveTSCacheTimerEnd();
        } else {
          info(
            `Skipping save TS cache because restore was exact match or repo is not monorepo`
          );
        }

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

async function runSharded() {
  const apiClientRepoPath = getInput("api_client_repo_path");
  const frontendVersionsJSON = getInput("frontend");
  const concurrency = 2;
  const frontendVersions = (yaml.load(frontendVersionsJSON) ?? {}) as Record<
    string,
    string
  >;
  const shardConfig = getInput("shard"); // Example: "1/2" or "2/2"

  const [currentShard, totalShards] = shardConfig.split("/").map(Number);

  // Simulates shards with concurrency
  const newTotalShards = totalShards * concurrency;
  const startIndex = (currentShard - 1) * concurrency + 1;
  const newShardConfigs = Array.from(
    { length: concurrency },
    (_, i) => `${startIndex + i}/${newTotalShards}`
  );

  const timerCopyRepoEnd = Timer.start("Copying repo for new shards");
  const newShardRepoPaths = await Promise.all(
    newShardConfigs.map(async (_, index) => {
      if (index !== 0) {
        const resolvedPath = path.resolve(apiClientRepoPath);
        const newPath = `${resolvedPath}-${index}`;
        await fs.promises.cp(apiClientRepoPath, newPath, {
          recursive: true,
        });
        info(`created path ${apiClientRepoPath} to ${newPath}`);
        await install({ directory: newPath, force: true });
        return newPath;
      }

      return apiClientRepoPath;
    })
  );
  timerCopyRepoEnd();

  return Promise.all(
    newShardConfigs.map((newShardConfig, index) => {
      const frontendsKeys = pickShardedFrontends(
        frontendVersions,
        newShardConfig
      );
      info(`Running checks for ${frontendsKeys.join()}`);
      return run(frontendsKeys, frontendVersions, newShardRepoPaths[index]);
    })
  );
}

runSharded();
