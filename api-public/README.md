# Crypto Analytics API

Private read-only REST API over the live Coinbase pipeline. FastAPI on Cloud
Run queries BigQuery directly with safety caps. In production, the browser never
calls this service directly; the public Next.js dashboard proxies `/api/*`
routes server-side with a Google ID token.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/` | Service info + endpoint catalog |
| `GET` | `/health` | 200 if BQ reachable, 503 otherwise |
| `GET` | `/stats` | Per-symbol stats over the last 24h |
| `GET` | `/price/{symbol}` | Latest price + 1h delta |
| `GET` | `/candles/{symbol}?minutes=60` | Per-minute OHLCV (max 1440 = 1 day) |
| `GET` | `/anomalies/recent?limit=20` | Z-score volume anomalies (Layer 1) |
| `GET` | `/anomalies/ml?hours=6` | ARIMA_PLUS anomalies (Layer 2) |
| `GET` | `/whales/recent?limit=20` | Trades > p99 USD volume per symbol |

OpenAPI docs auto-served at `/docs`.

## Local dev

```bash
cd api-public
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export GCP_PROJECT_ID=project-1f299b47-8676-4148-acb
gcloud auth application-default login

uvicorn main:app --reload --port 8080
# http://localhost:8080/docs
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GCP_PROJECT_ID` | required | BQ project to query |
| `BQ_DATASET` | `transactions_ds` | Dataset name |
| `ALLOWED_SYMBOLS` | `BTC-USD,ETH-USD,SOL-USD` | Comma-separated allow-list, blocks unknown symbols at the API edge |
| `MAX_BYTES_BILLED` | `104857600` (100 MB) | Hard per-query scan cap — stops a runaway query from costing real money |
| `PORT` | `8080` | Cloud Run sets this |

## Cost protection — layered controls

1. **Cloud Run IAM** — `crypto-api` is deployed with `--no-allow-unauthenticated`; only `sa-dashboard-next` can invoke it.
2. **Dashboard rate limiting** — public `/api/*` routes reject abusive traffic before reaching FastAPI.
3. **Cloud Run scaling cap** — `--max-instances 5` at deploy time bounds concurrent compute.
4. **BigQuery `maximum_bytes_billed`** — every query is rejected if it would scan > 100 MB. Worst-case query cost: < EUR 0.001.
5. **Symbol allow-list** — `_validate_symbol()` rejects anything outside the configured set with a 404, before a query is even built.

Together: even if the public dashboard routes are hammered, traffic is bounded
before it can become an expensive BigQuery workload. Without the caps, a
malicious actor running `/candles/BTC-USD` in a tight loop with a buggy filter
could scan TBs and rack up real charges.

## Why FastAPI

- Async by default — fits the I/O-bound nature of "wait for BigQuery, return JSON".
- Auto-generated OpenAPI docs at `/docs` — recruiters can explore endpoints visually.
- Pydantic-style validation on path/query params (`Annotated[int, Query(ge=1, le=1440)]`) — invalid input → 422 before it reaches your code.
- The standard for Python web APIs in 2025 — what every recent job posting uses.

## Why private behind the dashboard

The earlier portfolio version exposed this API directly. The current design is
safer: `crypto-api` is private, and the public Next.js dashboard is the only
internet-facing surface. This keeps browser tokens and BigQuery credentials out
of reach while preserving a clickable live demo.
