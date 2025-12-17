import * as core from "@actions/core";

export type CacheHitKindState = "exact" | "partial" | "none";

export interface State {
  path: string[];
  cacheHitKind: CacheHitKindState;
  targetFileName: string;
  restoreFromRepo?: string;
}

export function saveState(state: State): void {
  core.debug(`Saving state: ${JSON.stringify(state)}.`);

  core.saveState("path", JSON.stringify(state.path));
  core.saveState("cache-hit-kind", state.cacheHitKind);
  core.saveState("target-file-name", state.targetFileName);
  core.saveState("restore-from-repo", state.restoreFromRepo);
}

export function getState(): State {
  console.log("Getting state...");
  console.log(`Path state: ${core.getState("path")}`);
  const state = {
    path: JSON.parse(core.getState("path")) as string[],
    bucket: core.getState("bucket"),
    cacheHitKind: core.getState("cache-hit-kind") as CacheHitKindState,
    targetFileName: core.getState("target-file-name"),
    restoreFromRepo: core.getState("restore-from-repo"),
  };

  core.debug(`Loaded state: ${JSON.stringify(state)}.`);

  return state;
}
