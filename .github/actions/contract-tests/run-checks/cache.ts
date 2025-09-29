const {
  restore: restoreFromGCloud,
} = require("../../gcloud-cache/dist/restore/index.cjs");

export const restoreCache: (params: {
  path: string[];
  key: string;
  restoreKeys: string[];
  restoreFromRepo?: string;
  workingDirectory?: string;
}) => string | undefined = restoreFromGCloud;
