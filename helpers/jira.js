const core = require('@actions/core');
const JiraApi = require('jira-client')

const username = core.getInput('jira_username');
const password = core.getInput('jira_password');

const jira = new JiraApi({
    protocol: 'https',
    host: 'floatingapps.atlassian.net',
    // https://id.atlassian.com/manage-profile/email
    username,
    // https://id.atlassian.com/manage-profile/security/api-tokens
    password,
    apiVersion: '2',
    strictSSL: true,
})

module.exports = {
    jira
}