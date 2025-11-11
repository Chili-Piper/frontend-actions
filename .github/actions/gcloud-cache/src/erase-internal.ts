import * as core from "@actions/core";
import { Storage } from "@google-cloud/storage";

import { BUCKET } from "./constants";
import { Timer } from "./shared";

export async function eraseInternal({ branchPath }: { branchPath: string }) {
  const bucket = new Storage().bucket(BUCKET);

  console.log(
    `🧹 Deleting cache objects under 'gs://${BUCKET}/${branchPath}'...`
  );

  console.log(
    `🧹 Deleting cache objects under 'gs://${BUCKET}/${branchPath}'...`
  );

  const finished = Timer.start("Delete cache objects from bucket", "🗑️");
  try {
    // Deletes all objects with the prefix. `versions: true` ensures complete cleanup if object versioning is on.
    await bucket.deleteFiles({
      prefix: branchPath,
      force: true,
    });
    finished();
    console.log("✅ Finished deleting cache objects.");
  } catch (err) {
    finished();
    core.error(`Failed to delete objects under prefix '${branchPath}'`);
    throw err;
  }
}
