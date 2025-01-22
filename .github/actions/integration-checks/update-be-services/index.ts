import fs from "node:fs";
import path from "node:path";
import { info, getInput, setFailed } from "@actions/core";

async function run() {
  try {
    const servicesFilePath = path.join(
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
    const services = JSON.parse(fileContent);

    const backendVersions = getInput("backend");
    console.log("backendVersions", backendVersions);

    fs.writeFileSync(servicesFilePath, JSON.stringify(services, null, 2));
    info("services.json content updated:");
    info(fileContent);
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
