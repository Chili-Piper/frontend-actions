import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as github from "@actions/github";
import { Storage } from "@google-cloud/storage";
import * as nodePath from "node:path";
import { withFile as withTemporaryFile } from "tmp-promise";

import { CacheActionMetadata } from "./gcs-utils";
import { createTar } from "./tar-utils";
import { BUCKET } from "./constants";

export async function saveInternal({
  path,
  targetFileName,
}: {
  path: string[];
  targetFileName: string;
}) {
  const bucket = new Storage().bucket(BUCKET);

  const [targetFileExists] = await bucket
    .file(targetFileName)
    .exists()
    .catch((err) => {
      core.error("Failed to check if the file already exists");
      throw err;
    });

  core.info(`Target file name: ${targetFileName}.`);

  if (targetFileExists) {
    console.log(
      "🌀 Skipping uploading cache as it already exists (probably due to another job)."
    );
    return;
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const pattern = `{${path.join(",")}}`;
  const globber = await glob.create(pattern, {
    implicitDescendants: false,
  });

  const paths = await globber
    .glob()
    .then((files) => files.map((file) => nodePath.relative(workspace, file)));

  core.info(`Paths: ${JSON.stringify(paths)}.`);

  return withTemporaryFile(async (tmpFile) => {
    const compressionMethod = await core
      .group("🗜️ Creating cache archive", () =>
        createTar(tmpFile.path, paths, workspace)
      )
      .catch((err) => {
        core.error("Failed to create the archive");
        throw err;
      });

    const customMetadata: CacheActionMetadata = {
      "Cache-Action-Compression-Method": compressionMethod,
    };

    core.info(`Metadata: ${JSON.stringify(customMetadata)}.`);

    await core
      .group("🌐 Uploading cache archive to bucket", async () => {
        console.log(`🔹 Uploading file '${targetFileName}'...`);

        await bucket.upload(tmpFile.path, {
          destination: targetFileName,
          metadata: {
            metadata: customMetadata,
          },
        });
      })
      .catch((err) => {
        core.error("Failed to upload the file");
        throw err;
      });

    console.log("✅ Successfully saved cache.");
  });
}
