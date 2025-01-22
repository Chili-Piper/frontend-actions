const fs = require('fs');
const path = require('path');
const core = require('@actions/core');

async function run() {
  try {
    const checkoutPath = core.getInput('checkout_path');
    const servicesFilePath = path.join(checkoutPath, 'frontend-packages', 'services.json');

    if (!fs.existsSync(servicesFilePath)) {
      core.setFailed(`services.json not found at ${servicesFilePath}`);
      return;
    }

    const fileContent = fs.readFileSync(servicesFilePath, 'utf-8');
    core.info('services.json content:');
    core.info(fileContent);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
