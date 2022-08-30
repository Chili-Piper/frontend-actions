const core = require('@actions/core');
import libsodium from 'libsodium-wrappers'
import fetch from 'node-fetch';

const token = core.getInput('token');
const name = core.getInput('name');
const value = core.getInput('value');

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

const getPublicKey = async () => {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`,
    {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`
        }
    });

    const json = await response.json();

    console.log('public key: ', json)

    return json;
}

const setSecretRequest = async (repoPublicKeyId, secretName, encryptedSecretValue) => fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${secretName}`,
{
    method: 'PUT',
    headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
        encrypted_value: encryptedSecretValue,
        key_id: repoPublicKeyId
    })
})

const setSecret = async (secretName, secretValue) => {
    const {key_id, key} = await getPublicKey(repo)
    const encryptedSecretValue = encrypt(key, secretValue);

    await setSecretRequest(repo, key_id, secretName, encryptedSecretValue)
}

setSecret(name, value)