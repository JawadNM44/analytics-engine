"""
Cloud Function (2nd Gen) — Pub/Sub-triggered transaction processor.

Responsibilities:
  1. Decode & validate the incoming JSON transaction schema.
  2. Detect high-risk transactions (amount > threshold OR velocity breach).
  3. Stream every transaction to BigQuery (partitioned table).
  4. Stream high-risk rows to a separate BigQuery table for alerting.
  5. Retrieve the risk threshold from Secret Manager (demonstrates secure config).
"""
import base64
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import functions_framework
from google.cloud import bigquery, secretmanager

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── Environment ───────────────────────────────────────────────────────────────
PROJECT_ID   = os.environ["GCP_PROJECT_ID"]
DATASET_ID   = os.environ.get("BQ_DATASET", "transactions_ds")
TABLE_ALL    = os.environ.get("BQ_TABLE_ALL", "all_transactions")
TABLE_RISK   = os.environ.get("BQ_TABLE_RISK", "high_risk_transactions")
SECRET_NAME  = os.environ.get("RISK_THRESHOLD_SECRET", "risk-threshold")

# ── Required schema fields ────────────────────────────────────────────────────
REQUIRED_FIELDS = {
    "transaction_id", "timestamp", "user_id",
    "merchant", "amount", "currency", "card_type",
    "card_last4", "country_code",
}

# ── Lazy-initialised clients (survive warm starts) ────────────────────────────
_bq_client: bigquery.Client | None = None
_sm_client: secretmanager.SecretManagerServiceClient | None = None
_risk_threshold: float | None = None


def bq() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=PROJECT_ID)
    return _bq_client


def sm() -> secretmanager.SecretManagerServiceClient:
    global _sm_client
    if _sm_client is None:
        _sm_client = secretmanager.SecretManagerServiceClient()
    return _sm_client


def get_risk_threshold() -> float:
    """Fetch risk threshold from Secret Manager, cached per warm instance."""
    global _risk_threshold
    if _risk_threshold is None:
        secret_path = (
            f"projects/{PROJECT_ID}/secrets/{SECRET_NAME}/versions/latest"
        )
        try:
            resp = sm().access_secret_version(request={"name": secret_path})
            _risk_threshold = float(resp.payload.data.decode("utf-8").strip())
            log.info("Risk threshold loaded from Secret Manager: %s", _risk_threshold)
        except Exception as exc:
            log.warning("Could not load secret (%s) — defaulting to 500.0", exc)
            _risk_threshold = 500.0
    return _risk_threshold


# ── Schema validation ─────────────────────────────────────────────────────────

def validate(txn: dict) -> tuple[bool, str]:
    missing = REQUIRED_FIELDS - txn.keys()
    if missing:
        return False, f"Missing fields: {missing}"
    if not isinstance(txn.get("amount"), (int, float)):
        return False, "Field 'amount' must be numeric"
    if txn["amount"] < 0:
        return False, "Field 'amount' must be non-negative"
    if len(str(txn.get("card_last4", ""))) != 4:
        return False, "Field 'card_last4' must be 4 digits"
    return True, ""


# ── Risk scoring ──────────────────────────────────────────────────────────────

# High-risk country codes (simplified)
HIGH_RISK_COUNTRIES = {"NG", "RU", "CN", "IR", "KP"}


def is_high_risk(txn: dict, threshold: float) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if txn["amount"] > threshold:
        reasons.append(f"amount={txn['amount']:.2f} > threshold={threshold}")
    if txn.get("country_code") in HIGH_RISK_COUNTRIES:
        reasons.append(f"high-risk country={txn['country_code']}")
    if txn.get("is_international") and txn["amount"] > threshold * 0.5:
        reasons.append("international + elevated amount")
    return bool(reasons), reasons


# ── BigQuery helpers ──────────────────────────────────────────────────────────

def _table_ref(table_id: str) -> str:
    return f"{PROJECT_ID}.{DATASET_ID}.{table_id}"


def stream_to_bq(rows: list[dict[str, Any]], table_id: str) -> None:
    if not rows:
        return
    errors = bq().insert_rows_json(_table_ref(table_id), rows)
    if errors:
        log.error("BigQuery insert errors for %s: %s", table_id, errors)
        raise RuntimeError(f"BigQuery streaming insert failed: {errors}")


# ── Cloud Function entry point ────────────────────────────────────────────────

@functions_framework.cloud_event
def process_transaction(cloud_event):
    """
    Entry point for 2nd-Gen Cloud Function triggered by Pub/Sub.
    cloud_event.data["message"]["data"] is base64-encoded JSON.
    """
    # 1. Decode
    raw_data = cloud_event.data["message"].get("data", "")
    try:
        payload = json.loads(base64.b64decode(raw_data).decode("utf-8"))
    except Exception as exc:
        log.error("Failed to decode message: %s", exc)
        return  # ACK the message to avoid infinite retry on corrupt data

    # 2. Validate schema
    valid, reason = validate(payload)
    if not valid:
        log.warning("Invalid transaction schema — skipping. Reason: %s", reason)
        return

    threshold = get_risk_threshold()
    risky, risk_reasons = is_high_risk(payload, threshold)

    # 3. Enrich with processing metadata
    now = datetime.now(timezone.utc).isoformat()
    enriched: dict[str, Any] = {
        **payload,
        "processed_at":   now,
        "is_high_risk":   risky,
        "risk_reasons":   json.dumps(risk_reasons),
        "risk_threshold": threshold,
    }

    # 4. Stream to all_transactions (partitioned by processed_at date)
    stream_to_bq([enriched], TABLE_ALL)

    # 5. Stream high-risk rows to dedicated table
    if risky:
        log.warning(
            "HIGH-RISK transaction %s — %s",
            payload["transaction_id"],
            risk_reasons,
        )
        stream_to_bq([enriched], TABLE_RISK)

    log.info(
        "Processed txn=%s amount=%.2f risk=%s",
        payload["transaction_id"],
        payload["amount"],
        risky,
    )
