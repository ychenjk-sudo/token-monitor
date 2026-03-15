// ── Config manager ───────────────────────────────────────────
// Stores user provider configs in ~/Library/Application Support/token-monitor/
// API keys are encrypted with AES-256-GCM using a machine-specific key.

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, isEncrypted } = require('./crypto.js');

let CONFIG_DIR;

function init(userDataPath) {
  CONFIG_DIR = userDataPath;
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  migrateUnencrypted();
}

function configPath() { return path.join(CONFIG_DIR, 'config.json'); }
function historyPath() { return path.join(CONFIG_DIR, 'token-history.json'); }
function cachePath() { return path.join(CONFIG_DIR, 'providers-cache.json'); }

// ── Encrypt/decrypt config on load/save ──────────────────────

const SENSITIVE_FIELDS = ['apiKey', 'apiKey2'];

function encryptConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  for (const p of (out.providers || [])) {
    for (const field of SENSITIVE_FIELDS) {
      if (p.config?.[field] && !isEncrypted(p.config[field])) {
        p.config[field] = encrypt(p.config[field]);
      }
    }
  }
  return out;
}

function decryptConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  for (const p of (out.providers || [])) {
    for (const field of SENSITIVE_FIELDS) {
      if (p.config?.[field] && isEncrypted(p.config[field])) {
        p.config[field] = decrypt(p.config[field]);
      }
    }
  }
  return out;
}

// Migrate plaintext keys to encrypted on first run
function migrateUnencrypted() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    let changed = false;
    for (const p of (raw.providers || [])) {
      for (const field of SENSITIVE_FIELDS) {
        if (p.config?.[field] && !isEncrypted(p.config[field])) {
          changed = true;
        }
      }
    }
    if (changed) {
      fs.writeFileSync(configPath(), JSON.stringify(encryptConfig(raw), null, 2));
    }
  } catch {}
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    return decryptConfig(raw);
  } catch {
    return { providers: [], openclawPath: null, settings: {} };
  }
}

function save(config) {
  fs.writeFileSync(configPath(), JSON.stringify(encryptConfig(config), null, 2));
}

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(historyPath(), 'utf-8')); }
  catch { return { records: [], lastScanTs: null }; }
}

function saveHistory(store) {
  fs.writeFileSync(historyPath(), JSON.stringify(store));
}

function saveCache(data) {
  fs.writeFileSync(cachePath(), JSON.stringify(data));
}

function getDataDir() { return CONFIG_DIR; }

module.exports = { init, load, save, loadHistory, saveHistory, saveCache, getDataDir, configPath, historyPath };
