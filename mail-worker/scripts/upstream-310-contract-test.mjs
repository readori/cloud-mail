import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('migrations/0005_sync_delete.sql');
const init = read('src/init/init.js');
const entity = read('src/entity/setting.js');
const constants = read('src/const/entity-const.js');
const settingService = read('src/service/setting-service.js');
const emailService = read('src/service/email-service.js');
const accountService = read('src/service/account-service.js');
const userService = read('src/service/user-service.js');
const aiService = read('src/service/ai-service.js');
const deployWorkflow = read('../.github/workflows/_deploy-cloudflare.yml');

const must = (ok, msg) => { if (!ok) throw new Error(msg); };

must(init.includes('async v3_9DB(c)'), 'protected init must include the upstream 3.1 compatibility bridge');
must(init.includes('ALTER TABLE setting ADD COLUMN sync_delete INTEGER NOT NULL DEFAULT 1'), 'legacy databases must gain sync_delete with safe OFF default (1)');
must(init.includes("message.includes('duplicate column')"), 'upstream 3.1 databases with an existing sync_delete column must be accepted');
must(!migration.includes('ALTER TABLE setting ADD COLUMN sync_delete'), 'versioned marker must not duplicate ALTER against upstream 3.1 databases');
const initStep = deployWorkflow.indexOf('name: Initialize or migrate database');
const migrationStep = deployWorkflow.indexOf('name: Apply versioned D1 integrity migrations');
must(initStep >= 0 && migrationStep > initStep, 'deployment must run protected compatibility init before versioned D1 migrations');
must(migration.includes("'upstream_cloud_mail', '3.1.0'"), 'migration must record the upstream 3.1 baseline');
must(entity.includes("syncDelete: integer('sync_delete').default(1).notNull()"), 'setting schema missing safe syncDelete default');
must(constants.includes('syncDelete:') && constants.includes('OPEN: 0') && constants.includes('CLOSE: 1'), 'syncDelete constants missing');
must(settingService.includes("'aiCodeFilter', 'syncDelete'") && settingService.includes("'aiCode', 'syncDelete'"), 'syncDelete setting validation/persistence missing');
must(emailService.includes('syncDelete === settingConst.syncDelete.OPEN') && emailService.includes('eq(email.userId, uid)'), 'email permanent delete must be opt-in and ownership-scoped');
must(accountService.includes('syncDelete === settingConst.syncDelete.OPEN'), 'account sync delete missing');
must(userService.includes('syncDelete === settingConst.syncDelete.OPEN'), 'user sync delete missing');
must(aiService.includes('@cf/meta/llama-3.1-8b-instruct-fast'), 'Workers AI fast model baseline missing');
must(deployWorkflow.includes('@cf/meta/llama-3.1-8b-instruct-fast'), 'deployment default must use the upstream 3.1 fast AI model');
must(!aiService.includes("'@cf/meta/llama-3.1-8b-instruct'"), 'deprecated Workers AI model remains');

console.log('✅ Cloud-Mail upstream 3.1 Worker compatibility contract PASS');
