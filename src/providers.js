// ── Provider registry ────────────────────────────────────────
// Each provider defines: id, name, type, fields (for settings UI),
// and a fetch function that returns usage/balance info.

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

// ── Provider definitions ─────────────────────────────────────

const PROVIDER_REGISTRY = {

  deepseek: {
    name: 'DeepSeek',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
    ],
    async fetch(config) {
      const { data } = await httpGet('https://api.deepseek.com/user/balance', {
        Authorization: `Bearer ${config.apiKey}`,
      });
      if (!data.balance_infos) return { error: 'Invalid response' };
      const info = data.balance_infos.find(b => b.currency === 'CNY') || data.balance_infos[0];
      return {
        available: data.is_available,
        currency: info?.currency || '--',
        totalBalance: parseFloat(info?.total_balance || 0),
        grantedBalance: parseFloat(info?.granted_balance || 0),
        toppedUpBalance: parseFloat(info?.topped_up_balance || 0),
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
        plan: config.plan || 'Plus',
        quota: config.quota || '300 prompts / 5h',
        note: 'Usage tracked via OpenClaw sessions',
      };
    },
  },

  laozhang: {
    name: '老张API (laozhang.ai)',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-...' },
    ],
    async fetch(config) {
      const headers = { Authorization: `Bearer ${config.apiKey}` };
      const [sub, usage] = await Promise.all([
        httpGet('https://api.laozhang.ai/v1/dashboard/billing/subscription', headers),
        httpGet(`https://api.laozhang.ai/v1/dashboard/billing/usage?start_date=${new Date().getFullYear()}-01-01&end_date=${new Date().toISOString().slice(0, 10)}`, headers),
      ]);
      return {
        totalUsage: (usage.data?.total_usage || 0) / 100,
        hardLimit: (sub.data?.hard_limit_usd || 0) / 100,
        models: 'Claude, GPT, Gemini, etc.',
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
    ],
    async fetch(config) {
      let keyStatus = 'unknown';
      try {
        const { status } = await httpGet('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
          Authorization: `Bearer ${config.apiKey}`,
        });
        keyStatus = status === 200 ? 'active' : 'invalid';
      } catch { keyStatus = 'error'; }
      return {
        keyStatus,
        cashBalance: parseFloat(config.cashBalance) || null,
        couponBalance: parseFloat(config.couponBalance) || null,
        monthlySpend: parseFloat(config.monthlySpend) || null,
        note: 'Aliyun DashScope · 按量付费',
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
      return { note: 'No usage API available. Token usage estimated from content.' };
    },
  },

  openrouter: {
    name: 'OpenRouter',
    type: 'pay-as-you-go',
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'sk-or-...' },
    ],
    async fetch(config) {
      const { data } = await httpGet('https://openrouter.ai/api/v1/auth/key', {
        Authorization: `Bearer ${config.apiKey}`,
      });
      return {
        label: data.data?.label || '--',
        usage: data.data?.usage || 0,
        limit: data.data?.limit || null,
        rateLimitCredits: data.data?.rate_limit?.credits || null,
      };
    },
  },

  // Generic OpenAI-compatible provider
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

module.exports = { PROVIDER_REGISTRY, httpGet };
