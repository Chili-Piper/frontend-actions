import * as core from "@actions/core";
import * as github from "@actions/github";
import { Storage, File, Bucket } from "@google-cloud/storage";
import { withFile as withTemporaryFile } from "tmp-promise";

import { ObjectMetadata } from "./gcs-utils";
import { CacheHitKindState, saveState } from "./state";
import { extractTar } from "./tar-utils";
import { BUCKET } from "./constants";
import { Timer } from "./shared";

const masterBranch = "refs/heads/master";
const mainBranch = "refs/heads/main";
const mockedBranchToForceCacheMiss =
  "refs/heads/27c74ea5-557d-42c2-bd2e-4fe2762ba6ab";

async function getBestMatch({
  bucket,
  key,
  restoreKeys,
  restoreFromRepo,
  folderPrefix,
  branch,
  isPR,
}: {
  bucket: Bucket;
  key: string;
  restoreKeys: string[];
  folderPrefix: string;
  branch: string;
  isPR: boolean;
  restoreFromRepo?: string;
}): Promise<[File, Exclude<CacheHitKindState, "none">] | [null, "none"]> {
  const exactPath = `${folderPrefix}/${branch}/${key}.tar`;

  core.info(`Will lookup for the file ${exactPath}`);
  const exactFileBranch = bucket.file(exactPath);
  const exactFileMaster = bucket.file(
    `${folderPrefix}/${masterBranch}/${key}.tar`
  );
  const exactFileMain = bucket.file(`${folderPrefix}/${mainBranch}/${key}.tar`);

  const exactFilesBranch = [exactFileBranch.exists()];

  const exactFilesMaster = isPR
    ? [exactFileMaster.exists(), exactFileMain.exists()]
    : [Promise.resolve([false]), Promise.resolve([false])];

  const exactFileExistsPromises = [...exactFilesBranch, ...exactFilesMaster];
  const [
    exactFileExistsResult,
    exactFileMasterExistsResult,
    exactFileMainExistsResult,
  ] = await Promise.all(exactFileExistsPromises).catch((err) => {
    core.error("Failed to check if an exact match exists");
    throw err;
  });

  const exactFile = (() => {
    if (exactFileExistsResult[0]) {
      return exactFileBranch;
    }
    if (exactFileMasterExistsResult[0]) {
      return exactFileMaster;
    }
    if (exactFileMainExistsResult[0]) {
      return exactFileMain;
    }
  })();

  core.info(`Exact file name: ${exactFile?.name ?? "Not Found"}.`);

  if (exactFile) {
    console.log(`🙌 Found exact match from cache for key '${key}'.`);
    return [exactFile, "exact"];
  } else {
    console.log(`🔸 No exact match found for key '${key}'.`);
  }

  const restoreKey = restoreKeys[restoreKeys.length - 1];
  const branchFiles = restoreFromRepo
    ? Promise.resolve([])
    : bucket
        .getFiles({
          prefix: `${folderPrefix}/${branch}/${restoreKey}`,
        })
        .then(([files]) => files);

  const masterFiles = isPR
    ? Promise.resolve([])
    : Promise.all([
        bucket.getFiles({
          prefix: `${folderPrefix}/${masterBranch}/${restoreKey}`,
        }),
        bucket.getFiles({
          prefix: `${folderPrefix}/${mainBranch}/${restoreKey}`,
        }),
      ]).then(([[masterFiles], [mainFiles]]) => [...masterFiles, ...mainFiles]);

  const [branchCandidates, masterCandidates] = await Promise.all([
    branchFiles,
    masterFiles,
  ]).catch((err) => {
    core.error("Failed to list cache candidates");
    throw err;
  });

  const bucketFiles = [...branchCandidates, ...masterCandidates].sort(
    (a, b) =>
      new Date(b.metadata.updated as ObjectMetadata["updated"]).getTime() -
      new Date(a.metadata.updated as ObjectMetadata["updated"]).getTime()
  );

  for (const restoreKey of restoreKeys) {
    const foundFile = bucketFiles.find(
      (file) =>
        file.name.startsWith(`${folderPrefix}/${branch}/${restoreKey}`) ||
        file.name.startsWith(`${folderPrefix}/${masterBranch}/${restoreKey}`) ||
        file.name.startsWith(`${folderPrefix}/${mainBranch}/${restoreKey}`)
    );

    if (foundFile) {
      console.log(`🤝 Found match from cache for restore key '${restoreKey}'.`);
      return [foundFile, "partial"];
    } else {
      console.log(
        `🔸 No cache candidate found for restore key '${restoreKey}'.`
      );
    }
  }

  return [null, "none"];
}

