const core = require('@actions/core');
import libsodium from 'libsodium-wrappers'
const { Octokit } = require("@octokit/action");

const name = core.getInput('name');
const value = core.getInput('value');

const octokit = new Octokit();
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

const encrypt = async (repoPublicKey, secretValue) => {
    // Convert the message and key to Uint8Array's (Buffer implements that interface)
    const messageBytes = Buffer.from(secretValue);
    const keyBytes = Buffer.from(repoPublicKey, 'base64');

    // Encrypt using LibSodium.
    await libsodium.ready
    const encryptedBytes = libsodium.crypto_box_seal(messageBytes, keyBytes)

    // Base64 the encrypted secret
    return Buffer.from(encryptedBytes).toString('base64');
}

const getPublicKey = () => octokit.request('GET /repos/{owner}/{repo}/actions/secrets/public-key', {
    owner,
    repo
})

const setSecretRequest = async (repoPublicKey, secretName, encryptedSecretValue) => octokit.request('PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}', {
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