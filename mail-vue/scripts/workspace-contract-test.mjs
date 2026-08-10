import fs from 'node:fs';

const router = fs.readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
const perms = fs.readFileSync(new URL('../src/perm/perm.js', import.meta.url), 'utf8');
const aside = fs.readFileSync(new URL('../src/layout/aside/index.vue', import.meta.url), 'utf8');

const requiredMail = ['/mail/inbox', '/mail/message', '/mail/settings', '/mail/starred'];
const requiredAdmin = ['/admin/users', '/admin/roles', '/admin/system-settings', '/admin/invite-codes', '/admin/all-mail', '/admin/analysis'];
for (const path of requiredMail) {
  if (!router.includes(`path: '${path}'`)) throw new Error(`missing mail workspace route ${path}`);
}
for (const path of requiredAdmin) {
  if (!perms.includes(`path: '${path}'`)) throw new Error(`missing admin workspace route ${path}`);
}
for (const legacy of ['/inbox', '/message', '/settings', '/starred', '/all-users', '/role', '/system-setting', '/invite-code', '/all-mail', '/analysis']) {
  if (!(router + perms).includes(`alias: '${legacy}'`)) throw new Error(`legacy route alias missing ${legacy}`);
}
if (!router.includes("workspace: 'mail'")) throw new Error('mail workspace metadata missing');
if (!perms.includes("workspace: 'admin'")) throw new Error('admin workspace metadata missing');
for (const token of ['currentWorkspace', 'openMailWorkspace', 'openAdminWorkspace', 'workspace-switch']) {
  if (!aside.includes(token)) throw new Error(`workspace shell missing ${token}`);
}
console.log('PASS: CloudMail Web and Admin use explicit route namespaces and workspace navigation with legacy aliases.');
