// ── OpenClaw session scanner ─────────────────────────────────
// Reads OpenClaw JSONL session files to extract token usage data.

const fs = require('fs');
const path = require('path');

// Token estimation for providers that don't report usage
function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  const cjk = (str.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
  return Math.ceil((str.length - cjk) / 4 + cjk / 1.5);
}

const MODEL_PRICING = {
  // Anthropic official pricing (USD per token)
  'claude-opus-4':     { input: 15/1e6, output: 75/1e6 },
  'claude-sonnet-4':   { input: 3/1e6,  output: 15/1e6 },
  'claude-haiku':      { input: 0.8/1e6, output: 4/1e6 },
  // OpenAI
  'gpt-5':             { input: 10/1e6, output: 30/1e6 },
  // GLM (ZAI) — ¥0.6/千token input, ¥2.2/千token output → convert to USD (~$0.08/$0.30 per 1K)
  'glm-4':             { input: 0.08/1e3, output: 0.30/1e3 },
  // MiniMax
  'minimax-m2':        { input: 1/1e6,  output: 5/1e6 },
  // NVIDIA Nemotron
  'nemotron':          { input: 0.3/1e6, output: 1/1e6 },
  // delivery-mirror (internal, no real cost)
  'delivery-mirror':   { input: 0, output: 0 },
};

function getPricing(modelId) {
  const m = (modelId || '').toLowerCase();
  if (m.includes('opus'))     return MODEL_PRICING['claude-opus-4'];
  if (m.includes('sonnet'))   return MODEL_PRICING['claude-sonnet-4'];
  if (m.includes('haiku'))    return MODEL_PRICING['claude-haiku'];
  if (m.includes('gpt-5'))    return MODEL_PRICING['gpt-5'];
  if (m.includes('glm'))      return MODEL_PRICING['glm-4'];
  if (m.includes('minimax'))  return MODEL_PRICING['minimax-m2'];
  if (m.includes('nemotron')) return MODEL_PRICING['nemotron'];
  if (m.includes('delivery') || m.includes('mirror')) return MODEL_PRICING['delivery-mirror'];
  return null;
}

function findOpenClawSessions() {
  const candidates = [
    path.join(process.env.HOME, '.openclaw/agents/main/sessions'),
    path.join(process.env.HOME, '.clawdbot/agents/main/sessions'),
    path.join(process.env.HOME, '.claude/agents/main/sessions'),
  ];
  for (const dir of candidates) {
    const sj = path.join(dir, 'sessions.json');
    if (fs.existsSync(sj)) return dir;
  }
  return null;
}

function scanSessions(sessionsDir, store) {
  if (!sessionsDir || !fs.existsSync(sessionsDir)) return store;

  const existingKeys = new Set(store.records.map(r => r._key));
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl') || f.includes('.jsonl.reset.'));
  let added = 0;

  for (const file of files) {
    let content;
    try { content = fs.readFileSync(path.join(sessionsDir, file), 'utf-8'); } catch { continue; }
    const lines = content.split('\n').filter(l => l.trim());
    const allMsgs = [];
    for (const line of lines) {
      try { const obj = JSON.parse(line); if (obj.type === 'message' && obj.message) allMsgs.push(obj); } catch {}
    }

    for (let i = 0; i < allMsgs.length; i++) {
      const obj = allMsgs[i];
      const msg = obj.message;
      if (msg.role === 'user') continue;
      if (msg.role !== 'assistant' || !msg.usage) continue;

      const u = msg.usage;
      const ts = obj.timestamp || msg.timestamp;
      if (!ts) continue;

      const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      const key = `${file}:${ts}:${contentStr.length}`;
      if (existingKeys.has(key)) continue;

      let recInput = u.input || 0, recOutput = u.output || 0, recTotal = u.totalTokens || 0;
      let costTotal = u.cost?.total || 0, estimated = false;

      // If gateway reported tokens but no cost, estimate cost from local pricing
      if (costTotal === 0 && (recInput > 0 || recOutput > 0)) {
        const pricing = getPricing(msg.model);
        if (pricing) costTotal = recInput * pricing.input + recOutput * pricing.output;
      }

      if (recTotal === 0 && recInput === 0 && recOutput === 0) {
        recOutput = estimateTokens(contentStr);
        let prevUser = '';
        for (let j = i - 1; j >= 0; j--) {
          if (allMsgs[j].message?.role === 'user') {
            const c = allMsgs[j].message.content;
            prevUser = typeof c === 'string' ? c : JSON.stringify(c);
            break;
          }
        }
        recInput = estimateTokens(prevUser);
        if (i <= 2) recInput += 2000;
        recTotal = recInput + recOutput;
        estimated = true;
        const pricing = getPricing(msg.model);
        if (pricing) costTotal = recInput * pricing.input + recOutput * pricing.output;
      }

      store.records.push({
        _key: key,
        ts: typeof ts === 'number' ? new Date(ts).toISOString() : ts,
        date: new Date(typeof ts === 'number' ? ts : ts).toISOString().slice(0, 10),
        model: msg.model || 'unknown',
        input: recInput, output: recOutput,
        cacheRead: u.cacheRead || 0, cacheWrite: u.cacheWrite || 0,
        totalTokens: recTotal, costTotal, estimated,
      });
      existingKeys.add(key);
      added++;
    }
  }

  if (added > 0) {
    store.records.sort((a, b) => a.ts.localeCompare(b.ts));
    store.lastScanTs = new Date().toISOString();
  }
  return store;
}

