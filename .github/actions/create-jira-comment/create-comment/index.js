const core = require('@actions/core');
const { jira } = require('./helpers/atlassian')

const jiraTicket = core.getInput('jira_ticket');
const cloudrunLink = core.getInput('cloudrunLink');
const projectName = core.getInput('projectName');

const { comments } = await jira.getComments(jiraTicket).catch(onError)
const commentsBody = comments.map(comment => comment.body)

const comment = `Cloudrun Link to run ${projectName}: ${cloudrunLink}`

console.log('comment', comment)
console.log('commentsBody', commentsBody)

if (commentsBody.includes(comment)) {
    console.log('Comment with URL exists')
} else {
    jira.addComment(jiraTicket, comment).catch(onError)
}