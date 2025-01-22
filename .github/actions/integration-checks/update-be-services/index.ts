import fs from "node:fs";
import path from "node:path";
import { info, getInput, setFailed } from "@actions/core";

async function run() {
  try {
    const checkoutPath = getInput("checkout_path");
    const servicesFilePath = path.join(
      checkoutPath,
      "frontend-packages",
      "api-client",
      "src",
      "services.json"
    );

    if (!fs.existsSync(servicesFilePath)) {
      setFailed(`services.json not found at ${servicesFilePath}`);
      return;
    }

    const fileContent = fs.readFileSync(servicesFilePath, "utf-8");
    info("services.json content:");
    info(fileContent);
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
