import { setFailed } from "@actions/core";
import frontendsConfig from "./frontends.json";
import { groupBy } from "lodash";

type FrontendKey = keyof typeof frontendsConfig;
type FrontendVersionMap = Record<string, string>;

function parseShardConfig(shardConfig: string): {
  currentShard: number;
  totalShards: number;
} {
  const [currentShard, totalShards] = shardConfig.split("/").map(Number);

  if (
    isNaN(currentShard) ||
    isNaN(totalShards) ||
    totalShards <= 0 ||
    currentShard < 1 ||
    currentShard > totalShards
  ) {
    throw setFailed(
      `Invalid shard configuration: "${shardConfig}". Expected format is "<currentShard>/<totalShards>" where 1 <= currentShard <= totalShards.`
    );
  }

  return { currentShard, totalShards };
}

function groupByVersion(
  items: FrontendKey[],
  frontendVersions: FrontendVersionMap
) {
  const grouped = groupBy(items, (item) => frontendVersions[item]);
  return Object.entries(grouped).map(([version, items]) => ({
    version,
    items,
  }));
}

type Group = { version: string; items: FrontendKey[] };

function distributeGroups(groups: Group[], totalShards: number) {
  const shards: FrontendKey[][] = Array.from({ length: totalShards }, () => []);

  // Order queues by items size, we will consume queues from smallest to biggest
  // so we prioritize distributing versions across shards
  const versionQueues = groups
    .map((group) => ({
      version: group.version,
      items: [...group.items],
    }))
    .sort((a, b) => a.items.length - b.items.length);

  // Initialize shard queues (track which queue each shard is consuming)
  const shardQueues = new Array<Group | null>(totalShards);

  const getNextQueue = () => {
    // Try to find an unassigned queue
    const unassignedQueue = versionQueues.find(
      (queue) => queue.items.length > 0 && !shardQueues.includes(queue)
    );
    if (unassignedQueue) return unassignedQueue;

    // Return any active queue with items left
    return shardQueues.find((queue) => queue && queue.items.length > 0) || null;
  };

  // Assign the initial queues to shards
  for (let i = 0; i < totalShards; i++) {
    shardQueues[i] = getNextQueue();
  }

  // Consume items until all queues are empty
  while (versionQueues.some((queue) => queue.items.length > 0)) {
    for (let shardIndex = 0; shardIndex < totalShards; shardIndex++) {
      const queue = shardQueues[shardIndex];

      // If the shard's queue is empty or null, assign a new one
      if (!queue?.items.length) {
        const nextQueue = getNextQueue();
        if (nextQueue) {
          shardQueues[shardIndex] = nextQueue;
        }
      }

      // Consume one item from the shard's queue
      const activeQueue = shardQueues[shardIndex];
      const item = activeQueue?.items.shift();
      if (item) {
        shards[shardIndex].push(item);
      }
    }
  }

  return shards;
}

export function shardFrontends(
  tagOrderedMonoRepoFrontends: FrontendKey[],
  otherFrontends: FrontendKey[],
  frontendVersions: FrontendVersionMap,
  shardConfig: string
): FrontendKey[] {
  const { currentShard, totalShards } = parseShardConfig(shardConfig);

  const groupedMonoRepoFrontends = groupByVersion(
    tagOrderedMonoRepoFrontends,
    frontendVersions
  );
  const groupedOtherFrontends = groupByVersion(
    otherFrontends,
    frontendVersions
  );

  const monoRepoShards = distributeGroups(
    groupedMonoRepoFrontends,
    totalShards
  );
  const otherShards = distributeGroups(groupedOtherFrontends, totalShards);

  return [
    ...monoRepoShards[currentShard - 1],
    ...otherShards[currentShard - 1],
  ];
}
