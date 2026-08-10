import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const setting = fs.readFileSync(path.join(root, 'src/service/setting-service.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '../.github/workflows/_deploy-cloudflare.yml'), 'utf8');

assert.match(setting, /encryptSettingSecrets/);
assert.match(setting, /decryptSettingSecrets/);
assert.match(setting, /KV stores the same encrypted envelopes as D1/);
assert.match(setting, /encryptConfigSecret\(c\.env\.config_encryption_key/);
assert.doesNotMatch(setting, /JSON\.stringify\(row\).*KvConst\.SETTING/s);
assert.match(workflow, /CONFIG_ENCRYPTION_KEY/);
assert.match(workflow, /config_encryption_key_previous/);

console.log('✅ D1/KV encrypted integration-secret storage contract PASS');
