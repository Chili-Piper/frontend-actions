const core = require('@actions/core');
const github = require('@actions/github');

const updateDescription = async () => {
    try {
        const headTokenRegex = new RegExp('%headbranch%', "g");

        const inputs = {
            branchRegExp: core.getInput('head-branch-regex'),
            bodyTemplate: core.getInput('body-template'),
            bodyTemplateRegExp: core.getInput('body-template-regex'),
        }

        const branchRegExp = inputs.branchRegExp.trim();

        const headBranchName = github.context.payload.pull_request.head.ref;
        core.info(`Head branch name: ${headBranchName}`);

        const headMatches = headBranchName.match(new RegExp(branchRegExp, 'i'));
        if (!headMatches) {
            core.setFailed('Head branch name does not match given regex');
            return;
        }

        const match = headMatches[0];
        core.info(`Matched head branch text: ${match}`);

        core.setOutput('Match', match);

        const request = {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            pull_number: github.context.payload.pull_request.number,
        }

        const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
        // Getting actual PR data to have updated description on rerun a job
        const pullRequest = await octokit.rest.pulls.get(request);

        const body = pullRequest.body || '';

        const processedBodyTemplateRegExpString = inputs.bodyTemplateRegExp.trim().replace(headTokenRegex, match) + '.*'
        const processedBodyTemplateRegExp = new RegExp(processedBodyTemplateRegExpString)
        const needUpdate = !processedBodyTemplateRegExp.test(body)
        core.debug(`need update, ${needUpdate}, ${processedBodyTemplateRegExpString}, ${body}`)

        if (needUpdate) {
            request.body = inputs.bodyTemplate.replace(headTokenRegex, match).concat('\n\n', body);
            core.debug(`New body: ${request.body}`);
        } else {
            core.warning('No updates were made to PR body');
            return;
        }

        const response = await octokit.rest.pulls.update(request);

        if (response.status !== 200) {
            core.error('Updating the pull request has failed');
        }
    }
    catch (error) {
        core.error(error);
        core.setFailed(error.message);
    }
}

updateDescription()
