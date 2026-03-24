const { app, BrowserWindow, ipcMain, shell, Notification, nativeTheme, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config.js');
const { PROVIDER_REGISTRY, getUsdToCny } = require('./providers.js');
const openclaw = require('./openclaw.js');

let win;
let tray = null;
let sessionsDir = null;
let alertCooldowns = {}; // provider -> last alert timestamp

// ── Window ───────────────────────────────────────────────────

function createWindow() {
  const cfg = config.load();
  const theme = cfg.settings?.theme || 'system';
  const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);

  win = new BrowserWindow({
    width: 340,
    height: 380,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    vibrancy: isDark ? 'under-window' : 'sidebar',
    visualEffectState: 'active',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('closed', () => { win = null; });
}

// ── Tray (menubar) ───────────────────────────────────────────

function createTray() {
  // Use a template image for macOS menubar (16x16)
  const iconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png');
  if (!fs.existsSync(iconPath)) return; // Skip if no icon

  tray = new Tray(iconPath);
  tray.setToolTip('Token Monitor');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Window', click: () => { if (win) win.show(); else createWindow(); } },
    { label: 'Refresh', click: () => { if (win) win.webContents.send('data-changed'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (win) { win.isVisible() ? win.hide() : win.show(); }
    else createWindow();
  });
}

// ── Alerts (macOS notifications) ─────────────────────────────

function sendAlert(providerId, title, body) {
  const now = Date.now();
  const cooldown = 3600000; // 1 hour
  if (alertCooldowns[providerId] && now - alertCooldowns[providerId] < cooldown) return;
  alertCooldowns[providerId] = now;

  if (Notification.isSupported()) {
    new Notification({ title: `Token Monitor: ${title}`, body, silent: false }).show();
  }
}

// ── IPC: Live status ─────────────────────────────────────────

ipcMain.handle('get-live', async (_, range) => {
  try {
    let historyStore = null;
    if (range === 'today' || range === 'all') {
      historyStore = config.loadHistory();
      // Ensure history is up to date
      historyStore = openclaw.scanSessions(sessionsDir, historyStore);
      config.saveHistory(historyStore);
    }
    const sessions = openclaw.readLiveByRange(sessionsDir, range || 'session', historyStore);
    // Check for high token usage alerts
    const cfg = config.load();
    const tokenAlert = parseInt(cfg.settings?.tokenAlertThreshold) || 50000;
    for (const s of sessions) {
      if (s.total > tokenAlert) {
        sendAlert(`session:${s.sessionKey}`, 'High Token Usage', `${s.model}: ${(s.total/1000).toFixed(1)}K tokens in current session`);
      }
    }
    return { ok: true, sessions };
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
        // Check for low balance alerts
        if (data._alert) {
          sendAlert(p.id, p.name || reg.name, data._alert);
        }
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

// ── IPC: Config ──────────────────────────────────────────────

ipcMain.handle('get-config', async () => {
  const cfg = config.load();
  // Mask API keys for display
  const masked = JSON.parse(JSON.stringify(cfg));
  for (const p of (masked.providers || [])) {
    if (p.config?.apiKey) {
      const k = p.config.apiKey;
      p.config._apiKeyMasked = k.length > 8 ? k.slice(0, 4) + '****' + k.slice(-4) : '****';
    }
  }
  return masked;
});

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

ipcMain.handle('get-exchange-rate', async () => {
  const rate = await getUsdToCny();
  return { usdToCny: rate };
});

ipcMain.handle('get-theme', async () => {
  const cfg = config.load();
  const theme = cfg.settings?.theme || 'system';
  const isDark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return { theme, isDark };
});

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

// ── Theme change listener ────────────────────────────────────

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors);
  }
});

// ── App lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  config.init(app.getPath('userData'));

  const cfg = config.load();
  sessionsDir = cfg.openclawPath || openclaw.findOpenClawSessions();

  if (sessionsDir) {
    let store = config.loadHistory();
    store = openclaw.scanSessions(sessionsDir, store);
    config.saveHistory(store);
  }

  startWatcher();
  createTray();
  createWindow();
});

app.on('window-all-closed', () => {
  // Don't quit on window close if tray exists
  if (!tray) app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
