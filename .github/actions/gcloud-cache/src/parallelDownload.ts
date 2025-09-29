import { File } from "@google-cloud/storage";
import fs from "fs";
import path from "path";
import https from "https";
import pLimit from "p-limit";

https.globalAgent.maxSockets = Infinity;

export type FastDownloadOpts = {
  chunkSize?: number; // default 64 MiB
  concurrency?: number; // default 12
  maxRetries?: number; // default 3
  decompress?: boolean; // default false
  perChunkValidation?: boolean | "crc32c"; // default false (faster)
};

async function ensureDir(destPath: string) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
}

export async function parallelDownload(
  gcsFile: File,
  destination: string,
  opts: FastDownloadOpts = {}
) {
  const {
    chunkSize = 64 * 1024 * 1024, // 64 MiB
    concurrency = 12,
    maxRetries = 3,
    decompress = false,
    perChunkValidation = false,
  } = opts;

  const [meta] = await gcsFile.getMetadata();
  const total = Number(meta.size);
  if (!Number.isFinite(total)) throw new Error("Unknown object size");

  await ensureDir(destination);

  // Preallocate destination so ranged writes succeed
  const fd = await fs.promises.open(destination, "w");
  await fd.truncate(total);
  await fd.close();

  // Build ranges
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(start + chunkSize, total) - 1;
    ranges.push({ start, end });
  }

  const limit = pLimit(concurrency);

  await Promise.all(
    ranges.map(({ start, end }) =>
      limit(async () => {
        let attempt = 0;
        while (true) {
          try {
            await new Promise<void>((resolve, reject) => {
              const rs = gcsFile.createReadStream({
                start,
                end,
                decompress,
                validation: perChunkValidation,
                // @ts-expect-error
                highWaterMark: 1 << 20, // 1 MiB
              });

              const ws = fs.createWriteStream(destination, {
                flags: "r+",
                start,
                highWaterMark: 1 << 20,
              } as any);

              rs.on("error", reject);
              ws.on("error", reject);
              ws.on("finish", resolve);
              rs.pipe(ws);
            });
            return;
          } catch (err) {
            attempt++;
            if (attempt > maxRetries) throw err;
            await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)));
          }
        }
      })
    )
  );
}
