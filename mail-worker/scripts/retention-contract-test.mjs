import fs from 'node:fs';
const migration=fs.readFileSync(new URL('../migrations/0002_retention.sql', import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../src/service/email-service.js', import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../src/index.js', import.meta.url),'utf8');
for (const token of ['deleted_at TEXT','trg_email_soft_delete_timestamp','trg_email_restore_clear_timestamp']) if(!migration.includes(token)) throw new Error(token);
for (const token of ['cleanupRetention(c)','email_trash_retention_days','deleted_at < datetime']) if(!service.includes(token)) throw new Error(token);
if(!index.includes('emailService.cleanupRetention({ env })')) throw new Error('scheduled retention missing');
console.log('✅ Worker Trash retention timestamp/configuration/cleanup contract PASS');
