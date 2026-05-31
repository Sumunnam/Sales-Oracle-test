# Sensells

AI-powered B2B sales intelligence platform — Prospect discovery, Competitive Analysis, Message Forge, Mentor, Pipeline tracking, and Playbook automation.

## Files

| File | Description |
|------|-------------|
| `index.html` | Complete frontend — single file, open in any browser |
| `server.js` | Node.js backend proxy — subscription-gated AI API access |
| `package.json` | Node dependencies |

## Quick Start (Direct mode — no backend needed)

1. Open `index.html` in a browser
2. Go to **API Config** tab (last tab)
3. Switch to **Direct Mode**
4. Paste your API key (from your AI provider console)
5. Click **Activate Sensell**
6. Go to **Setup** tab and configure your company

## Backend Deployment (Subscription / Proxy mode)

```bash
npm install
# Set environment variables:
export ANTHROPIC_API_KEY=sk-ant-...
export SUBSCRIPTION_KEYS=sk-sub-abc123,sk-sub-def456
export ALLOWED_ORIGINS=https://yourdomain.com
export PORT=3000

# Optional live web search (Serper.dev or SerpAPI):
export SEARCH_API_KEY=your-serper-key
export SEARCH_PROVIDER=serper

node server.js
```

Deploy on: Railway · Render · Fly.io · any VPS

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/chat` | AI chat proxy (requires Bearer subscription key) |
| `POST /api/search` | Web search proxy (requires SEARCH_API_KEY) |
| `POST /api/fetch` | Website content fetch for auto-fill |
| `POST /admin/keys` | Generate new subscription key (requires X-Admin-Secret header) |
| `GET /health` | Health check |

## Tabs

- **Setup** — Company details, market targeting, industry, buyer personas
- **Prospects** — AI-researched prospect companies with iterative multi-search
- **Competitive Analysis** — Competitor mapping by region and threat level
- **Playbook** — Auto-refreshed every 12 hours, bullet-point actions per prospect
- **Notes** — Detailed activity log per prospect
- **Message Forge** — LinkedIn + Email message generation with tone animation
- **Mentor** — Conversational sales advisor with pipeline context
- **Pipeline** — Deal tracker with per-company note history
- **Learnings** — Outcome tracking and pattern analysis
- **Frameworks** — Sales methodology reference
- **API Config** — AI API credentials
