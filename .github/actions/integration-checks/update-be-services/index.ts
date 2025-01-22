import fs from "node:fs";
import path from "node:path";
import { info, getInput, setFailed } from "@actions/core";
import * as yaml from "js-yaml";

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

    const backendVersionsJSON = getInput("backend");
    const backendVersions = yaml.load(backendVersionsJSON) as Record<
      string,
      string
    >;
    console.log("backendVersions", backendVersionsJSON, backendVersions);

    fs.writeFileSync(servicesFilePath, JSON.stringify(services, null, 2));
    info("services.json content updated:");
    info(fileContent);
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
