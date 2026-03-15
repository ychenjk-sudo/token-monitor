const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config.js');
const { PROVIDER_REGISTRY } = require('./providers.js');
const openclaw = require('./openclaw.js');

let win;
let sessionsDir = null;

// ── Window ───────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 320,
    height: 340,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('closed', () => { win = null; });
}

// ── IPC: Live status ─────────────────────────────────────────

ipcMain.handle('get-live', async () => {
  try {
    return { ok: true, sessions: openclaw.readLiveStatus(sessionsDir) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: History ─────────────────────────────────────────────

ipcMain.handle('get-history', async () => {
  try {
    let store = config.loadHistory();
    store = openclaw.scanSessions(sessionsDir, store);
    config.saveHistory(store);
    return { ok: true, records: store.records };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Providers ───────────────────────────────────────────

ipcMain.handle('get-providers', async () => {
  try {
    const cfg = config.load();
    const results = [];
    for (const p of (cfg.providers || [])) {
      const reg = PROVIDER_REGISTRY[p.type];
      if (!reg) { results.push({ provider: p.id, name: p.name || p.type, error: 'Unknown provider type' }); continue; }
      try {
        const data = await reg.fetch(p.config || {});
        results.push({ provider: p.id, name: p.name || reg.name, type: reg.type, ...data });
      } catch (e) {
        results.push({ provider: p.id, name: p.name || reg.name, error: e.message });
      }
    }
    config.saveCache({ ts: Date.now(), providers: results });
    return { ok: true, providers: results };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: Config (settings) ───────────────────────────────────

ipcMain.handle('get-config', async () => config.load());

ipcMain.handle('save-config', async (_, newConfig) => {
  config.save(newConfig);
  return { ok: true };
});

ipcMain.handle('get-provider-registry', async () => {
  const reg = {};
  for (const [id, def] of Object.entries(PROVIDER_REGISTRY)) {
    reg[id] = { name: def.name, type: def.type, fields: def.fields };
  }
  return reg;
});

ipcMain.handle('get-data-path', async () => config.getDataDir());

ipcMain.handle('open-path', async (_, p) => { shell.openPath(p); });

// ── File watcher ─────────────────────────────────────────────

let debounce = null;
function startWatcher() {
  if (!sessionsDir) return;
  const sjPath = path.join(sessionsDir, 'sessions.json');
  const notify = () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      let store = config.loadHistory();
      store = openclaw.scanSessions(sessionsDir, store);
      config.saveHistory(store);
      if (win && !win.isDestroyed()) win.webContents.send('data-changed');
    }, 600);
  };
  try { fs.watch(sjPath, { persistent: false }, notify); } catch {}
  try { fs.watch(sessionsDir, { persistent: false }, (_, f) => { if (f && (f.endsWith('.jsonl') || f === 'sessions.json')) notify(); }); } catch {}
}

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  config.init(app.getPath('userData'));

  // Find OpenClaw sessions
  const cfg = config.load();
  sessionsDir = cfg.openclawPath || openclaw.findOpenClawSessions();

  // Initial scan
  if (sessionsDir) {
    let store = config.loadHistory();
    store = openclaw.scanSessions(sessionsDir, store);
    config.saveHistory(store);
  }

  startWatcher();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
