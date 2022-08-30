const core = require('@actions/core');
const sodium = require('tweetsodium');
const Octokit = require('octokit')

const owner = 'Chili-Piper'

const token = core.getInput('token');
const repo = core.getInput('repo');
const name = core.getInput('name');
const value = core.getInput('value');

const octokit = new Octokit({
    auth: token
})

const encrypt = (repoPublicKey, secretValue) => {
    // Convert the message and key to Uint8Array's (Buffer implements that interface)
    const messageBytes = Buffer.from(secretValue);
    const keyBytes = Buffer.from(repoPublicKey, 'base64');

    // Encrypt using LibSodium.
    const encryptedBytes = sodium.seal(messageBytes, keyBytes);

    // Base64 the encrypted secret
    return Buffer.from(encryptedBytes).toString('base64');
}

const getPublicKey = (repo) => octokit.request('GET /repos/{owner}/{repo}/actions/secrets/public-key', {
        owner,
        repo
    })

const setSecretRequest = async (repo, repoPublicKey, secretName, encryptedSecretValue) => octokit.request('PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}', {
        owner,
        repo,
        secret_name: secretName,
        encrypted_value: encryptedSecretValue,
        key_id: repoPublicKey
    })

const setSecret = async (repo, secretName, secretValue) => {
    const repoPublicKey = await getPublicKey(repo)
    const encryptedSecretValue = encrypt(repoPublicKey, secretValue);

    await setSecretRequest(repo, repoPublicKey, secretName, encryptedSecretValue)
}

setSecret(repo, name, value)