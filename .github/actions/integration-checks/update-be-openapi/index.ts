import fs from "node:fs";
import path from "node:path";
import { info, getInput, setFailed } from "@actions/core";
import * as yaml from "js-yaml";

async function run() {
  try {
    const backendVersionsJSON = getInput("backend");
    const backendVersions = (yaml.load(backendVersionsJSON) ?? {}) as Record<
      string,
      string
    >;

    Object.keys(backendVersions).forEach((inputService) => {
      const inputValue = backendVersions[inputService];

      if (typeof inputValue !== "object") {
        return;
      }

      const openApiJSON = JSON.stringify(inputValue);
      info(`Found OpenApi JSON for ${inputService}`);

      const docPath = path.join(
        "frontend-packages",
        "api-client",
        "docs",
        `${inputService}.json`
      );

      fs.writeFileSync(docPath, openApiJSON);

      info(`Updated OpenApi JSON for ${inputService}.json`);
    });
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
