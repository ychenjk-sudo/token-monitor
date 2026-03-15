// ── Encryption helper ────────────────────────────────────────
// AES-256-GCM encryption for API keys, using a machine-specific key
// derived from the macOS hardware UUID.

const crypto = require('crypto');
const { execSync } = require('child_process');

let _machineKey = null;

function getMachineKey() {
  if (_machineKey) return _machineKey;
  try {
    // Use macOS hardware UUID as seed
    const raw = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', { encoding: 'utf-8' });
    const uuid = raw.match(/"([A-F0-9-]+)"/)?.[1] || 'fallback-key-token-monitor';
    _machineKey = crypto.createHash('sha256').update(`token-monitor:${uuid}`).digest();
  } catch {
    _machineKey = crypto.createHash('sha256').update('token-monitor:fallback').digest();
  }
  return _machineKey;
}

function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = getMachineKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `enc:${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.startsWith('enc:')) return ciphertext;
  try {
    const parts = ciphertext.split(':');
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];
    const key = getMachineKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  } catch {
    return ciphertext; // Return as-is if decryption fails (might be plaintext)
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith('enc:');
}

module.exports = { encrypt, decrypt, isEncrypted };
