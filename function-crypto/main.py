from __future__ import annotations

"""
Cloud Function (2nd Gen) — Pub/Sub-triggered crypto trade ingester.

Listens on the 'crypto-trades' topic, decodes Coinbase trade events, and
streams each trade into the BigQuery `crypto_trades` table.

Compared to the synthetic transaction processor:
  • No risk scoring — that lives in BigQuery ML (anomaly detection) downstream.
  • No Secret Manager call — pure stateless transformation.
  • Idempotent inserts: insertId = trade_id so retries don't duplicate rows.
"""
import base64
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import functions_framework
from google.cloud import bigquery

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── Environment ───────────────────────────────────────────────────────────────
PROJECT_ID = os.environ["GCP_PROJECT_ID"]
DATASET_ID = os.environ.get("BQ_DATASET", "transactions_ds")
TABLE_ID = os.environ.get("BQ_TABLE_CRYPTO", "crypto_trades")

# Required fields produced by the Coinbase producer
REQUIRED_FIELDS = {
    "trade_id",
    "product_id",
    "side",
    "size",
    "price",
    "volume_usd",
    "trade_time",
    "ingested_at",
}

# ── Lazy BigQuery client (survives warm starts) ───────────────────────────────
_bq_client: bigquery.Client | None = None


def bq() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=PROJECT_ID)
    return _bq_client


# ── Validation ────────────────────────────────────────────────────────────────
def validate(trade: dict) -> tuple[bool, str]:
    missing = REQUIRED_FIELDS - trade.keys()
    if missing:
        return False, f"Missing fields: {missing}"
    for numeric in ("size", "price", "volume_usd"):
        if not isinstance(trade.get(numeric), (int, float)):
            return False, f"Field '{numeric}' must be numeric"
        if trade[numeric] < 0:
            return False, f"Field '{numeric}' must be non-negative"
    if trade["side"] not in ("buy", "sell"):
        return False, f"Field 'side' must be 'buy' or 'sell' (got {trade['side']!r})"
    return True, ""


# ── BigQuery streaming with idempotent insertId ──────────────────────────────
def _table_ref() -> str:
    return f"{PROJECT_ID}.{DATASET_ID}.{TABLE_ID}"


def stream_to_bq(row: dict[str, Any]) -> None:
    """
    Insert a single trade. Uses the trade_id as insertId so that any retry
    (Pub/Sub redelivery, function retry) is deduplicated by BigQuery's
    streaming insert layer (best-effort dedup within a 1-minute window).
    """
    errors = bq().insert_rows_json(
        _table_ref(),
        [row],
        row_ids=[row["trade_id"]],
    )
    if errors:
        log.error("BigQuery insert errors: %s", errors)
        raise RuntimeError(f"BigQuery streaming insert failed: {errors}")


# ── Cloud Function entry point ────────────────────────────────────────────────
@functions_framework.cloud_event
def process_crypto_trade(cloud_event):
    raw_data = cloud_event.data["message"].get("data", "")
    try:
        payload = json.loads(base64.b64decode(raw_data).decode("utf-8"))
    except Exception as exc:
        log.error("Failed to decode message: %s", exc)
        return  # ACK — corrupt payloads aren't worth retrying forever

    valid, reason = validate(payload)
    if not valid:
        log.warning("Invalid crypto trade — skipping. Reason: %s", reason)
        return

    enriched = {
        **payload,
        "processed_at": datetime.now(timezone.utc).isoformat(),
    }

    stream_to_bq(enriched)

    log.info(
        "trade %s %s %s size=%.8f price=%.2f vol=$%.2f",
        payload["product_id"],
        payload["side"],
        payload["trade_id"],
        payload["size"],
        payload["price"],
        payload["volume_usd"],
    )
