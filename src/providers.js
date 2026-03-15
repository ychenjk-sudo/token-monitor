// ── Provider registry ────────────────────────────────────────
// Each provider: id, name, type, fields, fetch(), and optional alert thresholds.

const https = require('https');
const http = require('http');

function httpGet(url, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers, timeout }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { raw: data } }); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(url, body, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: 'POST', timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { raw: data } }); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── Exchange rates (cached) ──────────────────────────────────

let rateCache = { ts: 0, usdToCny: 7.24 };

async function getUsdToCny() {
  if (Date.now() - rateCache.ts < 3600000) return rateCache.usdToCny;
  try {
    const { data } = await httpGet('https://open.er-api.com/v6/latest/USD', {}, 5000);
    if (data.rates?.CNY) {
      rateCache = { ts: Date.now(), usdToCny: data.rates.CNY };
    }
  } catch {}
  return rateCache.usdToCny;
}

// ── Provider definitions ─────────────────────────────────────

const PROVIDER_REGISTRY = {

  anthropic: {
    name: 'Anthropic (Claude)',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-ant-...' },
    ],
    async fetch(config) {
      // Anthropic doesn't have a balance API, but we can validate the key
      try {
        const { status, data } = await httpGet('https://api.anthropic.com/v1/models', {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        });
        return {
          keyStatus: status === 200 ? 'active' : 'invalid',
          models: (data.data || []).length,
          note: 'No balance API. Check console.anthropic.com for usage.',
        };
      } catch (e) {
        return { error: e.message };
      }
    },
  },

  openai: {
    name: 'OpenAI',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
    ],
    async fetch(config) {
      const headers = { Authorization: `Bearer ${config.apiKey}` };
      try {
        const { status } = await httpGet('https://api.openai.com/v1/models', headers);
        return {
          keyStatus: status === 200 ? 'active' : 'invalid',
          note: 'Check platform.openai.com/usage for balance.',
        };
      } catch (e) {
        return { error: e.message };
      }
    },
  },

  deepseek: {
    name: 'DeepSeek',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
      { key: 'alertThreshold', label: 'Low Balance Alert (¥)', placeholder: '5', optional: true },
    ],
    async fetch(config) {
      const { data } = await httpGet('https://api.deepseek.com/user/balance', {
        Authorization: `Bearer ${config.apiKey}`,
      });
      if (!data.balance_infos) return { error: 'Invalid response' };
      const info = data.balance_infos.find(b => b.currency === 'CNY') || data.balance_infos[0];
      const balance = parseFloat(info?.total_balance || 0);
      const threshold = parseFloat(config.alertThreshold) || 0;
      return {
        available: data.is_available,
        currency: info?.currency || '--',
        totalBalance: balance,
        grantedBalance: parseFloat(info?.granted_balance || 0),
        toppedUpBalance: parseFloat(info?.topped_up_balance || 0),
        _alert: threshold > 0 && balance < threshold ? `Balance ¥${balance} below ¥${threshold}` : null,
      };
    },
  },

  zai: {
    name: '智谱 (Z.ai / GLM)',
    type: 'subscription',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'xxxxxxxx.xxxxxxxx' },
    ],
    async fetch(config) {
      const { data } = await httpGet('https://api.z.ai/api/monitor/usage/quota/limit', {
        Authorization: `Bearer ${config.apiKey}`,
      });
      const limits = data.data?.limits || [];
      const level = data.data?.level || 'unknown';
      const windows = [];
      for (const l of limits) {
        let label = 'Limit';
        if (l.unit === 1) label = `${l.number}d`;
        else if (l.unit === 3) label = `${l.number}h`;
        else if (l.unit === 5) label = `${l.number}m`;
        const nextReset = l.nextResetTime ? new Date(l.nextResetTime).toISOString() : null;
        if (l.type === 'TOKENS_LIMIT') {
          windows.push({ label: `Tokens (${label})`, pct: l.percentage * 100, nextReset });
        } else if (l.type === 'TIME_LIMIT') {
          windows.push({ label: `Calls (${label})`, pct: l.percentage * 100, used: l.currentValue, total: l.usage, remaining: l.remaining, nextReset });
        }
      }
      return { plan: level, windows };
    },
  },

  minimax: {
    name: 'MiniMax',
    type: 'coding-plan',
    fields: [
      { key: 'plan', label: 'Plan', placeholder: 'Plus / Pro' },
      { key: 'quota', label: 'Quota', placeholder: '300 prompts / 5h' },
    ],
    async fetch(config) {
      return {
        plan: config.plan || '--',
        quota: config.quota || '--',
        note: 'Usage tracked via OpenClaw sessions',
      };
    },
  },

  laozhang: {
    name: '老张API (laozhang.ai)',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
      { key: 'alertThreshold', label: 'Low Balance Alert ($)', placeholder: '1', optional: true },
    ],
    async fetch(config) {
      const headers = { Authorization: `Bearer ${config.apiKey}` };
      const year = new Date().getFullYear();
      const today = new Date().toISOString().slice(0, 10);
      const [sub, usage] = await Promise.all([
        httpGet('https://api.laozhang.ai/v1/dashboard/billing/subscription', headers),
        httpGet(`https://api.laozhang.ai/v1/dashboard/billing/usage?start_date=${year}-01-01&end_date=${today}`, headers),
      ]);
      const totalUsage = (usage.data?.total_usage || 0) / 100;
      const hardLimit = (sub.data?.hard_limit_usd || 0) / 100;
      const threshold = parseFloat(config.alertThreshold) || 0;
      const remaining = hardLimit - totalUsage;
      return {
        totalUsage,
        hardLimit,
        remaining,
        models: 'Claude, GPT, Gemini, etc.',
        _alert: threshold > 0 && remaining < threshold ? `Remaining $${remaining.toFixed(2)} below $${threshold}` : null,
      };
    },
  },

  qwen: {
    name: '千问 (Qwen / DashScope)',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
      { key: 'cashBalance', label: 'Aliyun Cash Balance (¥)', placeholder: '16.03', optional: true },
      { key: 'couponBalance', label: 'Aliyun Coupon Balance (¥)', placeholder: '17.62', optional: true },
      { key: 'monthlySpend', label: 'Monthly Spend (¥)', placeholder: '173.08', optional: true },
      { key: 'alertThreshold', label: 'Low Balance Alert (¥)', placeholder: '10', optional: true },
    ],
    async fetch(config) {
      let keyStatus = 'unknown';
      try {
        const { status } = await httpGet('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
          Authorization: `Bearer ${config.apiKey}`,
        });
        keyStatus = status === 200 ? 'active' : 'invalid';
      } catch { keyStatus = 'error'; }
      const bal = parseFloat(config.cashBalance) || 0;
      const threshold = parseFloat(config.alertThreshold) || 0;
      return {
        keyStatus,
        cashBalance: bal,
        couponBalance: parseFloat(config.couponBalance) || 0,
        monthlySpend: parseFloat(config.monthlySpend) || 0,
        note: 'Aliyun DashScope · 按量付费',
        _alert: threshold > 0 && bal < threshold ? `Balance ¥${bal} below ¥${threshold}` : null,
      };
    },
  },

  nvidia: {
    name: 'NVIDIA NIM',
    type: 'credits',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
    ],
    async fetch(config) {
      return { note: 'No usage API. Token usage estimated from content.' };
    },
  },

  openrouter: {
    name: 'OpenRouter',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-or-...' },
      { key: 'alertThreshold', label: 'Low Balance Alert ($)', placeholder: '1', optional: true },
    ],
    async fetch(config) {
      const { data } = await httpGet('https://openrouter.ai/api/v1/auth/key', {
        Authorization: `Bearer ${config.apiKey}`,
      });
      const usage = data.data?.usage || 0;
      const limit = data.data?.limit || null;
      const threshold = parseFloat(config.alertThreshold) || 0;
      const remaining = limit ? limit - usage : null;
      return {
        label: data.data?.label || '--',
        usage,
        limit,
        remaining,
        _alert: threshold > 0 && remaining != null && remaining < threshold ? `Remaining $${remaining.toFixed(2)} below $${threshold}` : null,
      };
    },
  },

  custom: {
    name: 'Custom (OpenAI-compatible)',
    type: 'custom',
    fields: [
      { key: 'name', label: 'Display Name', placeholder: 'My Provider' },
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1' },
    ],
    async fetch(config) {
      try {
        const { status } = await httpGet(`${config.baseUrl}/models`, {
          Authorization: `Bearer ${config.apiKey}`,
        });
        return { keyStatus: status === 200 ? 'active' : 'invalid' };
      } catch (e) {
        return { error: e.message };
      }
    },
  },
};

module.exports = { PROVIDER_REGISTRY, httpGet, httpPost, getUsdToCny };
