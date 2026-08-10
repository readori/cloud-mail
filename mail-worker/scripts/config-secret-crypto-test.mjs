import assert from 'node:assert/strict';
import {
  decryptConfigSecret,
  decryptSettingSecrets,
  encryptConfigSecret,
  encryptSettingSecrets,
  isEncryptedConfigSecret
} from '../src/utils/config-secret-crypto.js';

const current = 'current-config-encryption-key-0123456789abcdef';
const previous = 'previous-config-encryption-key-0123456789abcdef';
const legacy = {
  secretKey: 'turnstile-secret-value',
  tgBotToken: '123456:telegram-bot-token',
  resendTokens: JSON.stringify({ 'example.com': 're_example_secret' }),
  s3AccessKey: 'AKIAEXAMPLE',
  s3SecretKey: 's3-secret-example'
};

const migrated = await encryptSettingSecrets({ config_encryption_key: current }, legacy);
assert.equal(migrated.changed, true);
for (const field of Object.keys(legacy)) {
  assert.equal(isEncryptedConfigSecret(migrated.row[field]), true, `${field} must be encrypted`);
  assert.equal(migrated.row[field].includes(legacy[field]), false, `${field} ciphertext must not contain plaintext`);
}
assert.deepEqual(await decryptSettingSecrets({ config_encryption_key: current }, migrated.row), legacy);

const oldEnvelope = await encryptConfigSecret(previous, 'secretKey', 'rotate-me');
const rotated = await encryptSettingSecrets({
  config_encryption_key: current,
  config_encryption_key_previous: previous
}, { ...legacy, secretKey: oldEnvelope });
assert.equal(rotated.changed, true);
assert.notEqual(rotated.row.secretKey, oldEnvelope);
assert.equal((await decryptConfigSecret(current, previous, 'secretKey', rotated.row.secretKey)).plaintext, 'rotate-me');

await assert.rejects(
  () => decryptConfigSecret('x'.repeat(40), '', 's3SecretKey', migrated.row.secretKey),
  /Unable to decrypt/
);

const empty = await encryptSettingSecrets({ config_encryption_key: current }, {
  secretKey: '', tgBotToken: '', resendTokens: '{}', s3AccessKey: '', s3SecretKey: ''
});
assert.equal(empty.changed, false);
assert.equal(empty.row.resendTokens, '{}');

console.log('✅ config secret AES-GCM migration + rotation contract PASS');
