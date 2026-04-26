"""
Light unit tests for the public crypto API.
Verifies routing + symbol validation; BQ is mocked.
"""
import os
import sys
import types
import unittest
from unittest.mock import MagicMock

# Stub the BQ client module before importing main.
sys.modules.setdefault("google", types.ModuleType("google"))
sys.modules.setdefault("google.cloud", types.ModuleType("google.cloud"))
sys.modules.setdefault("google.cloud.bigquery", types.ModuleType("google.cloud.bigquery"))
sys.modules["google.cloud.bigquery"].Client = MagicMock
sys.modules["google.cloud.bigquery"].QueryJobConfig = MagicMock
sys.modules["google.cloud.bigquery"].ScalarQueryParameter = MagicMock

os.environ.setdefault("GCP_PROJECT_ID", "test-project")
os.environ.setdefault("BQ_DATASET", "transactions_ds")
os.environ.setdefault("ALLOWED_SYMBOLS", "BTC-USD,ETH-USD")

# Three directories in this repo each have a main.py (function/,
# function-crypto/, api-public/) and pytest's sys.modules cache means a
# bare `import main` inside one test file leaks across the whole run.
# Load the api-public module under a unique name via importlib instead,
# leaving sys.modules["main"] for whichever sibling test happened to set it.
import importlib.util  # noqa: E402

_API_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api-public"
)
# Add api-public to path so `from bq import BigQueryClient` inside main.py works.
sys.path.insert(0, _API_DIR)

_spec = importlib.util.spec_from_file_location(
    "api_public_main", os.path.join(_API_DIR, "main.py")
)
api = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api)

from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(api.app)


class TestRoot(unittest.TestCase):
    def test_root_lists_endpoints(self):
        r = client.get("/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["service"], "crypto-analytics-api")
        self.assertIn("BTC-USD", body["symbols"])
        self.assertTrue(any("/anomalies/recent" in e for e in body["endpoints"]))


class TestSymbolValidation(unittest.TestCase):
    def test_unknown_symbol_returns_404(self):
        r = client.get("/price/DOGE-USD")
        self.assertEqual(r.status_code, 404)
        self.assertIn("Allowed", r.json()["detail"])

    def test_known_symbol_passes_validation(self):
        # Mock BQ response so the request reaches the handler
        api.bq.run_query = MagicMock(
            return_value=[
                {
                    "price": 67000.0,
                    "price_at": "2026-04-26T12:00:00Z",
                    "price_1h_ago": 66500.0,
                    "pct_change_1h": 0.0075,
                }
            ]
        )
        r = client.get("/price/btc-usd")  # lowercase to test normalisation
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["symbol"], "BTC-USD")


class TestQueryParamValidation(unittest.TestCase):
    def test_candles_minutes_capped(self):
        r = client.get("/candles/BTC-USD?minutes=2000")
        # 1440 is the cap; FastAPI returns 422 for out-of-range query params
        self.assertEqual(r.status_code, 422)

    def test_anomalies_limit_validated(self):
        r = client.get("/anomalies/recent?limit=0")
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()
