import * as core from "@actions/core";
import * as github from "@actions/github";

import { eraseInternal } from "./erase-internal";

async function erase() {
  const target_ref = core.getInput("target_ref", { required: true });
  const folderPrefix = `${github.context.repo.owner}/${github.context.repo.repo}`;

  const path = `${folderPrefix}/${target_ref}`;

  return eraseInternal({ path });
}

void erase().catch((err: Error) => {
  core.error(err);
  core.setFailed(err);
});
