import * as core from "@actions/core";

export interface Inputs {
  bucket: string;
  path: string;
  key: string;
  restoreKeys: string[];
  restoreFromRepo?: string;
}

export function getInputs(): Inputs {
  const inputs = {
    bucket: "dataprep-staging-cd779566-e7a3-447e-95a1-8135f91bc61f",
    path: core.getInput("path", { required: true }),
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
