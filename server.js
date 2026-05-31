/**
 * Sensells — Backend Proxy Server
 *
 * SETUP:
 *   1. npm install
 *   2. cp .env.example .env  →  fill in your values
 *   3. node server.js  (or: npm start)
 *
 * ENVIRONMENT VARIABLES:
 *   ANTHROPIC_API_KEY   — Your AI provider API key (required)
 *   ADMIN_SECRET        — Password for the admin dashboard (required)
 *   PORT                — Port to listen on (default: 3000)
 *   ALLOWED_ORIGINS     — Comma-separated CORS origins, or * for dev
 *   SEARCH_API_KEY      — Serper.dev or SerpAPI key (optional)
 *   SEARCH_PROVIDER     — "serper" or "serp" (default: serper)
 *
 * SUBSCRIPTION_KEYS env var is still supported for seeding initial keys,
 * but all new keys are created and persisted in keys.json automatically.
 */

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');

const app = express();

// ── Config ─────────────────────���─────────────────��──────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PORT              = process.env.PORT || 3000;
const ADMIN_SECRET      = process.env.ADMIN_SECRET || '';
const ALLOWED_ORIGINS   = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*'];
const SEARCH_KEY        = process.env.SEARCH_API_KEY || '';
const SEARCH_PROVIDER   = process.env.SEARCH_PROVIDER || 'serper';

if (!ANTHROPIC_API_KEY) console.error('⚠️  ANTHROPIC_API_KEY not set — AI calls will fail.');
if (!ADMIN_SECRET)      console.warn('⚠️  ADMIN_SECRET not set — admin endpoints are UNPROTECTED.');

// ── Key store (keys.json persists across restarts) ──────────────────────────
const KEYS_FILE = path.join(__dirname, 'keys.json');

function loadKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch (e) { console.error('Error loading keys.json:', e.message); }
  return {};
}

function saveKeys(store) {
  try { fs.writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2)); }
  catch (e) { console.error('Error saving keys.json:', e.message); }
}

// keyStore: { [key]: { name, email, plan, createdAt, active, lastUsed, usageCount } }
const keyStore = loadKeys();

// Seed from SUBSCRIPTION_KEYS env var (legacy support)
const RAW_ENV_KEYS = process.env.SUBSCRIPTION_KEYS || '';
RAW_ENV_KEYS.split(',').map(k => k.trim()).filter(Boolean).forEach(k => {
  if (!keyStore[k]) {
    keyStore[k] = { name: 'Seeded from env', email: '', plan: 'standard',
                    createdAt: new Date().toISOString(), active: true, lastUsed: null, usageCount: 0 };
  }
});
if (RAW_ENV_KEYS) saveKeys(keyStore);

function isValidKey(key) {
  return keyStore[key] && keyStore[key].active === true;
}

function recordUsage(key) {
  if (keyStore[key]) {
    keyStore[key].lastUsed = new Date().toISOString();
    keyStore[key].usageCount = (keyStore[key].usageCount || 0) + 1;
    saveKeys(keyStore);
  }
}

// ── Middleware ──────��─────────────────────────��───────────────────────────────
app.use(cors({
  origin: ALLOWED_ORIGINS.includes('*') ? '*' : (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret'],
}));
app.use(express.json({ limit: '1mb' }));

// ── Auth helpers ───────────────────��──────────────────────────────────────────
function requireSubscription(req, res, next) {
  const key = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!isValidKey(key)) return res.status(401).json({ error: 'Invalid or inactive subscription key.' });
  req._subKey = key;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET)
    return res.status(403).json({ error: 'Forbidden — invalid admin secret.' });
  next();
}

// ── Health ────────────────────���───────────────────────────────���───────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeKeys: Object.values(keyStore).filter(k => k.active).length,
    totalKeys: Object.keys(keyStore).length,
    aiKeySet: !!ANTHROPIC_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ── AI Chat proxy ──────────────────────────────────────────────────────���──────
app.post('/api/chat', requireSubscription, async (req, res) => {
  const { messages, system, model, max_tokens } = req.body;
  if (!messages || !Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: 'messages array required.' });

  recordUsage(req._subKey);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: model || 'claude-haiku-4-5-20251001', max_tokens: Math.min(max_tokens || 1024, 4096), system: system || '', messages }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err?.error?.message || `AI API error ${response.status}` });
    }
    return res.json(await response.json());
  } catch (e) {
    return res.status(500).json({ error: 'Proxy error. Please try again.' });
  }
});

