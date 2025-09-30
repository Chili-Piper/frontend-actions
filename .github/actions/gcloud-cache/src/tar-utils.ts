/* eslint-disable sonarjs/no-duplicate-string */

import * as exec from "@actions/exec";

export enum CompressionMethod {
  GZIP = "gzip",
  ZSTD = "zstd",
}

async function getTarCompressionMethod(): Promise<CompressionMethod> {
  if (process.platform === "win32") {
    return CompressionMethod.GZIP;
  }

  const [zstdOutput] = await exec
    .getExecOutput("zstd", ["--version"], {
      ignoreReturnCode: true,
      silent: true,
    })
    .then((out) => out.stdout.trim())
    .then((out) => {
      const extractedVersion = /v(\d+(?:\.\d+){0,})/.exec(out);
      return [out, extractedVersion ? extractedVersion[1] : null];
    })
    .catch(() => ["", null]);

  if (!zstdOutput?.toLowerCase().includes("zstd command line interface")) {
    return CompressionMethod.GZIP;
  } else {
    return CompressionMethod.ZSTD;
  }
}

export async function createTar(
  archivePath: string,
  paths: string[],
  cwd: string
): Promise<CompressionMethod> {
  const compressionMethod = await getTarCompressionMethod();
  console.log(`🔹 Using '${compressionMethod}' compression method.`);

  const compressionArgs =
    compressionMethod === CompressionMethod.GZIP
      ? ["-z"]
      : ["--use-compress-program", "lz4 -T0"];

  await exec.exec("tar", [
    "-c",
    ...compressionArgs,
    "--posix",
    "-P",
    "-f",
    archivePath,
    "-C",
    cwd,
    ...paths,
  ]);

  return compressionMethod;
}

export async function extractTar(
  archivePath: string,
  compressionMethod: CompressionMethod,
  cwd: string
): Promise<void> {
  console.log(
    `🔹 Detected '${compressionMethod}' compression method from object metadata.`
  );

  const compressionArgs =
    compressionMethod === CompressionMethod.GZIP
      ? ["-z"]
      : ["--use-compress-program", "lz4 -d -T0"];

  await exec.exec("tar", [
    "-x",
    ...compressionArgs,
    "-P",
    "-f",
    archivePath,
    "-C",
    cwd,
  ]);
}
