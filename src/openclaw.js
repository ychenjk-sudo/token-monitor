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
  'claude-opus-4':   { input: 15/1e6, output: 75/1e6 },
  'claude-sonnet-4': { input: 3/1e6,  output: 15/1e6 },
  'claude-haiku':    { input: 0.8/1e6, output: 4/1e6 },
};

function getPricing(modelId) {
  const m = (modelId || '').toLowerCase();
  if (m.includes('opus'))   return MODEL_PRICING['claude-opus-4'];
  if (m.includes('sonnet')) return MODEL_PRICING['claude-sonnet-4'];
  if (m.includes('haiku'))  return MODEL_PRICING['claude-haiku'];
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
            cr+=u.cacheRead||0; cw+=u.cacheWrite||0; cost+=u.cost?.total||0;
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
// range: 'session' (all time per session) | 'today' | 'all'

let _todayCache = { ts: 0, data: null };
const TODAY_CACHE_TTL = 60000; // 60s

function readLiveByRange(sessionsDir, range) {
  if (!sessionsDir) return [];

  // 'session' and 'all' both use the full session data (merged differently in frontend)
  if (range === 'session' || range === 'all') {
    return readLiveStatus(sessionsDir);
  }

  // 'today' — scan jsonl files, only count messages from today
  const now = Date.now();
  if (_todayCache.data && (now - _todayCache.ts) < TODAY_CACHE_TTL) {
    return _todayCache.data;
  }

  const sjPath = path.join(sessionsDir, 'sessions.json');
  if (!fs.existsSync(sjPath)) return [];

  const sessions = JSON.parse(fs.readFileSync(sjPath, 'utf-8'));
  const today = new Date().toISOString().slice(0, 10);
  const todayStart = new Date(today + 'T00:00:00').getTime();
  const results = [];

  for (const [key, val] of Object.entries(sessions)) {
    if (!val.model || !val.sessionId) continue;

    const jsonlPath = path.join(sessionsDir, val.sessionId + '.jsonl');
    let stat;
    try { stat = fs.statSync(jsonlPath); } catch { continue; }
    // Skip files not modified today (optimization)
    if (stat.mtimeMs < todayStart) continue;

    const entry = {
      sessionKey: key, model: val.model,
      input: 0, output: 0, total: 0,
      cacheRead: 0, cacheWrite: 0,
      contextLimit: val.contextTokens || 0,
      cost: 0, estimated: false,
    };

    try {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const allMsgs = [];
      for (const line of lines) {
        try { const obj = JSON.parse(line); if (obj.type === 'message' && obj.message) allMsgs.push(obj); } catch {}
      }

      for (let i = 0; i < allMsgs.length; i++) {
        const obj = allMsgs[i];
        const msg = obj.message;
        if (msg.role !== 'assistant' || !msg.usage) continue;

        const ts = obj.timestamp || msg.timestamp;
        if (!ts) continue;
        const msgTime = typeof ts === 'number' ? ts : new Date(ts).getTime();
        if (msgTime < todayStart) continue; // Skip messages before today

        const u = msg.usage;
        if ((u.input||0) > 0 || (u.output||0) > 0 || (u.totalTokens||0) > 0) {
          entry.input += u.input||0;
          entry.output += u.output||0;
          entry.total += u.totalTokens||0;
          entry.cacheRead += u.cacheRead||0;
          entry.cacheWrite += u.cacheWrite||0;
          entry.cost += u.cost?.total||0;
        } else {
          const cs = typeof msg.content==='string' ? msg.content : JSON.stringify(msg.content||'');
          const eo = estimateTokens(cs);
          let ei = 0;
          for (let j=i-1; j>=0; j--) {
            if (allMsgs[j].message?.role==='user') {
              const c = allMsgs[j].message.content;
              ei = estimateTokens(typeof c==='string' ? c : JSON.stringify(c));
              break;
            }
          }
          entry.input += ei; entry.output += eo; entry.total += ei+eo;
          entry.estimated = true;
          const p = getPricing(msg.model);
          if (p) entry.cost += ei*p.input + eo*p.output;
        }
      }
    } catch {}

    if (entry.total > 0) results.push(entry);
  }

  _todayCache = { ts: now, data: results };
  return results;
}

module.exports = { findOpenClawSessions, scanSessions, readLiveStatus, readLiveByRange, estimateTokens, getPricing };
