"""
Public read-only REST API over the live crypto-trades data in BigQuery.

Design notes
────────────
- This service is *intentionally* public (`--allow-unauthenticated`).
  Every safeguard against abuse lives in two places:
    1. Cloud Run scaling limits (`--max-instances` set at deploy time).
    2. BigQuery `maximum_bytes_billed` per query (hard cap, set per request).
  Together they bound the absolute worst-case cost to ~EUR 10/day even
  under sustained abuse.

- The service holds no state and runs scale-to-zero. Cold starts are fast
  enough (~600ms) for portfolio demo use.

- Every endpoint uses BigQuery's automatic 24h query result cache, so
  repeated identical requests cost EUR 0 after the first one. Browser/CDN
  caching is hinted via `Cache-Control: max-age=10`.

- The BQ client is created once at import time and reused across requests.
  google-cloud-bigquery clients are thread-safe.

- All queries go through `bq.run_query()` which centralises the safety
  caps. Endpoints never write raw SQL strings without that wrapper.

Endpoints
─────────
  GET /                        — service info + endpoint catalog
  GET /health                  — 200/503, checks BQ connectivity
  GET /stats                   — 24h aggregate stats
  GET /price/{symbol}          — latest price + 1h change %
  GET /candles/{symbol}        — OHLCV candles (per-minute)
  GET /anomalies/recent        — z-score volume anomalies (Layer 1)
  GET /anomalies/ml            — ARIMA_PLUS anomalies (Layer 2)
  GET /whales/recent           — single-trade outliers (>p99 per symbol)
"""
from __future__ import annotations

import logging
import os
from typing import Annotated

from fastapi import FastAPI, HTTPException, Path, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from bq import BigQueryClient

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ID = os.environ["GCP_PROJECT_ID"]
DATASET = os.environ.get("BQ_DATASET", "transactions_ds")
ALLOWED_SYMBOLS = set(
    os.environ.get("ALLOWED_SYMBOLS", "BTC-USD,ETH-USD,SOL-USD").split(",")
)

# Per-request hard cap on BigQuery scan bytes. 100 MB is far more than
# any of our queries needs, but tight enough to stop a runaway query
# (e.g. a buggy WHERE clause) from costing real money.
MAX_BYTES_BILLED = int(os.environ.get("MAX_BYTES_BILLED", 100 * 1024 * 1024))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("crypto-api")

# ── App + BQ client (created once, reused) ────────────────────────────────────
app = FastAPI(
    title="Crypto Analytics API",
    description=(
        "Read-only API over a live Coinbase WebSocket → Pub/Sub → BigQuery "
        "pipeline. Two-layer anomaly detection (z-score + ARIMA_PLUS)."
    ),
    version="1.0.0",
)

# CORS open for portfolio demo + the future Looker dashboard.
# Read-only API, so the typical CORS attack surface is not relevant here.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

bq = BigQueryClient(
    project_id=PROJECT_ID,
    dataset=DATASET,
    max_bytes_billed=MAX_BYTES_BILLED,
)

# Short browser/CDN cache. The data is ~5 trades/sec, so 10s is a fine
# trade-off between freshness and protecting BigQuery from a stampede if
# this URL ever gets shared on Hacker News.
CACHE_HEADER = "public, max-age=10, stale-while-revalidate=30"


def _validate_symbol(symbol: str) -> str:
    """Normalize and gate symbols against an explicit allow-list.

    Without this, a `/price/'; DROP TABLE` style input would be safe
    (we use parameterised queries) but would still cost a BQ scan.
    Allow-listing kills the attack surface entirely.
    """
    s = symbol.upper()
    if s not in ALLOWED_SYMBOLS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown symbol '{symbol}'. Allowed: {sorted(ALLOWED_SYMBOLS)}",
        )
    return s


# ── Endpoints ─────────────────────────────────────────────────────────────────


@app.get("/")
def root() -> dict:
    """Service catalog — useful as a health check from a browser."""
    return {
        "service": "crypto-analytics-api",
        "source": "Coinbase Exchange public WebSocket (matches channel)",
        "symbols": sorted(ALLOWED_SYMBOLS),
        "endpoints": [
            "GET /health",
            "GET /stats",
            "GET /price/{symbol}",
            "GET /candles/{symbol}?minutes=60",
            "GET /anomalies/recent?limit=20",
            "GET /anomalies/ml?hours=6",
            "GET /whales/recent?limit=20",
        ],
        "docs": "/docs",
    }


@app.get("/health")
def health(response: Response) -> dict:
    """Cheap connectivity probe. Returns 503 if BigQuery is unreachable."""
    try:
        bq.run_query("SELECT 1 AS ok")
        return {"status": "ok"}
    except Exception as exc:  # noqa: BLE001
        log.warning("Health check failed: %s", exc)
        response.status_code = 503
        return {"status": "degraded", "error": str(exc)}


@app.get("/stats")
def stats(response: Response) -> dict:
    """24h aggregate stats across all symbols."""
    rows = bq.run_query(
        """
        SELECT
          product_id,
          COUNT(*)                  AS trades,
          ROUND(SUM(volume_usd), 2) AS volume_usd,
          ROUND(AVG(volume_usd), 4) AS avg_trade_usd,
          MIN(price)                AS low,
          MAX(price)                AS high,
          MAX(trade_time)           AS latest_trade
        FROM `{project}.{dataset}.crypto_trades`
        WHERE trade_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        GROUP BY product_id
        ORDER BY volume_usd DESC
        """
    )
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"window": "24h", "by_symbol": rows}


