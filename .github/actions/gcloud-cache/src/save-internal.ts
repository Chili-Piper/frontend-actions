import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as github from "@actions/github";
import { Storage } from "@google-cloud/storage";
import * as nodePath from "node:path";
import { withFile as withTemporaryFile } from "tmp-promise";

import { CacheActionMetadata } from "./gcs-utils";
import { createTar } from "./tar-utils";
import { BUCKET } from "./constants";
import { Timer } from "./shared";

export async function saveInternal({
  path,
  targetFileName,
}: {
  path: string[];
  targetFileName: string;
}) {
  console.log("Starting saveInternal...");
  const bucket = new Storage().bucket(BUCKET);

  console.log("Checking if file exists...");

  const [targetFileExists] = await bucket
    .file(targetFileName)
    .exists()
    .catch((err) => {
      core.error("Failed to check if the file already exists");
      throw err;
    });

  if (targetFileExists) {
    console.log(
      "🌀 Skipping uploading cache as it already exists (probably due to another job)."
    );
    return;
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const pattern = path.join("\n");

  console.log("Creating globber...");
  const globber = await glob.create(pattern, {
    implicitDescendants: false,
  });

  console.log("Running globber...");
  const paths = await globber
    .glob()
    .then((files) => files.map((file) => nodePath.relative(workspace, file)));

  console.log("Running withTemporaryFile...");
  return withTemporaryFile(async (tmpFile) => {
    const finishedArchive = Timer.start("Creating cache archive", "🗜️");

    const compressionMethod = await createTar(
      tmpFile.path,
      paths,
      workspace
    ).catch((err) => {
      core.error("Failed to create the archive");
      throw err;
    });

    finishedArchive();

    const customMetadata: CacheActionMetadata = {
      "Cache-Action-Compression-Method": compressionMethod,
    };

    console.log(`🔹 Uploading file '${targetFileName}'...`);

    const finishedUpload = Timer.start("Upload cache archive to bucket", "🌐");
    await bucket
      .upload(tmpFile.path, {
        destination: targetFileName,
        metadata: {
          metadata: customMetadata,
        },
      })
      .catch((err) => {
        core.error("Failed to upload the file");
        throw err;
      });
    finishedUpload();

    console.log("✅ Successfully saved cache.");
  });
}