function readLiveStatus(sessionsDir) {
  if (!sessionsDir) return [];
  const sjPath = path.join(sessionsDir, 'sessions.json');
  if (!fs.existsSync(sjPath)) return [];

  const sessions = JSON.parse(fs.readFileSync(sjPath, 'utf-8'));
  const results = [];

  for (const [key, val] of Object.entries(sessions)) {
    if (!val.model) continue;
    const entry = {
      sessionKey: key, model: val.model,
      input: val.inputTokens || 0, output: val.outputTokens || 0,
      total: val.totalTokens || 0, cacheRead: val.cacheRead || 0,
      cacheWrite: val.cacheWrite || 0, contextLimit: val.contextTokens || 0,
      cost: 0, estimated: false,
    };

    if (val.sessionId) {
      const jsonlPath = path.join(sessionsDir, val.sessionId + '.jsonl');
      try {
        const content = fs.readFileSync(jsonlPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const allMsgs = [];
        for (const line of lines) {
          try { const obj = JSON.parse(line); if (obj.type === 'message' && obj.message) allMsgs.push(obj); } catch {}
        }
        let si=0,so=0,st=0,cr=0,cw=0,cost=0;
        for (let i = 0; i < allMsgs.length; i++) {
          const msg = allMsgs[i].message;
          if (msg.role !== 'assistant' || !msg.usage) continue;
          const u = msg.usage;
          if ((u.input||0) > 0 || (u.output||0) > 0 || (u.totalTokens||0) > 0) {
            si+=u.input||0; so+=u.output||0; st+=u.totalTokens||0;
            cr+=u.cacheRead||0; cw+=u.cacheWrite||0;
            let msgCost = u.cost?.total||0;
            // If gateway didn't provide cost, estimate from local pricing
            if (msgCost === 0 && ((u.input||0) > 0 || (u.output||0) > 0)) {
              const p = getPricing(msg.model);
              if (p) msgCost = (u.input||0)*p.input + (u.output||0)*p.output;
            }
            cost+=msgCost;
          } else {
            const cs = typeof msg.content==='string'?msg.content:JSON.stringify(msg.content||'');
            const eo = estimateTokens(cs);
            let ei = 0;
            for (let j=i-1;j>=0;j--) { if (allMsgs[j].message?.role==='user') { const c=allMsgs[j].message.content; ei=estimateTokens(typeof c==='string'?c:JSON.stringify(c)); break; } }
            si+=ei; so+=eo; st+=ei+eo; entry.estimated=true;
            const p = getPricing(msg.model);
            if (p) cost += ei*p.input + eo*p.output;
          }
        }
        entry.input=si; entry.output=so; entry.total=st;
        entry.cacheRead=cr; entry.cacheWrite=cw; entry.cost=cost;
      } catch {}
    }
    results.push(entry);
  }
  return results;
}

// ── Time-filtered live status ────────────────────────────────
// range: 'session' (current active sessions) | 'today' | 'all'

function readLiveByRange(sessionsDir, range, historyStore) {
  if (!sessionsDir) return [];

  // 'session' — current active sessions from sessions.json
  if (range === 'session') {
    return readLiveStatus(sessionsDir);
  }

  // 'today' and 'all' — read from history store (token-history.json)
  if (!historyStore || !historyStore.records || !historyStore.records.length) {
    return readLiveStatus(sessionsDir); // fallback
  }

  const records = historyStore.records;
  const today = new Date().toISOString().slice(0, 10);
  const filtered = range === 'today'
    ? records.filter(r => r.date === today)
    : records; // 'all' = everything

  // Aggregate by model
  const byModel = {};
  for (const r of filtered) {
    const model = r.model || 'unknown';
    if (!byModel[model]) {
      byModel[model] = { model, input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0, cost: 0, estimated: false, count: 0 };
    }
    byModel[model].input += r.input || 0;
    byModel[model].output += r.output || 0;
    byModel[model].total += r.totalTokens || 0;
    byModel[model].cacheRead += r.cacheRead || 0;
    byModel[model].cacheWrite += r.cacheWrite || 0;
    byModel[model].cost += r.costTotal || 0;
    if (r.estimated) byModel[model].estimated = true;
    byModel[model].count++;
  }

  // Convert to array format matching readLiveStatus output
  return Object.values(byModel).map(m => ({
    sessionKey: `${range}:${m.model}`,
    model: m.model,
    input: m.input,
    output: m.output,
    total: m.total,
    cacheRead: m.cacheRead,
    cacheWrite: m.cacheWrite,
    contextLimit: 0,
    cost: m.cost,
    estimated: m.estimated,
  }));
}

module.exports = { findOpenClawSessions, scanSessions, readLiveStatus, readLiveByRange, estimateTokens, getPricing };
