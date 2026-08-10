import zh from './zh.js';
import en from './en.js';

const EN_EXACT = new Map([
  ['请求过于频繁，请稍后再试', 'Too many requests. Please try again later.'],
  ['对象路径无效', 'Invalid object path.'],
  ['S3 Bucket 未配置', 'S3 bucket is not configured.'],
  ['S3 配置不完整', 'S3 configuration is incomplete.'],
  ['D1 数据库未绑定，请检查 Worker 的 db binding', 'D1 database binding is missing.'],
  ['KV 数据库未绑定，请检查 Worker 的 kv binding', 'KV namespace binding is missing.'],
  ['JWT_SECRET 未配置或长度不足，请在 Cloudflare Worker Secrets 中设置 jwt_secret（至少32个字符）', 'JWT secret is missing or too short. Configure jwt_secret as a Worker secret with at least 32 characters.'],
  ['Turnstile 密钥未配置', 'Turnstile secret is not configured.'],
  ['Turnstile 验证服务暂时不可用', 'Turnstile verification is temporarily unavailable.'],
  ['Turnstile 返回格式错误', 'Turnstile returned an invalid response.'],
  ['Turnstile hostname 校验失败', 'Turnstile hostname validation failed.'],
  ['Turnstile action 校验失败', 'Turnstile action validation failed.'],
  ['推送订阅 ID 格式无效', 'Invalid push subscription ID.'],
  ['推送订阅密钥格式无效', 'Invalid push subscription secret.'],
  ['客户端账户标识格式无效', 'Invalid client account identifier.'],
  ['客户端安装标识格式无效', 'Invalid client installation identifier.'],
  ['推送订阅不存在', 'Push subscription not found.'],
  ['数据库未初始化 Database not initialized.', 'Database is not initialized.'],
  ['数据库未初始化。', 'Database is not initialized.'],
  ['设置参数格式错误', 'Invalid settings payload.'],
  ['背景文件必须是图片', 'Background file must be an image.'],
  ['背景图片不能超过10MB', 'Background image must not exceed 10 MB.'],
  ['身份名称已存在', 'Role name already exists.'],
  ['默认身份不可用，无法删除', 'The default role cannot be deleted.'],
  ['权限列表包含不存在的权限', 'The permission list contains unknown permissions.'],
  ['Linux DO 登录未开启', 'Linux DO sign-in is disabled.'],
  ['Linux DO OAuth 配置不完整', 'Linux DO OAuth configuration is incomplete.'],
  ['OAuth state 无效或已过期', 'OAuth state is invalid or expired.'],
  ['绑定凭证无效或已过期', 'Binding credential is invalid or expired.'],
  ['绑定凭证已使用或已过期', 'Binding credential has already been used or expired.'],
  ['OAuth 用户不存在或已过期', 'OAuth user does not exist or has expired.'],
  ['用户已绑定邮箱', 'The user is already bound to an email account.'],
  ['邮箱账户创建失败', 'Failed to create the email account.'],
  ['该 OAuth 用户已被绑定', 'This OAuth user has already been bound.'],
  ['Linux DO OAuth 授权失败', 'Linux DO OAuth authorization failed.'],
  ['Linux DO OAuth 返回无效', 'Linux DO OAuth returned an invalid response.'],
  ['Linux DO 用户信息获取失败', 'Failed to retrieve Linux DO user information.'],
  ['Linux DO 账户当前不可用于登录', 'This Linux DO account cannot currently sign in.'],
  ['Linux DO 信任等级不足', 'Linux DO trust level is insufficient.'],
  ['系统管理员账户不可执行此操作', 'This operation is not allowed for the system administrator account.'],
  ['时区格式错误', 'Invalid time zone.'],
  ['缓存键无效', 'Invalid cache key.'],
  ['注册码过期时间格式错误', 'Invalid invite-code expiration time.'],
  ['list格式错误', 'Invalid list payload.'],
  ['单次最多导入100个用户', 'At most 100 users can be imported at once.'],
  ['用户数据格式错误', 'Invalid user data.'],
  ['收件人、抄送和密送总数不能超过100', 'The total number of To, CC, and BCC recipients must not exceed 100.'],
  ['附件格式错误', 'Invalid attachment format.'],
  ['邮件发送失败', 'Failed to send email.'],
  ['单个附件不能超过10MB', 'A single attachment must not exceed 10 MB.'],
  ['附件内容不是有效的Base64', 'Attachment content is not valid Base64.'],
  ['附件内容格式错误', 'Invalid attachment content format.'],
  ['匹配类型无效', 'Invalid match type.'],
  ['时间范围无效', 'Invalid time range.'],
  ['开始时间不能晚于结束时间', 'Start time must not be later than end time.'],
  ['至少提供一个删除条件', 'At least one deletion condition is required.'],
  ['附件总大小不能超过25MB', 'Total attachment size must not exceed 25 MB.'],
  ['附件存储路径无效', 'Invalid attachment storage path.'],
  ['内嵌图片数量或大小超限', 'Inline image count or size exceeds the limit.'],
  ['附件删除字段无效', 'Invalid attachment deletion field.'],
  ['请先配置 Telegram Bot Token', 'Configure a Telegram Bot Token first.'],
  ['请先配置有效的 Telegram Chat ID', 'Configure a valid Telegram Chat ID first.'],
  ['CSRF validation failed', 'CSRF validation failed.']
]);

