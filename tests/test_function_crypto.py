"""
Unit tests for the crypto-trade Cloud Function processor.
Run with: pytest tests/ -v
"""
import base64
import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# ── Stub GCP deps so tests run without credentials ───────────────────────────
for mod in (
    "google.cloud.bigquery",
    "functions_framework",
):
    parts = mod.split(".")
    parent = None
    for i, part in enumerate(parts):
        full = ".".join(parts[: i + 1])
        if full not in sys.modules:
            m = types.ModuleType(full)
            sys.modules[full] = m
            if parent:
                setattr(parent, part, m)
        parent = sys.modules[full]

sys.modules["functions_framework"].cloud_event = lambda fn: fn  # type: ignore

# Provide a Client class on the bigquery stub
sys.modules["google.cloud.bigquery"].Client = MagicMock  # type: ignore

# ── Env vars required by the module on import ────────────────────────────────
import os

os.environ.setdefault("GCP_PROJECT_ID", "test-project")
os.environ.setdefault("BQ_DATASET", "transactions_ds")
os.environ.setdefault("BQ_TABLE_CRYPTO", "crypto_trades")

# Make the function-crypto package importable
sys.path.insert(
    0,
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "function-crypto"),
)

import main as crypto  # noqa: E402


def _valid_trade() -> dict:
    return {
        "trade_id": "BTC-USD:12345",
        "product_id": "BTC-USD",
        "side": "buy",
        "size": 0.01,
        "price": 67000.00,
        "volume_usd": 670.0,
        "trade_time": "2026-04-25T12:00:00.000000Z",
        "ingested_at": "2026-04-25T12:00:00.123456+00:00",
    }


class TestValidate(unittest.TestCase):
    def test_valid_trade(self):
        ok, reason = crypto.validate(_valid_trade())
        self.assertTrue(ok, reason)

    def test_missing_field(self):
        bad = _valid_trade()
        del bad["price"]
        ok, reason = crypto.validate(bad)
        self.assertFalse(ok)
        self.assertIn("price", reason)

    def test_negative_amount_rejected(self):
        bad = _valid_trade()
        bad["volume_usd"] = -1
        ok, reason = crypto.validate(bad)
        self.assertFalse(ok)
        self.assertIn("non-negative", reason)

    def test_size_must_be_numeric(self):
        bad = _valid_trade()
        bad["size"] = "0.01"  # string, not number
        ok, reason = crypto.validate(bad)
        self.assertFalse(ok)
        self.assertIn("size", reason)

    def test_invalid_side_rejected(self):
        bad = _valid_trade()
        bad["side"] = "long"
        ok, reason = crypto.validate(bad)
        self.assertFalse(ok)
        self.assertIn("side", reason)


class TestStreamToBq(unittest.TestCase):
    def test_idempotent_insert_uses_trade_id(self):
        fake_client = MagicMock()
        fake_client.insert_rows_json.return_value = []  # no errors
        with patch.object(crypto, "_bq_client", fake_client):
            crypto.stream_to_bq(_valid_trade())

        args, kwargs = fake_client.insert_rows_json.call_args
        self.assertEqual(kwargs["row_ids"], ["BTC-USD:12345"])

    def test_raises_on_bq_errors(self):
        fake_client = MagicMock()
        fake_client.insert_rows_json.return_value = [{"index": 0, "errors": ["nope"]}]
        with patch.object(crypto, "_bq_client", fake_client):
            with self.assertRaises(RuntimeError):
                crypto.stream_to_bq(_valid_trade())


class TestEntryPoint(unittest.TestCase):
    def _event(self, payload: dict) -> MagicMock:
        evt = MagicMock()
        evt.data = {
            "message": {
                "data": base64.b64encode(json.dumps(payload).encode()).decode()
            }
        }
        return evt

    def test_processes_valid_trade(self):
        fake_client = MagicMock()
        fake_client.insert_rows_json.return_value = []
        with patch.object(crypto, "_bq_client", fake_client):
            crypto.process_crypto_trade(self._event(_valid_trade()))
        fake_client.insert_rows_json.assert_called_once()

    def test_skips_invalid_trade_silently(self):
        bad = _valid_trade()
        del bad["product_id"]
        fake_client = MagicMock()
        with patch.object(crypto, "_bq_client", fake_client):
            crypto.process_crypto_trade(self._event(bad))
        fake_client.insert_rows_json.assert_not_called()

    def test_skips_corrupt_payload_silently(self):
        evt = MagicMock()
        evt.data = {"message": {"data": "!!!not-base64-json!!!"}}
        fake_client = MagicMock()
        with patch.object(crypto, "_bq_client", fake_client):
            crypto.process_crypto_trade(evt)  # should not raise
        fake_client.insert_rows_json.assert_not_called()


if __name__ == "__main__":
    unittest.main()
