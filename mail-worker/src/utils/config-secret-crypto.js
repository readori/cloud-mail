const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PREFIX = 'enc:v1:';
const SECRET_FIELDS = Object.freeze(['secretKey', 'tgBotToken', 'resendTokens', 's3AccessKey', 's3SecretKey']);

function b64url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(value) {
	let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
	while (normalized.length % 4) normalized += '=';
	return Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
}

async function digest(value) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function keyInfo(secret) {
	if (typeof secret !== 'string' || secret.length < 32) throw new Error('CONFIG_ENCRYPTION_KEY must be at least 32 characters');
	const hash = await digest(secret);
	const key = await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
	return { key, kid: b64url(hash.slice(0, 9)) };
}

export function isEncryptedConfigSecret(value) {
	return typeof value === 'string' && value.startsWith(PREFIX);
}

export function configuredSecretFields() {
	return [...SECRET_FIELDS];
}

export async function encryptConfigSecret(secret, field, plaintext) {
	const value = String(plaintext ?? '');
	if (!value) return '';
	if (isEncryptedConfigSecret(value)) return value;
	const { key, kid } = await keyInfo(secret);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: encoder.encode(`cfmail-setting:${field}:v1`) },
		key,
		encoder.encode(value)
	);
	return `${PREFIX}${kid}:${b64url(iv)}:${b64url(new Uint8Array(ciphertext))}`;
}

async function decryptWith(secret, field, parsed) {
	const { key, kid } = await keyInfo(secret);
	if (kid !== parsed.kid) return null;
	try {
		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromB64url(parsed.iv), additionalData: encoder.encode(`cfmail-setting:${field}:v1`) },
			key,
			fromB64url(parsed.ciphertext)
		);
		return decoder.decode(plaintext);
	} catch {
		return null;
	}
}

// Compatibility parser for the exact enc:v1:<kid>:<iv>:<ciphertext> format.
function parseEnvelopeStrict(value) {
	if (!isEncryptedConfigSecret(value)) return null;
	const match = /^enc:v1:([^:]+):([^:]+):([^:]+)$/.exec(value);
	if (!match) throw new Error('Invalid encrypted setting envelope');
	return { kid: match[1], iv: match[2], ciphertext: match[3] };
}

export async function decryptConfigSecret(currentSecret, previousSecret, field, value) {
	const raw = String(value ?? '');
	if (!raw || !isEncryptedConfigSecret(raw)) return { plaintext: raw, key: raw ? 'legacy' : 'empty' };
	const parsed = parseEnvelopeStrict(raw);
	for (const [label, secret] of [['current', currentSecret], ['previous', previousSecret]]) {
		if (typeof secret !== 'string' || secret.length < 32) continue;
		const plaintext = await decryptWith(secret, field, parsed);
		if (plaintext !== null) return { plaintext, key: label };
	}
	throw new Error(`Unable to decrypt encrypted setting field: ${field}`);
}

export function hasUnprotectedSettingSecrets(row) {
	if (!row || typeof row !== 'object') return false;
	for (const field of SECRET_FIELDS) {
		const raw = String(row[field] ?? '');
		if (!raw || (field === 'resendTokens' && raw.trim() === '{}')) continue;
		if (!isEncryptedConfigSecret(raw)) return true;
	}
	return false;
}

export async function encryptSettingSecrets(env, row) {
	const current = env?.config_encryption_key;
	const previous = env?.config_encryption_key_previous;
	const encrypted = { ...row };
	let changed = false;
	for (const field of SECRET_FIELDS) {
		const raw = String(encrypted[field] ?? '');
		if (!raw || (field === 'resendTokens' && raw.trim() === '{}')) continue;
		const decoded = await decryptConfigSecret(current, previous, field, raw);
		if (decoded.key === 'current') continue;
		if (typeof current !== 'string' || current.length < 32) {
			throw new Error(`CONFIG_ENCRYPTION_KEY is required to protect setting.${field}`);
		}
		encrypted[field] = await encryptConfigSecret(current, field, decoded.plaintext);
		changed = true;
	}
	return { row: encrypted, changed };
}

export async function decryptSettingSecrets(env, row) {
	const current = env?.config_encryption_key;
	const previous = env?.config_encryption_key_previous;
	const decrypted = { ...row };
	for (const field of SECRET_FIELDS) {
		const raw = String(decrypted[field] ?? '');
		if (!raw) continue;
		const decoded = await decryptConfigSecret(current, previous, field, raw);
		decrypted[field] = decoded.plaintext;
	}
	return decrypted;
}
