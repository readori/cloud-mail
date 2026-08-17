import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const router = read('src/router/index.js');
const perm = read('src/perm/perm.js');
const list = read('src/components/email-scroll/index.vue');
const settings = read('src/views/sys-setting/index.vue');
const login = read('src/views/login/index.vue');
const content = read('src/views/content/index.vue');
const en = read('src/i18n/en.js');
const pkg = JSON.parse(read('package.json'));
const must = (ok, msg) => { if (!ok) throw new Error(msg); };

must(list.includes('MAX_SELECT_COUNT = 95'), '95-message selection limit missing');
must(list.includes(':disabled="!item.checked && isSelectMax"'), 'selection limit UI guard missing');
must(router.includes("path: '/mail'") && router.includes("redirect: '/mail/inbox'"), 'upstream /mail compatibility redirect missing');
must(router.includes("alias: '/message'"), 'legacy /message alias missing');
must(perm.includes("alias: '/system-setting'") && perm.includes("path: '/system-settings'") && perm.includes("redirect: '/admin/system-settings'"), 'system settings compatibility aliases missing');
must(settings.includes("currentVersion = 'v3.1.0'"), 'upstream 3.1 reference marker missing');
must(settings.includes('beforeSyncDeleteChange') && en.includes('syncDeleteConfirm'), 'sync delete destructive confirmation missing');
must(settings.includes('max-width: 900px') && settings.includes('flex-direction: column'), '3.1 settings layout adaptation missing');
must(login.includes('@keyup.enter="submit"') && login.includes('if (loginLoading.value) return'), 'login Enter/dedup guard missing');
must(content.includes("event.key !== 'Escape'") && content.includes("removeEventListener('keydown'"), 'mail detail Escape lifecycle guard missing');
must(pkg.packageManager === 'pnpm@9.15.9', 'r13 core integration must not silently upgrade pnpm');
console.log('✅ Cloud-Mail upstream 3.1 Web compatibility contract PASS');