export async function restore({
  path,
  key,
  restoreKeys,
  restoreFromRepo,
  workingDirectory,
}: {
  path: string[];
  key: string;
  restoreKeys: string[];
  restoreFromRepo?: string;
  workingDirectory?: string;
}) {
  const bucket = new Storage().bucket(BUCKET);

  const folderPrefix = `${github.context.repo.owner}/${
    restoreFromRepo || github.context.repo.repo
  }`;

  const branch = restoreFromRepo
    ? mockedBranchToForceCacheMiss
    : github.context.ref;

  const exactFileName = `${folderPrefix}/${branch}/${key}.tar`;

  const finishedLookup = Timer.start(
    "Searching the best cache archive available",
    "🔍"
  );

  const [bestMatch, bestMatchKind] = await getBestMatch({
    bucket,
    key,
    restoreKeys,
    restoreFromRepo,
    folderPrefix,
    branch,
    isPR: Boolean(github.context.payload.pull_request),
  });

  finishedLookup();

  core.info(`Best match kind: ${bestMatchKind}.`);

  if (!bestMatch) {
    saveState({
      path: path,
      cacheHitKind: "none",
      targetFileName: exactFileName,
      restoreFromRepo,
    });
    console.log("😢 No cache candidate found.");
    return;
  }

  core.info(`Best match name: ${bestMatch.name}.`);

  const finishedMetadata = Timer.start("Getting cache match metadata");
  const bestMatchMetadata = await bestMatch
    .getMetadata()
    .then(([metadata]) => metadata as unknown as ObjectMetadata)
    .catch((err) => {
      core.error("Failed to read object metadatas");
      throw err;
    });
  finishedMetadata();

  const compressionMethod =
    bestMatchMetadata?.metadata?.["Cache-Action-Compression-Method"];

  if (!bestMatchMetadata || !compressionMethod) {
    saveState({
      path: path,
      cacheHitKind: "none",
      targetFileName: exactFileName,
      restoreFromRepo,
    });

    console.log("😢 No cache candidate found (missing metadata).");
    return;
  }

  const workingDirectoryRoot = process.env.WORKING_DIRECTORY ?? process.cwd();
  const workspace = workingDirectory
    ? `${workingDirectoryRoot}/${workingDirectory}`
    : workingDirectoryRoot;

  core.info(
    `gcloud-cache working directory is ${process.env.WORKING_DIRECTORY}`
  );

  return withTemporaryFile(async (tmpFile) => {
    const finishedDownload = Timer.start(
      "Download cache archive from bucket",
      "🌐"
    );
    console.log(`🔹 Downloading file '${bestMatch.name}'...`);

    await bestMatch
      .download({
        destination: tmpFile.path,
      })
      .catch((err) => {
        core.error("Failed to download the file");
        throw err;
      });

    finishedDownload();

    const finishedExtract = Timer.start("Extract cache archive", "🗜️");
    await extractTar(tmpFile.path, compressionMethod, workspace).catch(
      (err) => {
        core.error("Failed to extract the archive");
        throw err;
      }
    );
    finishedExtract();

    saveState({
      path: path,
      cacheHitKind: bestMatchKind,
      targetFileName: exactFileName,
      restoreFromRepo,
    });
    console.log("✅ Successfully restored cache.");
    return key;
  });
}
