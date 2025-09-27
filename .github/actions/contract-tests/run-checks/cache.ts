const {
  restore: restoreFromGCloud,
} = require("../../gcloud-cache/dist/restore/index.cjs");
const {
  save: saveToGCloud,
} = require("../../gcloud-cache/dist/save/index.cjs");

export const restoreCache: (params: {
  path: string[];
  key: string;
  restoreKeys: string[];
  restoreFromRepo?: string;
}) => string | undefined = restoreFromGCloud;

export const saveCache: (params: {
  path: string[];
  key: string;
  saveToRepo?: string;
}) => string | undefined = saveToGCloud;
