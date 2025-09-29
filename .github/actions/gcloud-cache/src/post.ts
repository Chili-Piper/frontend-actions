import * as core from "@actions/core";

import { getState } from "./state";
import { saveInternal } from "./save-internal";

async function main() {
  const state = getState();

  if (state.cacheHitKind === "exact") {
    console.log(
      "🌀 Skipping uploading cache as the cache was hit by exact match."
    );
    return;
  }

  // if (state.restoreFromRepo) {
  //   console.log(
  //     "🌀 Skipping uploading cache as the cache was restored from different repo."
  //   );
  //   return;
  // }

  return saveInternal({
    path: state.path,
    targetFileName: state.targetFileName,
  });
}

void main().catch((err: Error) => {
  core.error(err);
  core.setFailed(err);
});
