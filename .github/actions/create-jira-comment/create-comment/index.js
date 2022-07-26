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

const jiraTicket = core.getInput('jira_ticket');
const cloudrunLink = core.getInput('cloudrun_link');
const projectName = core.getInput('project_name');

jira.getComments(jiraTicket).then(({ comments }) => {
    const commentsBody = comments.map(comment => comment.body)

    const comment = `Cloudrun Link to run ${projectName}: ${cloudrunLink}`

    console.log('comment', comment)
    console.log('commentsBody', commentsBody)

    if (commentsBody.includes(comment)) {
        console.log('Comment with URL exists')
    } else {
        jira.addComment(jiraTicket, comment)
    }
})