// ── Web search proxy ───────────────────────��─────────────────────────���────────
app.post('/api/search', requireSubscription, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  if (!SEARCH_KEY) return res.json({ results: [] });
  try {
    let r, d;
    if (SEARCH_PROVIDER === 'serper') {
      r = await fetch('https://google.serper.dev/search', {
        method: 'POST', headers: { 'X-API-KEY': SEARCH_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num: 8 }),
      });
      d = await r.json();
      return res.json({ results: (d.organic || []).map(x => ({ title: x.title, snippet: x.snippet, link: x.link })) });
    } else {
      r = await fetch(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SEARCH_KEY}&num=8`);
      d = await r.json();
      return res.json({ results: (d.organic_results || []).map(x => ({ title: x.title, snippet: x.snippet, link: x.link })) });
    }
  } catch (e) {
    return res.json({ results: [] });
  }
});

// ── Website fetch proxy ────────────────────────���──────────────────────────────
app.post('/api/fetch', requireSubscription, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sensells/1.0)' },
      signal: AbortSignal.timeout(10000), redirect: 'follow',
    });
    const raw = await r.text();
    const clean = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s{2,}/g, ' ').trim().slice(0, 3500);
    return res.json({ content: clean, domain: new URL(url).hostname });
  } catch (e) {
    return res.json({ content: '', domain: '' });
  }
});

// ── Admin: list all keys ───────────────────────────��──────────────────────────
app.get('/admin/keys', requireAdmin, (req, res) => {
  const list = Object.entries(keyStore).map(([key, meta]) => ({
    key,
    maskedKey: key.slice(0, 10) + '••••••••' + key.slice(-4),
    ...meta,
  }));
  // Sort: active first, then by createdAt desc
  list.sort((a, b) => {
    if (a.active !== b.active) return b.active - a.active;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  res.json({ keys: list, total: list.length, active: list.filter(k => k.active).length });
});

// ── Admin: create a new key ──────────────────────────────���────────────────────
app.post('/admin/keys', requireAdmin, (req, res) => {
  const { name = 'Unnamed', email = '', plan = 'standard', note = '' } = req.body;
  const newKey = 'sk-sub-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  keyStore[newKey] = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    plan: plan.trim(),
    note: note.trim(),
    createdAt: new Date().toISOString(),
    active: true,
    lastUsed: null,
    usageCount: 0,
  };
  saveKeys(keyStore);
  console.log(`[Keys] Created: ${newKey} → ${name} <${email}>`);
  res.json({ key: newKey, ...keyStore[newKey] });
});

// ── Admin: update key metadata ────────────────────────────────────────────────
app.post('/admin/keys/update', requireAdmin, (req, res) => {
  const { key, name, email, plan, note } = req.body;
  if (!keyStore[key]) return res.status(404).json({ error: 'Key not found.' });
  if (name  !== undefined) keyStore[key].name  = name.trim();
  if (email !== undefined) keyStore[key].email = email.trim().toLowerCase();
  if (plan  !== undefined) keyStore[key].plan  = plan.trim();
  if (note  !== undefined) keyStore[key].note  = note.trim();
  saveKeys(keyStore);
  res.json({ ok: true, key: keyStore[key] });
});

// ── Admin: revoke a key ───────────────���─────────────────────────────��─────────
app.post('/admin/keys/revoke', requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!keyStore[key]) return res.status(404).json({ error: 'Key not found.' });
  keyStore[key].active = false;
  keyStore[key].revokedAt = new Date().toISOString();
  saveKeys(keyStore);
  console.log(`[Keys] Revoked: ${key}`);
  res.json({ ok: true });
});

// ── Admin: reactivate a key ───────────────────────────────────────────────────
app.post('/admin/keys/activate', requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!keyStore[key]) return res.status(404).json({ error: 'Key not found.' });
  keyStore[key].active = true;
  delete keyStore[key].revokedAt;
  saveKeys(keyStore);
  res.json({ ok: true });
});

// ── Admin: delete a key permanently ──────────────────────────────────────────
app.delete('/admin/keys/:key', requireAdmin, (req, res) => {
  const key = req.params.key;
  if (!keyStore[key]) return res.status(404).json({ error: 'Key not found.' });
  delete keyStore[key];
  saveKeys(keyStore);
  res.json({ ok: true });
});

// ── Start ──────────────────────��──────────────────────────────────��───────────
app.listen(PORT, () => {
  const active = Object.values(keyStore).filter(k => k.active).length;
  console.log(`\n⚡ Sensells Proxy Server running on port ${PORT}`);
  console.log(`   Active subscription keys: ${active}`);
  console.log(`   AI key: ${ANTHROPIC_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`   Admin secret: ${ADMIN_SECRET ? '✓ set' : '✗ NOT SET — admin is unprotected!'}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}\n`);
});
