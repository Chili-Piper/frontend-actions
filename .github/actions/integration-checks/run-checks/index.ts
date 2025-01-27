import { exec } from "@actions/exec";
import { hashFileSync } from "hasha";
import path from "node:path";
import fs from "node:fs";
import { info, getInput, setFailed, setOutput } from "@actions/core";
import { restoreCache, saveCache } from "@actions/cache";
import * as yaml from "js-yaml";
import { partition, sortBy } from "lodash";
import { shardFrontends } from "./shardFrontends";
import frontendsConfig from "./frontends.json";

const gitUser = "srebot";
const apiClientSubDir = "frontend-packages/api-client";
const monoRepo = "Chili-Piper/frontend";
const turboTeam = getInput("turbo_team");
const turboToken = getInput("turbo_token");

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

async function install({ directory }: { directory: string }) {
  info("Installing deps...");
  await exec("yarn --silent", undefined, {
    cwd: directory,
  });
}

function editJSON(path: string, cb: (data: any) => void) {
  const data = JSON.parse(fs.readFileSync(path, "utf-8"));
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

function pickShardedFrontends(frontendVersions: Record<string, string>) {
  const shardConfig = getInput("shard");

  // Step 1: Partition frontends into mono-repo and other frontends
  // Mono-repo frontends can often reuse configuration (e.g., yarn link cache)
  // from previous runs, making them lighter and faster to process.
  // Other frontends, on the other hand, are heavier to run since they cannot
  // benefit from the mono-repo configuration reuse. By partitioning them,
  // we can handle their distribution separately and optimize overall execution.
  const frontendsKeys = Object.keys(frontendsConfig) as Array<
    keyof typeof frontendsConfig
  >;
  const [monoRepoFrontends, otherFrontends] = partition(
    frontendsKeys,
    (key) => frontendsConfig[key].repository === monoRepo
  );

  // Step 2: Sort mono-repo frontends by their tags
  // Sorting ensures that frontends with the same version are grouped together in order.
  // This optimization allows tools like `yarn link` to reuse their cache during runs.
  // For example:
  // - Without sorting: ["A@1.0", "B@2.0", "C@1.0"] would require `yarn link` to run 3 times.
  // - With sorting:    ["A@1.0", "C@1.0", "B@2.0"] would run `yarn link` only 2 times,
  //   as it can reuse the cache for items with the same version consecutively.
  const tagOrderedMonoRepoFrontends = sortBy(
    monoRepoFrontends,
    (key) => frontendVersions[key]
  );

  return shardFrontends(
    tagOrderedMonoRepoFrontends,
    otherFrontends,
    frontendVersions,
    shardConfig
  );
}

function getCacheKey({
  directory,
  addFingerPrint,
}: {
  directory: string;
  addFingerPrint?: boolean;
}) {
  const fingerPrint = addFingerPrint
    ? ""
    : hashFileSync(`${directory}/yarn.lock`);
  return `v4-integration-checks-node-modules-${directory}-${fingerPrint}`;
}

function getCachePaths(directory: string) {
  return [`${directory}/**/node_modules`, `${directory}/.yarn/cache`];
}

async function restoreNonMonoRepoCache(directory: string) {
  const key = await restoreCache(
    getCachePaths(directory),
    getCacheKey({ directory }),
    [getCacheKey({ directory, addFingerPrint: true })]
  );
  return Boolean(key);
}

async function saveNonMonoRepoCache(directory: string) {
  await saveCache(getCachePaths(directory), getCacheKey({ directory }));
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

    info("Disabling TS check for api-client mocks dir");
    disableMocksDirCheck(`${apiClientRepoPath}/${apiClientSubDir}/mocks`);

    // Moving api-client to a separate folder and reusing its repo saves around 30/40s
    // of CI runtime
    info("Reusing monorepo clone from parent action");
    const apiClientPath = path.resolve("api-client-directory", apiClientSubDir);
    fs.cpSync(`${apiClientRepoPath}/${apiClientSubDir}`, apiClientPath, {
      recursive: true,
    });
    const monoRepoPath = apiClientRepoPath;

    const frontendsKeys = pickShardedFrontends(frontendVersions);

    const failedFrontends = new Set<string>();

    info("Prefetching monorepo tags");
    await prefetchMonoRepoTags({
      directory: monoRepoPath,
      versions: frontendsKeys
        .filter((key) => frontendsConfig[key].repository === monoRepo)
        .map((key) => frontendVersions[key])
        .filter((item) => item),
    });

    info("Preparing monorepo lib types");
    const nullStream = fs.createWriteStream("/dev/null");
    await installApiClient({
      apiClientPath,
      directory: monoRepoPath,
      isMonoRepo: true,
    });
    supressTSLibChecksError({ directory: monoRepoPath });
    isolateActionTurboCache({ directory: monoRepoPath });
    await exec("yarn turbo run lib:types", undefined, {
      cwd: monoRepoPath,
      ignoreReturnCode: true,
      silent: true,
      outStream: nullStream,
      errStream: nullStream,
      env: {
        ...process.env,
        TURBO_REMOTE_CACHE_SIGNATURE_KEY,
        TURBO_TOKEN: turboToken,
        TURBO_TEAM: turboTeam,
      },
    });

    // force first iteration to have last version as undefined (fallback to master)
    // so we skip checkout if first frontend version is master branch
    let lastFrontendKey = "";
    for (const frontendKey of frontendsKeys) {
      const frontend = frontendsConfig[frontendKey];
      const isMonoRepo = frontend.repository === monoRepo;
      const directory = isMonoRepo ? monoRepoPath : frontendKey;

      if (!isMonoRepo) {
        await checkout({
          checkoutToken,
          directory,
          repository: frontend.repository,
          version: frontendVersions[frontendKey],
        });
        const cacheHit = await restoreNonMonoRepoCache(directory);
        if (!cacheHit) {
          await install({ directory });
          await saveNonMonoRepoCache(directory);
        } else {
          info(`Cache hit for ${frontendKey}. Skipping install`);
        }
        await installApiClient({
          apiClientPath,
          directory,
          isMonoRepo,
        });
      }

      if (isMonoRepo) {
        const isSameAsLastVersion =
          frontendVersions[frontendKey] === frontendVersions[lastFrontendKey];

        // If is same version as last, no need to checkout & reinstall. Reuse configuration.
        // No need to cache monorepo as it will already be cached by frontend-repo-setup parent action
        if (!isSameAsLastVersion) {
          await checkout({
            checkoutToken,
            directory,
            repository: frontend.repository,
            version: frontendVersions[frontendKey],
          });

          await install({ directory });
          await installApiClient({
            apiClientPath,
            directory,
            isMonoRepo,
          });
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
        const exitCode = await runChecks({
          command: command.exec,
          directory: path.join(directory, command.directory),
        });

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
