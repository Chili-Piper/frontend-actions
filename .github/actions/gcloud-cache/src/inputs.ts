import * as core from "@actions/core";

export interface Inputs {
  path: string[];
  key: string;
  restoreKeys: string[];
  restoreFromRepo?: string;
}

export function getInputs(): Inputs {
  const inputs = {
    path: core
      .getInput("path", { required: true })
      .split(",")
      .filter((path) => path),
    key: core.getInput("key", { required: true }),
    restoreKeys: core
      .getInput("restore-keys")
      .split(",")
      .filter((path) => path),
    restoreFromRepo: core.getInput("restore-from-repo"),
  };

  core.debug(`Loaded inputs: ${JSON.stringify(inputs)}.`);

  return inputs;
}
