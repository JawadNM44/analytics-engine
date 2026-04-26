"""
Unit tests for the Coinbase WebSocket producer.

Covers:
  - transform_match: schema mapping, type filtering, error handling
  - _make_publish_callback: success / error counter increments
  - signal handlers install gracefully on Linux/macOS

Network and Pub/Sub are mocked; no GCP credentials required.
"""
import importlib
import importlib.util
import os
import sys
import types
import unittest
from unittest.mock import MagicMock

# ── Stub external libs the module imports at top-level ──────────────────────
for mod in ("websockets", "aiohttp", "aiohttp.web"):
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)
sys.modules["aiohttp"].web = sys.modules["aiohttp.web"]
sys.modules["aiohttp.web"].Application = MagicMock
sys.modules["aiohttp.web"].AppRunner = MagicMock
sys.modules["aiohttp.web"].TCPSite = MagicMock
sys.modules["aiohttp.web"].Response = MagicMock
sys.modules["aiohttp.web"].Request = MagicMock
sys.modules["aiohttp.web"].json_response = MagicMock

if "google" not in sys.modules:
    sys.modules["google"] = types.ModuleType("google")
if "google.cloud" not in sys.modules:
    sys.modules["google.cloud"] = types.ModuleType("google.cloud")
if "google.cloud.pubsub_v1" not in sys.modules:
    sys.modules["google.cloud.pubsub_v1"] = types.ModuleType("google.cloud.pubsub_v1")
sys.modules["google.cloud.pubsub_v1"].PublisherClient = MagicMock
sys.modules["google.cloud.pubsub_v1"].types = types.SimpleNamespace(
    BatchSettings=MagicMock
)

# ── Load producer-coinbase/main.py under a unique name to avoid collision ──
_PRODUCER_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "producer-coinbase"
)
_spec = importlib.util.spec_from_file_location(
    "producer_coinbase_main", os.path.join(_PRODUCER_DIR, "main.py")
)
producer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(producer)


# ── transform_match ──────────────────────────────────────────────────────────
def _coinbase_match(**overrides) -> dict:
    base = {
        "type": "match",
        "trade_id": 12345,
        "product_id": "BTC-USD",
        "side": "buy",
        "size": "0.00123",
        "price": "67000.00",
        "time": "2026-04-25T12:00:00.000000Z",
    }
    base.update(overrides)
    return base


class TestTransformMatch(unittest.TestCase):
    def test_valid_match_normalised(self):
        out = producer.transform_match(_coinbase_match())
        self.assertEqual(out["trade_id"], "BTC-USD:12345")
        self.assertEqual(out["product_id"], "BTC-USD")
        self.assertEqual(out["side"], "buy")
        self.assertAlmostEqual(out["size"], 0.00123)
        self.assertAlmostEqual(out["price"], 67000.0)
        self.assertAlmostEqual(out["volume_usd"], round(0.00123 * 67000.0, 8))
        self.assertEqual(out["trade_time"], "2026-04-25T12:00:00.000000Z")
        self.assertIn("ingested_at", out)

    def test_last_match_also_accepted(self):
        # Coinbase emits a 'last_match' with the snapshot trade on subscribe;
        # we want it in the table just like a regular match.
        msg = _coinbase_match(type="last_match")
        out = producer.transform_match(msg)
        self.assertIsNotNone(out)
        self.assertEqual(out["product_id"], "BTC-USD")

    def test_subscription_message_skipped(self):
        msg = {"type": "subscriptions", "channels": []}
        self.assertIsNone(producer.transform_match(msg))

    def test_heartbeat_skipped(self):
        msg = {"type": "heartbeat", "product_id": "BTC-USD"}
        self.assertIsNone(producer.transform_match(msg))

    def test_unknown_type_skipped(self):
        self.assertIsNone(producer.transform_match({"type": "ticker"}))

    def test_missing_size_returns_none(self):
        msg = _coinbase_match()
        del msg["size"]
        self.assertIsNone(producer.transform_match(msg))

    def test_invalid_price_returns_none(self):
        msg = _coinbase_match(price="not-a-number")
        self.assertIsNone(producer.transform_match(msg))

    def test_namespaced_trade_id_prevents_cross_symbol_collision(self):
        a = producer.transform_match(_coinbase_match(product_id="BTC-USD", trade_id=1))
        b = producer.transform_match(_coinbase_match(product_id="ETH-USD", trade_id=1))
        self.assertNotEqual(a["trade_id"], b["trade_id"])

    def test_volume_usd_rounded_to_8_decimals(self):
        out = producer.transform_match(_coinbase_match(size="0.123456789", price="123.456789"))
        # round(0.123456789 * 123.456789, 8) — verify the rounding is applied
        expected = round(0.123456789 * 123.456789, 8)
        self.assertEqual(out["volume_usd"], expected)


# ── publish callback ─────────────────────────────────────────────────────────
class TestPublishCallback(unittest.TestCase):
    def test_success_increments_published(self):
        counters = {"published": 0, "publish_errors": 0}
        cb = producer._make_publish_callback(counters)
        future = MagicMock()
        future.exception.return_value = None
        cb(future)
        self.assertEqual(counters["published"], 1)
        self.assertEqual(counters["publish_errors"], 0)

    def test_failure_increments_publish_errors(self):
        counters = {"published": 0, "publish_errors": 0}
        cb = producer._make_publish_callback(counters)
        future = MagicMock()
        future.exception.return_value = RuntimeError("publish blew up")
        cb(future)
        self.assertEqual(counters["publish_errors"], 1)
        self.assertEqual(counters["published"], 0)


# ── signal handler installation ──────────────────────────────────────────────
class TestSignalHandlers(unittest.TestCase):
    def test_install_signal_handlers_does_not_raise(self):
        # The function must tolerate environments where add_signal_handler
        # is not implemented (e.g. Windows in unit-test container).
        loop = MagicMock()
        loop.add_signal_handler.side_effect = NotImplementedError
        # Should swallow the NotImplementedError and not propagate
        producer._install_signal_handlers(loop)


if __name__ == "__main__":
    unittest.main()