@app.get("/price/{symbol}")
def price(
    response: Response,
    symbol: Annotated[str, Path(description="e.g. BTC-USD")],
) -> dict:
    """Latest trade price + 1h delta."""
    s = _validate_symbol(symbol)
    rows = bq.run_query(
        """
        WITH latest AS (
          SELECT price, trade_time
          FROM `{project}.{dataset}.crypto_trades`
          WHERE product_id = @symbol
          ORDER BY trade_time DESC
          LIMIT 1
        ),
        an_hour_ago AS (
          SELECT price
          FROM `{project}.{dataset}.crypto_trades`
          WHERE product_id = @symbol
            AND trade_time <= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
          ORDER BY trade_time DESC
          LIMIT 1
        )
        SELECT
          (SELECT price FROM latest)               AS price,
          (SELECT trade_time FROM latest)          AS price_at,
          (SELECT price FROM an_hour_ago)          AS price_1h_ago,
          SAFE_DIVIDE(
            (SELECT price FROM latest) - (SELECT price FROM an_hour_ago),
            (SELECT price FROM an_hour_ago)
          ) AS pct_change_1h
        """,
        params={"symbol": s},
    )
    if not rows or rows[0]["price"] is None:
        raise HTTPException(status_code=404, detail=f"No trades for {s}")
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"symbol": s, **rows[0]}


@app.get("/candles/{symbol}")
def candles(
    response: Response,
    symbol: Annotated[str, Path(description="e.g. BTC-USD")],
    minutes: Annotated[int, Query(ge=1, le=1440, description="lookback window")] = 60,
) -> dict:
    """Per-minute OHLCV candles for the last N minutes (cap: 1 day)."""
    s = _validate_symbol(symbol)
    rows = bq.run_query(
        """
        SELECT
          minute,
          ROUND(open,  6)  AS open,
          ROUND(high,  6)  AS high,
          ROUND(low,   6)  AS low,
          ROUND(close, 6)  AS close,
          ROUND(volume_base, 6) AS volume_base,
          ROUND(volume_usd,  2) AS volume_usd,
          trade_count
        FROM `{project}.{dataset}.view_crypto_ohlcv_1m`
        WHERE product_id = @symbol
          AND minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @mins MINUTE)
        ORDER BY minute DESC
        """,
        params={"symbol": s, "mins": minutes},
    )
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"symbol": s, "minutes": minutes, "candles": rows}


@app.get("/anomalies/recent")
def anomalies_recent(
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    """Most recent z-score anomalies (Layer 1 — statistical baseline)."""
    rows = bq.run_query(
        """
        SELECT
          minute,
          product_id,
          ROUND(volume_usd, 2)  AS volume_usd,
          ROUND(mean_60m, 2)    AS mean_60m,
          ROUND(stddev_60m, 2)  AS stddev_60m,
          ROUND(z_score, 2)     AS z_score,
          method
        FROM `{project}.{dataset}.view_crypto_anomalies_zscore`
        WHERE is_anomaly
        ORDER BY minute DESC
        LIMIT @lim
        """,
        params={"lim": limit},
    )
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"layer": "statistical_zscore_60m", "anomalies": rows}


@app.get("/anomalies/ml")
def anomalies_ml(
    response: Response,
    hours: Annotated[int, Query(ge=1, le=24)] = 6,
) -> dict:
    """ARIMA_PLUS-driven anomalies (Layer 2 — ML model)."""
    rows = bq.run_query(
        """
        SELECT
          product_id,
          minute,
          ROUND(volume_usd, 2)        AS volume_usd,
          ROUND(lower_bound, 2)       AS lower_bound,
          ROUND(upper_bound, 2)       AS upper_bound,
          ROUND(anomaly_probability, 3) AS anomaly_probability
        FROM ML.DETECT_ANOMALIES(
          MODEL `{project}.{dataset}.model_crypto_volume_forecast`,
          STRUCT(0.95 AS anomaly_prob_threshold),
          (
            SELECT minute, product_id, volume_usd
            FROM `{project}.{dataset}.view_crypto_volume_1m`
            WHERE minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hrs HOUR)
          )
        )
        WHERE is_anomaly
        ORDER BY minute DESC, anomaly_probability DESC
        """,
        params={"hrs": hours},
    )
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"layer": "ml_arima_plus", "window_hours": hours, "anomalies": rows}


@app.get("/whales/recent")
def whales_recent(
    response: Response,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict:
    """Single trades above the 99th percentile USD volume per symbol per day."""
    rows = bq.run_query(
        """
        SELECT
          trade_time,
          product_id,
          side,
          ROUND(price, 4)          AS price,
          ROUND(size, 8)           AS size,
          ROUND(volume_usd, 2)     AS volume_usd,
          ROUND(p99_volume_usd, 2) AS p99_volume_usd,
          x_above_p99
        FROM `{project}.{dataset}.view_crypto_whale_trades`
        ORDER BY trade_time DESC
        LIMIT @lim
        """,
        params={"lim": limit},
    )
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"whales": rows}
