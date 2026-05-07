# Crypto Dashboard (Next.js)

Live cryptocurrency analytics dashboard. Replaces the previous Streamlit
implementation. Reads only from the project's internal FastAPI service —
the browser never contacts that backend directly.

## Architecture

```
Browser ── HTTPS ──► Next.js (Cloud Run, public)
                          │
                          │  Server-side fetch with Google ID token
                          ▼
                  FastAPI (Cloud Run, private,
                           --no-allow-unauthenticated)
                          │
                          ▼
                       BigQuery
```

## Why this is more secure than the previous setup

- **FastAPI is no longer publicly exposed.** The browser cannot reach it.
- **Zero secrets in the browser.** All `NEXT_PUBLIC_*` config is non-sensitive.
- **Service-to-service auth** uses Google-issued ID tokens minted from the
  Cloud Run metadata server. Tokens are short-lived (60 min) and audience-bound.
- **Strict security headers** via `next.config.ts`: HSTS preload, CSP,
  X-Frame-Options, Permissions-Policy, etc.
- **Rate limiting** via in-memory token bucket on every `/api` route plus
  Cloud Run `--max-instances 5` ceiling.
- **Method allow-list**: only `GET` is accepted on `/api/*` (middleware enforces).
- **Zod validation** on every input parameter.
- **Non-root container user** (`nextjs:1001`).

## Local development

```bash
cd dashboard-next
npm install --legacy-peer-deps

# Talk to a real (publicly-reachable) API for local dev:
export API_BASE_URL=https://crypto-api-jiuqt3hfoq-uc.a.run.app
export SKIP_ID_TOKEN=1   # don't try to mint Google ID tokens locally

npm run dev
# http://localhost:3000
```

## Deployment

Handled by `.github/workflows/deploy.yml` job `deploy-dashboard`.
Cloud Run service: `crypto-dashboard` (replaces the Streamlit one with the same name).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | required | Private FastAPI URL the dashboard proxies to |
| `SKIP_ID_TOKEN` | unset | If set, skip Google ID-token auth (local dev only) |
| `PORT` | 8080 | Set by Cloud Run |
| `NODE_ENV` | production | Set by Dockerfile |

## What's hosted at /api

| Path | Source | Auth to FastAPI |
|---|---|---|
| `GET /api/health` | proxies `/health` | yes (ID token) |
| `GET /api/stats` | proxies `/stats` | yes |
| `GET /api/price/:symbol` | proxies `/price/:symbol` | yes |
| `GET /api/candles/:symbol` | proxies `/candles/:symbol?minutes=` | yes |
| `GET /api/anomalies` | proxies `/anomalies/recent` | yes |
| `GET /api/forecast/:symbol` | proxies `/forecast/:symbol?hours=` | yes |
| `GET /api/whales` | proxies `/whales/recent` | yes |
| `GET /api/stream/trades` | SSE; polls `/stats` and pushes to client | yes |

All return `Cache-Control` headers and reject anything other than `GET`.
