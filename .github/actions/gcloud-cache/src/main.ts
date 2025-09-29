import * as core from "@actions/core";

import { getInputs } from "./inputs";
import { restore } from "./restore";

async function main() {
  const inputs = getInputs();

  const exactMatchKey = await restore(inputs);

  if (exactMatchKey) {
    core.setOutput("cache-hit", "true");
  } else {
    core.setOutput("cache-hit", "false");
  }
}

void main().catch((err: Error) => {
  core.error(err);
  core.setFailed(err);
});
