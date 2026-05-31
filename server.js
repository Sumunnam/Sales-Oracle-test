/**
 * Sales Oracle — Backend Proxy Server
 *
 * This server acts as a proxy between the Sales Oracle frontend and
 * Anthropic's Claude API. It validates subscription keys before
 * forwarding requests, so your Anthropic API key is never exposed
 * to end users.
 *
 * SETUP:
 *   1. npm install
 *   2. Set environment variables (see below)
 *   3. node server.js  (or: npm start)
 *
 * ENVIRONMENT VARIABLES:
 *   ANTHROPIC_API_KEY     — Your Anthropic API key (required)
 *   SUBSCRIPTION_KEYS     — Comma-separated list of valid subscription keys
 *                           e.g. "key-abc123,key-def456,key-ghi789"
 *   PORT                  — Port to listen on (default: 3000)
 *   ALLOWED_ORIGINS       — Comma-separated list of allowed origins for CORS
 *                           e.g. "https://your-app.com,https://yourdomain.netlify.app"
 *                           Use "*" to allow all origins (dev only)
 *
 * DEPLOYMENT:
 *   Railway:  Connect GitHub repo, set env vars in dashboard, done.
 *   Render:   New Web Service → connect repo → set env vars → deploy.
 *   Fly.io:   fly launch, fly secrets set ANTHROPIC_API_KEY=...
 *   VPS:      pm2 start server.js --name sales-oracle
 *
 * EXPANDING TO PAID SUBSCRIPTIONS:
 *   Replace the SUBSCRIPTION_KEYS env var approach with a database
 *   lookup (e.g. Supabase, PlanetScale) to manage subscription tiers,
 *   expiry dates, and usage limits per user.
 */

const express = require('express');
const cors = require('cors');

const app = express();

// ── Config ──────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const PORT = process.env.PORT || 3000;
const RAW_KEYS = process.env.SUBSCRIPTION_KEYS || '';
const VALID_KEYS = new Set(RAW_KEYS.split(',').map(k => k.trim()).filter(Boolean));
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*'];

if (!ANTHROPIC_API_KEY) {
  console.error('⚠️  ANTHROPIC_API_KEY is not set. The server will start but all requests will fail.');
}
if (!VALID_KEYS.size) {
  console.warn('⚠️  No SUBSCRIPTION_KEYS set. All authenticated requests will be rejected.');
}

// ── Middleware ───────────────────────────────────────────────────────────
app.use(cors({
  origin: ALLOWED_ORIGINS.includes('*') ? '*' : (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));

// ── Auth helper ──────────────────────────────────────────────────────────
function validateSubscriptionKey(req) {
  const authHeader = req.headers['authorization'] || '';
  const key = authHeader.replace(/^Bearer\s+/i, '').trim();
  return VALID_KEYS.has(key);
}

// ── Health check ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    keysConfigured: VALID_KEYS.size,
    anthropicKeySet: !!ANTHROPIC_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

// ── Main proxy endpoint ───────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {

  // 1. Validate subscription key
  if (!validateSubscriptionKey(req)) {
    return res.status(401).json({ error: 'Invalid or missing subscription key.' });
  }

  // 2. Extract and validate request body
  const { messages, system, model, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  // 3. Forward to Anthropic
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(max_tokens || 1024, 4096), // cap at 4096
        system: system || '',
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error('Anthropic API error:', response.status, errorBody);
      return res.status(response.status).json({
        error: errorBody?.error?.message || `Anthropic API returned ${response.status}`,
      });
    }

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal proxy error. Please try again.' });
  }
});

// ── Subscription key management ───────────────────────────────────────────
// Simple in-memory generation — replace with database in production.
// POST /admin/keys with X-Admin-Secret header to generate a new key.
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
app.post('/admin/keys', (req, res) => {
  if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const newKey = 'sk-sub-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  VALID_KEYS.add(newKey);
  console.log('New subscription key created:', newKey);
  res.json({ key: newKey, message: 'Add this key to SUBSCRIPTION_KEYS env var to persist across restarts.' });
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚡ Sales Oracle Proxy Server running on port ${PORT}`);
  console.log(`   Subscription keys loaded: ${VALID_KEYS.size}`);
  console.log(`   Anthropic API key: ${ANTHROPIC_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(', ')}\n`);
});

// ── Optional web search endpoint ─────────────────────────────────────────
// Set SEARCH_API_KEY (SerpAPI) and SEARCH_PROVIDER=serp in env vars.
// Without it, /api/search returns empty results (graceful fallback).
const SEARCH_KEY = process.env.SEARCH_API_KEY || '';
const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || 'serp'; // 'serp' or 'serper'

app.post('/api/search', async (req, res) => {
  if (!validateSubscriptionKey(req)) return res.status(401).json({ error: 'Invalid key' });
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  if (!SEARCH_KEY) return res.json({ results: [] }); // graceful no-key fallback

  try {
    let url, headers = {};
    if (SEARCH_PROVIDER === 'serper') {
      url = 'https://google.serper.dev/search';
      headers = { 'X-API-KEY': SEARCH_KEY, 'Content-Type': 'application/json' };
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ q: query, num: 6 }) });
      const d = await r.json();
      return res.json({ results: (d.organic||[]).map(x=>({ title:x.title, snippet:x.snippet, link:x.link })) });
    } else {
      // SerpAPI
      url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SEARCH_KEY}&num=6`;
      const r = await fetch(url);
      const d = await r.json();
      return res.json({ results: (d.organic_results||[]).map(x=>({ title:x.title, snippet:x.snippet, link:x.link })) });
    }
  } catch(e) {
    console.error('Search error:', e.message);
    return res.json({ results: [] }); // always graceful fallback
  }
});

// ── Website fetch endpoint ────────────────────────────────────────────────────
// Used by the Setup tab to fetch company website content for auto-filling
// "What You Sell" via Claude.
app.post('/api/fetch', async (req, res) => {
  if (!validateSubscriptionKey(req)) return res.status(401).json({ error: 'Invalid key' });
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SalesOracle/1.0; +https://salesoracle.ai)' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    const raw = await r.text();
    // Strip scripts, styles, tags — keep readable text
    const clean = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 3500);
    return res.json({ content: clean, domain: new URL(url).hostname });
  } catch (e) {
    console.error('Fetch error:', e.message);
    return res.json({ content: '', domain: '' });
  }
});
