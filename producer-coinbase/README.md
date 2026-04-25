# Coinbase Producer

Streams live trades from the public Coinbase Exchange WebSocket and republishes
each trade to GCP Pub/Sub topic `crypto-trades`.

Designed to run continuously on Cloud Run (`min-instances=1`,
`--no-cpu-throttling`) so the WebSocket connection stays alive between requests.

## Local usage

```bash
cd producer-coinbase
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) Verify the WebSocket feed without publishing anywhere
python main.py --dry-run

# 2) Publish to the real Pub/Sub topic
export GCP_PROJECT_ID=project-1f299b47-8676-4148-acb
python main.py
```

## Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `COINBASE_WS_URL` | `wss://ws-feed.exchange.coinbase.com` | Public, unauthenticated |
| `PRODUCT_IDS` | `BTC-USD,ETH-USD,SOL-USD` | Comma-separated |
| `GCP_PROJECT_ID` | — | Required unless `--dry-run` |
| `PUBSUB_TOPIC` | `crypto-trades` | |
| `BATCH_MAX_MESSAGES` | `100` | Pub/Sub publisher batch size |
| `BATCH_MAX_LATENCY` | `0.25` | Seconds before flushing a partial batch |
| `HEARTBEAT_SECONDS` | `30` | Throughput log interval |
| `PORT` | `8080` | HTTP healthcheck port (Cloud Run sets this) |

## Healthcheck

The container exposes a tiny aiohttp server on `$PORT`:

| Path | Returns |
|---|---|
| `GET /` | `200 coinbase-producer ok` |
| `GET /health` | `200` if WS is connected and a trade was seen in the last 60s; `503` otherwise. Body: `{status, ws_connected, seconds_since_last_trade}` |

Cloud Run / k8s liveness probes can hit `/health` to roll the container if the WebSocket goes silent.

CLI runs that don't need the HTTP server can pass `--no-http`.

## Output schema (`crypto_trades` table)

| Field | Type | Description |
|---|---|---|
| `trade_id` | STRING | `"{product_id}:{coinbase_trade_id}"` (globally unique) |
| `product_id` | STRING | e.g. `BTC-USD` |
| `side` | STRING | `buy` or `sell` (taker side) |
| `size` | FLOAT64 | Quantity in base currency |
| `price` | FLOAT64 | Price in quote currency |
| `volume_usd` | FLOAT64 | `size * price` |
| `trade_time` | TIMESTAMP | Exchange-side trade time |
| `ingested_at` | TIMESTAMP | Producer publish time |

## Production behaviour

- **Auto-reconnect** with exponential backoff (1s → 60s) on disconnect or error.
- **Graceful shutdown** on SIGTERM (Cloud Run sends this on revision rollover).
- **Heartbeat logging** every 30s — trades, throughput, USD volume, errors.
- **Ordering keys**: each Pub/Sub message is keyed by `product_id`, allowing
  ordered delivery and per-symbol parallelism downstream.
