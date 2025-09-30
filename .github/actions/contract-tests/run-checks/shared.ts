import { getInput, info } from "@actions/core";
import { partition, sortBy } from "lodash";
import { createHash } from "crypto";
import { restoreCache } from "./cache";
import { shardFrontends } from "./shardFrontends";
import frontendsConfig from "./frontends.json";
import { existsSync, readFileSync } from "fs";

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

type AppsStatuses = {
  frontend: Record<string, "CHANGED" | "NOT_CHANGED">;
  backend: Record<string, "CHANGED" | "NOT_CHANGED">;
};

const appsStatuses = getInput("appsStatuses")
  ? (JSON.parse(getInput("appsStatuses")) as AppsStatuses)
  : undefined;

const hasBEChanges = appsStatuses
  ? Boolean(
      Object.values(appsStatuses.backend).find((item) => item === "CHANGED")
    )
  : // if no appsStatuses provided, act as if there are BE changes
    true;

export function pickShardedFrontends(frontendVersions: Record<string, string>) {
  const shardConfig = getInput("shard");

  // Step 1: Partition frontends into mono-repo and other frontends
  // Mono-repo frontends can often reuse configuration (e.g., yarn link cache)
  // from previous runs, making them lighter and faster to process.
  // Other frontends, on the other hand, are heavier to run since they cannot
  // benefit from the mono-repo configuration reuse. By partitioning them,
  // we can handle their distribution separately and optimize overall execution.
  const frontendsKeys = (
    Object.keys(frontendsConfig) as Array<keyof typeof frontendsConfig>
  ).filter((item) => {
    if (hasBEChanges) {
      return true;
    }

    if (appsStatuses?.frontend[item] === "CHANGED") {
      return true;
    }

    info(
      `No BE changes and no FE changes found for app ${item}. Skipping checks...`
    );
    return false;
  });
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

function hashFileLikeActions(file: string) {
  const files = [file];
  const final = createHash("sha256");
  for (const file of files) {
    const perFile = createHash("sha256").update(readFileSync(file)).digest();
    final.write(perFile); // raw bytes
  }
  return final.digest("hex");
}

function getCacheKey({
  directory,
  addFingerPrint,
}: {
  directory: string;
  addFingerPrint?: boolean;
}) {
  const fingerPrint = addFingerPrint
    ? hashFileLikeActions(`${directory}/yarn.lock`)
    : "";

  const runnerOS = process.env.RUNNER_OS || process.platform;
  const nvmrcNodeVersion = existsSync(`${directory}/.nvmrc`)
    ? readFileSync(`${directory}/.nvmrc`, "utf-8")
    : undefined;
  const toolVersionsNodeVersion = existsSync(`${directory}/.tool-versions`)
    ? readFileSync(`${directory}/.tool-versions`, "utf-8")
        ?.split("\n")
        .find((l) => l.trim().startsWith("node "))
        ?.replace("node ", "")
    : undefined;
  const nodeVersion = nvmrcNodeVersion || toolVersionsNodeVersion;

  const cacheName = "node-modules-yarn";
  return `v5-beta4-${runnerOS}-${cacheName}-v${nodeVersion}-${fingerPrint}`;
}

function getCachePaths(directory: string) {
  return [`${directory}/.yarn/cache`, `${directory}/**/node_modules`];
}

export async function restoreYarnCache(directory: string, repository: string) {
  const key = getCacheKey({ directory, addFingerPrint: true });
  const matchKey = await restoreCache({
    path: getCachePaths(directory),
    key,
    restoreKeys: [getCacheKey({ directory })],
    restoreFromRepo: repository,
    workingDirectory: directory,
  });
  info(`comparing keys ${matchKey} and ${key}`);
  return matchKey === key;
}
