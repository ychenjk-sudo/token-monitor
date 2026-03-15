# Token Monitor

A lightweight macOS menubar app to monitor AI token usage across multiple providers in real-time.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey) ![Electron](https://img.shields.io/badge/electron-33-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Live Token Tracking** — Real-time monitoring of OpenClaw sessions across all models (Claude, GLM, MiniMax, etc.)
- **Multi-Provider Dashboard** — View usage and balance for DeepSeek, Anthropic, OpenAI, Z.ai (智谱), MiniMax, Qwen (千问), NVIDIA, OpenRouter, LaozhangAPI, and custom OpenAI-compatible providers
- **History & Analytics** — Interactive line chart with 7D/30D/90D views, hover tooltips showing daily token & cost breakdown
- **Low Balance Alerts** — macOS notifications when provider balance drops below your threshold
- **High Token Usage Alerts** — Get notified when a single session exceeds your token limit
- **Menubar Tray** — Click the tray icon to show/hide; app stays running in background
- **Dark/Light Theme** — Follows system appearance or set manually
- **Encrypted Storage** — API keys are AES-256-GCM encrypted using a machine-specific key
- **Currency Conversion** — Auto-fetches USD/CNY exchange rate for cross-currency cost comparison
- **Always-on-Top Widget** — Compact, translucent floating window with native macOS vibrancy
- **Local & Private** — All data stored locally. Nothing is sent anywhere except to the provider APIs you configure.

## Install

### From Release (recommended)

Download the latest `.dmg` from [Releases](../../releases), open it, and drag **Token Monitor** to Applications.

### From Source

```bash
git clone https://github.com/ychenjk-sudo/token-monitor.git
cd token-monitor
npm install
npm start
```

### Build .app

```bash
npm run build
# Output in dist/
```

## Setup

1. Launch the app — it appears as a floating widget and in the menubar tray
2. Click the **⚙** tab
3. Click **Add Provider**, select your API (DeepSeek, Z.ai, etc.), and enter your API key
4. Optionally set a **Low Balance Alert** threshold for each provider
5. Switch to **APIs** tab to see balance & usage with progress bars
6. **Live** tab auto-detects OpenClaw sessions and tracks token usage in real-time

### Supported Providers

| Provider | Balance API | Usage Tracking | Alerts |
|----------|:-----------:|:--------------:|:------:|
| Anthropic (Claude) | Key validation | ✅ | — |
| OpenAI | Key validation | ✅ | — |
| DeepSeek | ✅ Balance | ✅ | ✅ Low balance |
| Z.ai (智谱/GLM) | ✅ Quota limits | ✅ | — |
| MiniMax | Manual | ✅ via OpenClaw | — |
| Qwen (千问/DashScope) | Manual (Aliyun) | ✅ | ✅ Low balance |
| NVIDIA NIM | — | ✅ Estimated | — |
| LaozhangAPI | ✅ Usage/Limit | ✅ | ✅ Low balance |
| OpenRouter | ✅ Usage/Limit | ✅ | ✅ Low balance |
| Custom (OpenAI-compatible) | Key validation | — | — |

## Data Storage

All data is stored in `~/Library/Application Support/token-monitor/`:

| File | Description |
|------|-------------|
| `config.json` | Provider configs (API keys encrypted with AES-256-GCM) |
| `token-history.json` | Historical token usage records from OpenClaw sessions |
| `providers-cache.json` | Cached provider API responses |

## Architecture

```
src/
├── main.js        # Electron main process, IPC handlers, tray, alerts
├── index.html     # UI (Live / APIs / Settings tabs)
├── providers.js   # Provider registry with fetch functions
├── openclaw.js    # OpenClaw session scanner & token estimator
├── config.js      # Config manager with encryption
└── crypto.js      # AES-256-GCM encryption using machine UUID
```

## License

MIT
