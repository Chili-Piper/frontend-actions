const core = require("@actions/core");
const github = require("@actions/github");

const updateDescription = async () => {
  try {
    const inputs = {
      branchRegExp: core.getInput("head-branch-regex"),
      bodyTemplate: core.getInput("body-template") || "",
      bodyTemplateRegExp: core.getInput("body-template-regex") || "",
      bodyFooterTemplate: core.getInput("body-footer-templage") || "",
      bodyFooterRegex: core.getInput("body-footer-regexp") || "",
    };

    const headTokenRegex = new RegExp("%headbranch%", "g");
    const headBranchName = github.context.payload.pull_request.head.ref;

    core.info(`Head branch name: ${headBranchName}`);

    const headMatches = headBranchName.match(
      new RegExp(inputs.branchRegExp.trim(), "i")
    );
    if (!headMatches) {
      core.setFailed("Head branch name does not match given regex");
      return;
    }

    const headToken = headMatches[0];
    core.info(`Matched head branch text: ${headToken}`);

    core.setOutput("Match", headToken);

    const request = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: github.context.payload.pull_request.number,
    };

    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
    // Getting actual PR data to have updated description on rerun a job
    const pullRequestResponse = await octokit.rest.pulls.get(request);

    const body = pullRequestResponse.data.body || "";

    const bodyPrefixRegexp = new RegExp(
      `^${inputs.bodyTemplateRegExp
        .trim()
        .replace(headTokenRegex, headToken)}.*`
    );
    const bodyFooterRegexp = new RegExp(
      `.*${inputs.bodyFooterRegex
        .trim()
        .replace(headTokenRegex, headToken)}\s*$`
    );
    const shouldAddPrefix = !bodyPrefixRegexp.test(body);
    const shouldAddFooter = !bodyFooterRegexp.test(body);
    core.debug(
      `need update, bodyPrefixRegexp: ${bodyPrefixRegexp}, shouldAddPrefix: ${shouldAddPrefix}, bodyFooterRegexp: ${bodyFooterRegexp}, shoudAddFooter: ${shouldAddFooter}, body: ${body}`
    );

    if (shouldAddPrefix) {
      request.body = inputs.bodyTemplate
        .replace(headTokenRegex, headToken)
        .concat("\n\n", body);
    }
    if (shouldAddFooter) {
      request.body = request.body.concat(
        "\n\n",
        inputs.bodyFooterTemplate.replace(headTokenRegex, headToken)
      );
    }

    if (shouldAddFooter || shouldAddPrefix) {
      core.debug(`New body: ${request.body}`);
    } else {
      core.warning("No updates were made to PR body");
      return;
    }

    const response = await octokit.rest.pulls.update(request);

    if (response.status !== 200) {
      core.error("Updating the pull request has failed");
    }
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
};

updateDescription();
