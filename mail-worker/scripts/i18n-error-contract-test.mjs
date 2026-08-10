import { localizeErrorMessage } from '../src/i18n/error-message.js';
const c = lang => ({ req: { header: name => name === 'accept-language' ? lang : '' } });
const cases = [
  ['参数不能为空', 'Parameter is required.'],
  ['附件格式错误', 'Invalid attachment format.'],
  ['请求过于频繁，请稍后再试', 'Too many requests. Please try again later.'],
  ['数据库未初始化。', 'Database is not initialized.'],
  ['密码至少十位', 'Password must be at least 10 characters'],
  ['无法保存敏感配置 foo: 密钥无效', 'Service temporarily unavailable.']
];
for (const [input, expected] of cases) {
  const actual = localizeErrorMessage(c('en-US'), input, input.startsWith('无法') ? 503 : 400);
  if (actual !== expected) throw new Error(`${input} => ${actual}; expected ${expected}`);
  if (/[\u3400-\u9fff]/.test(actual)) throw new Error(`English response leaked CJK: ${actual}`);
}
if (localizeErrorMessage(c('zh-CN'), '数据库未初始化。', 503) !== '数据库未初始化。') throw new Error('Chinese canonical message changed');
const i18nSource = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/i18n/i18n.js', import.meta.url), 'utf8'));
if (i18nSource.includes("app.use('*'")) throw new Error('request language must not mutate process-global i18next state');
if (!i18nSource.includes('getFixedT')) throw new Error('request-scoped/fixed translation helper missing');
console.log('✅ Worker user-facing BizError language normalization + concurrency-safe i18n contract PASS');
