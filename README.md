# Token Monitor

A lightweight macOS floating widget to monitor AI token usage in real-time.

![macOS](https://img.shields.io/badge/platform-macOS-lightgrey) ![Electron](https://img.shields.io/badge/electron-33-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Live Token Tracking** — Real-time monitoring of OpenClaw sessions across all models (Claude, GLM, MiniMax, etc.)
- **Multi-Provider Dashboard** — View usage and balance for DeepSeek, Z.ai (智谱), MiniMax, Qwen (千问), NVIDIA, OpenRouter, LaozhangAPI, and custom OpenAI-compatible providers
- **History & Analytics** — Interactive line chart with 7D/30D/90D views, hover tooltips showing daily token & cost breakdown
- **Always-on-Top Widget** — Compact, translucent floating window with native macOS vibrancy
- **Local & Private** — All API keys and data stored locally on your machine. Nothing is sent anywhere except to the provider APIs you configure.

## Install

### From Release (recommended)

Download the latest `.dmg` from [Releases](../../releases), open it, and drag **Token Monitor** to Applications.

### From Source

```bash
git clone https://github.com/YOUR_USERNAME/token-monitor.git
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

1. Launch the app
2. Click the **⚙** tab
3. Add your API providers (DeepSeek, Z.ai, Qwen, etc.) with your API keys
4. Switch to **APIs** tab to see balance & usage
5. **Live** tab auto-detects OpenClaw sessions

### Supported Providers

| Provider | Balance API | Usage Tracking |
|----------|:-----------:|:--------------:|
| DeepSeek | ✅ | ✅ |
| Z.ai (智谱/GLM) | ✅ Quota limits | ✅ |
| MiniMax | Manual | ✅ via OpenClaw |
| Qwen (千问/DashScope) | Manual (Aliyun) | ✅ |
| NVIDIA NIM | ❌ | ✅ Estimated |
| LaozhangAPI | ✅ | ✅ |
| OpenRouter | ✅ | ✅ |
| Custom (OpenAI-compatible) | ❌ | Key validation |

## Data Storage

All data is stored in `~/Library/Application Support/token-monitor/`:

- `config.json` — Provider configs & API keys
- `token-history.json` — Historical token usage records
- `providers-cache.json` — Cached provider responses

## License

MIT
