import { getInput, info } from "@actions/core";
import { execSync } from "node:child_process";
import { partition, sortBy } from "lodash";
import { hashFileSync } from "hasha";
import { restoreCache, saveCache } from "@actions/cache";
import { shardFrontends } from "./shardFrontends";
import frontendsConfig from "./frontends.json";
import path from "node:path";
import { globSync } from "fast-glob";

export const monoRepo = "Chili-Piper/frontend";

export const Timer = {
  start(identifier: string) {
    info(`running ${identifier}...`);
    const startTime = performance.now();

    return () => {
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      // Format duration intelligently
      const formattedDuration =
        durationMs < 1000
          ? `${durationMs.toFixed(2)}ms`
          : `${(durationMs / 1000).toFixed(2)}s`;

      info(`finished running ${identifier}. took ${formattedDuration}!`);
    };
  },
};

export function pickShardedFrontends(
  frontendVersions: Record<string, string>,
  shardConfig: string
) {
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
  return [`${directory}/.yarn/cache`];
}

export async function restoreYarnCache(directory: string) {
  const key = await restoreCache(
    getCachePaths(directory),
    getCacheKey({ directory, addFingerPrint: true }),
    [getCacheKey({ directory })]
  );
  return key === getCacheKey({ directory, addFingerPrint: true });
}

export async function saveYarnCache(directory: string) {
  await saveCache(getCachePaths(directory), getCacheKey({ directory }));
}

function getTSCachePaths(directory: string) {
  return [
    `${directory}/apps/*/tsconfig.tsbuildinfo`,
    `${directory}/frontend-packages/*/lib`,
  ];
}

function getTSCacheKey(app: string, version?: string) {
  return `v1-integration-checks-typescript-${app}-${version ?? ""}`;
}

export async function saveTypescriptCache({
  directory,
  app,
  version,
}: {
  directory: string;
  app: string;
  version: string;
}) {
  const paths = getTSCachePaths(directory);
  const hasFilesInPaths = paths.find((pattern) => {
    const resolvedPattern = path.resolve(directory, pattern);
    return (
      globSync(resolvedPattern, { onlyFiles: true, absolute: true }).length > 0
    );
  });
  if (hasFilesInPaths) {
    await saveCache(paths, getTSCacheKey(app, version));
  } else {
    info(`Skipped saving cache cause there is no file or directory match.`);
  }
}

// https://github.com/microsoft/TypeScript/issues/54563
function updateTSBuildFilesTimestamp(directory: string) {
  const end = Timer.start("updating tsbuildinfo timestamps");

  const resolvedDir = path.resolve(directory);
  execSync(
    `find "${resolvedDir}" -type f -name ".tsbuildinfo" -exec touch {} +`,
    { stdio: "inherit", shell: "/bin/bash" }
  );
  execSync(
    `find "${resolvedDir}" -type f -name "tsconfig.tsbuildinfo" -exec touch {} +`,
    { stdio: "inherit", shell: "/bin/bash" }
  );

  end();
}

export { updateTSBuildFilesTimestamp };

export async function restoreTypescriptCache({
  directory,
  app,
  version,
}: {
  directory: string;
  app: string;
  version: string;
}) {
  const key = await restoreCache(
    getTSCachePaths(directory),
    getTSCacheKey(app, version)
  );
  if (key) {
    updateTSBuildFilesTimestamp(directory);
  }
  return Boolean(key);
}
