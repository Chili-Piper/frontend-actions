import * as github from "@actions/github";

import { saveInternal } from "./save-internal";

export async function save({
  path,
  key,
  saveToRepo,
}: {
  path: string[];
  key: string;
  saveToRepo?: string;
}) {
  const folderPrefix = `${github.context.repo.owner}/${
    saveToRepo || github.context.repo.repo
  }`;

  const targetFileName = `${folderPrefix}/${github.context.ref}/${key}.tar`;

  return saveInternal({ path, targetFileName });
}