const RESOURCE_EN_EXACT = new Map(
  Object.keys(zh)
    .filter(key => typeof zh[key] === 'string' && typeof en[key] === 'string')
    .map(key => [zh[key], en[key]])
);

const ZH_EXACT = new Map([
  ['数据库未初始化 Database not initialized.', '数据库未初始化。'],
  ['KV数据库未绑定 KV database not bound', 'KV 数据库未绑定。'],
  ['D1数据库未绑定 D1 database not bound', 'D1 数据库未绑定。'],
  ['服务器内部错误 Internal server error', '服务器内部错误']
]);

const FIELD_NAMES = new Map([
  ['参数', 'Parameter'], ['验证码', 'Verification token'], ['列表', 'List'], ['域名', 'Domain'],
  ['收件人', 'Recipient'], ['附件', 'Attachment'], ['图片', 'Image'], ['注册码', 'Invite code'],
  ['邮箱', 'Email'], ['用户名', 'Username'], ['密码', 'Password']
]);

function language(c) {
  const raw = String(c?.req?.header?.('accept-language') || '').toLowerCase();
  return raw.startsWith('en') ? 'en' : 'zh';
}

function translateField(value) {
  const raw = String(value || '').trim();
  return FIELD_NAMES.get(raw) || (/[\u3400-\u9fff]/.test(raw) ? 'Field' : raw || 'Field');
}

function englishPattern(message) {
  let match = message.match(/^邮箱名至少(\d+)位$/);
  if (match) return `Email local-part must be at least ${match[1]} characters.`;
  match = message.match(/^(.+?)不能为空$/);
  if (match) return `${translateField(match[1])} is required.`;
  match = message.match(/^(.+?)格式错误$/);
  if (match) return `Invalid ${translateField(match[1]).toLowerCase()} format.`;
  match = message.match(/^(.+?)长度不能超过(\d+)$/);
  if (match) return `${translateField(match[1])} must not exceed ${match[2]} characters.`;
  match = message.match(/^(.+?)数量不能超过(\d+)$/);
  if (match) return `${translateField(match[1])} count must not exceed ${match[2]}.`;
  match = message.match(/^(.+?)必须是(\d+)到(\d+)之间的整数$/);
  if (match) return `${translateField(match[1])} must be an integer between ${match[2]} and ${match[3]}.`;
  match = message.match(/^(.+?)取值无效$/);
  if (match) return `Invalid ${translateField(match[1]).toLowerCase()} value.`;
  match = message.match(/^(.+?)中包含无效域名$/);
  if (match) return `${translateField(match[1])} contains an invalid domain.`;
  match = message.match(/^(.+?)仅支持HTTP\(S\)$/);
  if (match) return `${translateField(match[1])} supports HTTP(S) only.`;
  match = message.match(/^(.+?)不能包含用户名或密码$/);
  if (match) return `${translateField(match[1])} must not contain a username or password.`;
  match = message.match(/^(.+?)不能指向本地或私有网络$/);
  if (match) return `${translateField(match[1])} must not point to a local or private network.`;
  match = message.match(/^单个(.+?)不能超过10MB$/);
  if (match) return `A single ${translateField(match[1]).toLowerCase()} must not exceed 10 MB.`;
  match = message.match(/^(.+?)总大小不能超过25MB$/);
  if (match) return `Total ${translateField(match[1]).toLowerCase()} size must not exceed 25 MB.`;
  return null;
}

export function localizeErrorMessage(c, input, status = 400) {
  const message = String(input || '').trim();
  if (!message) return language(c) === 'en' ? 'Request failed.' : '请求失败。';
  if (language(c) !== 'en') return ZH_EXACT.get(message) || message;
  const exact = RESOURCE_EN_EXACT.get(message) || EN_EXACT.get(message);
  if (exact) return exact;
  const pattern = englishPattern(message);
  if (pattern) return pattern;
  // Never leak a Chinese-only internal validation string into the English API contract.
  if (/[\u3400-\u9fff]/.test(message)) {
    return Number(status) >= 500 ? 'Service temporarily unavailable.' : 'Invalid request.';
  }
  return message;
}
