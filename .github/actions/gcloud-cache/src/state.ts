import * as core from "@actions/core";

export type CacheHitKindState = "exact" | "partial" | "none";

export interface State {
  path: string[];
  cacheHitKind: CacheHitKindState;
  targetFileName: string;
}

export function saveState(state: State): void {
  core.debug(`Saving state: ${JSON.stringify(state)}.`);

  core.saveState("path", JSON.stringify(state.path));
  core.saveState("cache-hit-kind", state.cacheHitKind);
  core.saveState("target-file-name", state.targetFileName);
}

export function getState(): State {
  const state = {
    path: JSON.parse(core.getState("path")) as string[],
    bucket: core.getState("bucket"),
    cacheHitKind: core.getState("cache-hit-kind") as CacheHitKindState,
    targetFileName: core.getState("target-file-name"),
  };

  core.debug(`Loaded state: ${JSON.stringify(state)}.`);

  return state;
}
