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
    const services = JSON.parse(fileContent) as Record<
      string,
      { version: `v${string}` }
    >;

    const backendVersionsJSON = getInput("backend");
    const backendVersions = yaml.load(backendVersionsJSON) as Record<
      string,
      string
    >;

    Object.keys(backendVersions).forEach((inputService) => {
      const serviceInfo = services[inputService];
      if (!serviceInfo) {
        setFailed(
          `${inputService} not found in services.json. Must be one of: [${Object.keys(
            services
          ).join(", ")}]`
        );
        return;
      }

      const newVersion = `v${backendVersions[inputService]}`;

      if (newVersion !== serviceInfo.version) {
        info(`Setting ${inputService} version to ${newVersion}`);
        services[inputService].version = `v${newVersion}`;
      }
    });

    fs.writeFileSync(servicesFilePath, JSON.stringify(services, null, 2));
    info("services.json content updated!");
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
