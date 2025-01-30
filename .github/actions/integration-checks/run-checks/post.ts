import { getInput } from "@actions/core";
import * as yaml from "js-yaml";
import {
  pickShardedFrontends,
  Timer,
  saveNonMonoRepoCache,
  monoRepo,
} from "./shared";
import frontendsConfig from "./frontends.json";

async function run() {
  const frontendVersionsJSON = getInput("frontend");
  const frontendVersions = (yaml.load(frontendVersionsJSON) ?? {}) as Record<
    string,
    string
  >;
  const frontendsKeys = pickShardedFrontends(frontendVersions);
  for (const frontendKey of frontendsKeys) {
    const frontend = frontendsConfig[frontendKey];
    const isMonoRepo = frontend.repository === monoRepo;

    if (isMonoRepo) {
      continue;
    }

    const saveCacheTimerEnd = Timer.start(`Saving cache for ${frontendKey}`);
    await saveNonMonoRepoCache(frontendKey);
    saveCacheTimerEnd();
  }
}

run();
