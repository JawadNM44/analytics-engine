"""
Transaction Producer — publishes mock financial transactions to GCP Pub/Sub.
Designed to burst 100k+ messages while respecting Pub/Sub batch limits.
"""
import json
import os
import random
import time
import uuid
from concurrent import futures
from datetime import datetime, timezone

from google.cloud import pubsub_v1
from google.oauth2 import service_account

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ID = os.environ["GCP_PROJECT_ID"]
TOPIC_ID   = os.environ.get("PUBSUB_TOPIC", "transactions")
TOTAL_MSGS = int(os.environ.get("TOTAL_MESSAGES", 100_000))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", 500))        # messages per batch
MAX_LATENCY = float(os.environ.get("BATCH_MAX_LATENCY", 0.05))  # seconds

MERCHANTS   = ["Amazon", "Walmart", "Target", "BestBuy", "Starbucks",
               "ApplePay", "Stripe", "PayPal", "Venmo", "Square"]
CURRENCIES  = ["USD", "EUR", "GBP", "CAD", "JPY"]
CARD_TYPES  = ["VISA", "MASTERCARD", "AMEX", "DISCOVER"]
RISK_ZONES  = ["US", "CA", "GB", "DE", "NG", "RU", "CN", "BR"]

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_transaction() -> dict:
    """Generate a single realistic mock transaction."""
    amount = round(random.lognormvariate(4.5, 1.5), 2)  # skewed toward low values
    amount = min(amount, 25_000.0)                        # cap at $25k
    return {
        "transaction_id":  str(uuid.uuid4()),
        "timestamp":       datetime.now(timezone.utc).isoformat(),
        "user_id":         f"user_{random.randint(1, 50_000):06d}",
        "merchant":        random.choice(MERCHANTS),
        "amount":          amount,
        "currency":        random.choice(CURRENCIES),
        "card_type":       random.choice(CARD_TYPES),
        "card_last4":      f"{random.randint(1000,9999)}",
        "country_code":    random.choice(RISK_ZONES),
        "is_international": random.random() < 0.15,
        "device_id":       str(uuid.uuid4()),
        "ip_address":      f"{random.randint(1,255)}.{random.randint(0,255)}"
                           f".{random.randint(0,255)}.{random.randint(0,255)}",
    }


def get_publisher() -> pubsub_v1.PublisherClient:
    batch_settings = pubsub_v1.types.BatchSettings(
        max_messages=BATCH_SIZE,
        max_latency=MAX_LATENCY,
    )
    return pubsub_v1.PublisherClient(batch_settings=batch_settings)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    publisher = get_publisher()
    topic_path = publisher.topic_path(PROJECT_ID, TOPIC_ID)
    publish_futures: list[futures.Future] = []

    print(f"[producer] Publishing {TOTAL_MSGS:,} transactions → {topic_path}")
    start = time.perf_counter()

    for i in range(1, TOTAL_MSGS + 1):
        txn  = make_transaction()
        data = json.dumps(txn).encode("utf-8")

        # Attributes let the function filter without deserializing the payload
        attrs = {
            "amount":   str(txn["amount"]),
            "currency": txn["currency"],
            "country":  txn["country_code"],
        }

        future = publisher.publish(topic_path, data, **attrs)
        publish_futures.append(future)

        if i % 10_000 == 0:
            elapsed = time.perf_counter() - start
            print(f"  [{i:>7,}/{TOTAL_MSGS:,}]  {elapsed:.1f}s elapsed")

    # Wait for all publishes to complete
    resolved = futures.wait(publish_futures, return_when=futures.ALL_COMPLETED)
    errors = [f.exception() for f in resolved.done if f.exception()]
    elapsed = time.perf_counter() - start

    print(f"\n[producer] Done in {elapsed:.2f}s")
    print(f"           Published : {TOTAL_MSGS - len(errors):,}")
    print(f"           Errors    : {len(errors)}")
    if errors:
        for err in errors[:5]:
            print(f"           {err}")


if __name__ == "__main__":
    main()
