import * as github from "@actions/github";

import { eraseInternal } from "./erase-internal";

export async function erase({ branch }: { branch: string }) {
  const folderPrefix = `${github.context.repo.owner}/${github.context.repo.repo}`;

  const branchPath = `${folderPrefix}/${branch}`;

  return eraseInternal({ branchPath });
}
