import { getInput, info } from "@actions/core";
import { partition, sortBy } from "lodash";
import { hashFileSync } from "hasha";
import { restoreCache, saveCache } from "@actions/cache";
import { shardFrontends } from "./shardFrontends";
import frontendsConfig from "./frontends.json";

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

export function pickShardedFrontends(frontendVersions: Record<string, string>) {
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

export async function restoreNonMonoRepoCache(directory: string) {
  const key = await restoreCache(
    getCachePaths(directory),
    getCacheKey({ directory }),
    [getCacheKey({ directory, addFingerPrint: true })]
  );
  return Boolean(key);
}

export async function saveNonMonoRepoCache(directory: string) {
  await saveCache(getCachePaths(directory), getCacheKey({ directory }));
}
