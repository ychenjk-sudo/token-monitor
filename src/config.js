// ── Config manager ───────────────────────────────────────────
// Stores user provider configs in ~/Library/Application Support/token-monitor/config.json
// All API keys stay local on the user's machine.

const fs = require('fs');
const path = require('path');

let CONFIG_DIR;

function init(userDataPath) {
  CONFIG_DIR = userDataPath;
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function configPath() { return path.join(CONFIG_DIR, 'config.json'); }
function historyPath() { return path.join(CONFIG_DIR, 'token-history.json'); }
function cachePath() { return path.join(CONFIG_DIR, 'providers-cache.json'); }

function load() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf-8')); }
  catch { return { providers: [], openclawPath: null }; }
}

function save(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
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
