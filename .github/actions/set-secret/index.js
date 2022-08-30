const core = require('@actions/core');
const libsodium = require('libsodium-wrappers')
const fetch = require('node-fetch');

const token = core.getInput('token');
const name = core.getInput('name');
const value = core.getInput('value');

const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

const encrypt = async (repoPublicKey, secretValue) => {
    // Convert Secret & Base64 key to Uint8Array
    const binKey = libsodium.from_base64(repoPublicKey, libsodium.base64_variants.ORIGINAL)
    const binSecret = libsodium.from_string(secretValue)

    // Encrypt using LibSodium.
    await libsodium.ready
    const encryptedBytes = libsodium.crypto_box_seal(binSecret, binKey)

    // Base64 the encrypted secret
    return libsodium.to_base64(encryptedBytes, libsodium.base64_variants.ORIGINAL)
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
    const {key_id: keyId, key} = await getPublicKey(repo)
    const encryptedSecretValue = await encrypt(key, secretValue);

    await setSecretRequest(keyId, secretName, encryptedSecretValue)
}

setSecret(name, value)