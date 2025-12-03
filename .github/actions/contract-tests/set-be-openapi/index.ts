import fs from "node:fs";
import path from "node:path";
import { info, getInput, setFailed } from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";
import * as yaml from "js-yaml";

const artifact = new DefaultArtifactClient();

async function run() {
  try {
    const apiClientSourcePath = getInput("api_client_source_path");
    const backendVersionsJSON = getInput("backend");
    const backendVersions = (yaml.load(backendVersionsJSON) ?? {}) as Record<
      string,
      string
    >;

    Object.keys(backendVersions).forEach(async (inputService) => {
      const inputValue = backendVersions[inputService];

      if (!inputValue.startsWith("/")) {
        return;
      }

      const trimmedServiceName = inputService.replace("-service", "");
      info(`Found OpenApi JSON for ${trimmedServiceName}`);

      const docPath = path.join(
        apiClientSourcePath,
        "frontend-packages",
        "api-client",
        "docs",
        `${trimmedServiceName}.json`
      );

      fs.cpSync(inputValue, docPath);

      info(`Updated OpenApi JSON for ${trimmedServiceName}.json`);

      const artifactName = "debug-logs";
      const files = [docPath];
      const options = {};

      const { id, size } = await artifact.uploadArtifact(
        artifactName,
        files,
        ".",
        options
      );

      info(`Created artifact with id: ${id} (bytes: ${size}`);
    });
  } catch (error: any) {
    setFailed(error.message);
  }
}

run();
