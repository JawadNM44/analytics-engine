"""
Unit tests for the Cloud Function processor.
Run with: pytest tests/ -v
"""
import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# ── Stub heavy GCP dependencies so tests run without credentials ──────────────
for mod in (
    "google.cloud.bigquery",
    "google.cloud.secretmanager",
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

# Provide a no-op decorator for @functions_framework.cloud_event
sys.modules["functions_framework"].cloud_event = lambda fn: fn  # type: ignore

# Now import the module under test
import importlib
import os

os.environ.setdefault("GCP_PROJECT_ID", "test-project")

function_module = importlib.import_module("function.main")

validate     = function_module.validate
is_high_risk = function_module.is_high_risk


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _good_txn(**overrides) -> dict:
    base = {
        "transaction_id": "txn-abc-123",
        "timestamp":      "2024-01-15T10:30:00+00:00",
        "user_id":        "user_001234",
        "merchant":       "Amazon",
        "amount":         49.99,
        "currency":       "USD",
        "card_type":      "VISA",
        "card_last4":     "4242",
        "country_code":   "US",
        "is_international": False,
    }
    return {**base, **overrides}


# ── Schema validation tests ───────────────────────────────────────────────────

class TestValidate(unittest.TestCase):

    def test_valid_transaction_passes(self):
        ok, msg = validate(_good_txn())
        self.assertTrue(ok)
        self.assertEqual(msg, "")

    def test_missing_required_field_fails(self):
        txn = _good_txn()
        del txn["amount"]
        ok, msg = validate(txn)
        self.assertFalse(ok)
        self.assertIn("amount", msg)

    def test_multiple_missing_fields_reported(self):
        txn = _good_txn()
        del txn["merchant"]
        del txn["currency"]
        ok, msg = validate(txn)
        self.assertFalse(ok)

    def test_negative_amount_fails(self):
        ok, msg = validate(_good_txn(amount=-1.0))
        self.assertFalse(ok)
        self.assertIn("non-negative", msg)

    def test_non_numeric_amount_fails(self):
        ok, msg = validate(_good_txn(amount="fifty"))
        self.assertFalse(ok)
        self.assertIn("numeric", msg)

    def test_wrong_card_last4_length_fails(self):
        ok, msg = validate(_good_txn(card_last4="12"))
        self.assertFalse(ok)
        self.assertIn("4 digits", msg)

    def test_zero_amount_is_valid(self):
        ok, _ = validate(_good_txn(amount=0.0))
        self.assertTrue(ok)


# ── Risk-detection tests ──────────────────────────────────────────────────────

class TestIsHighRisk(unittest.TestCase):
    THRESHOLD = 500.0

    def test_low_amount_domestic_not_risky(self):
        risky, reasons = is_high_risk(_good_txn(amount=49.99), self.THRESHOLD)
        self.assertFalse(risky)
        self.assertEqual(reasons, [])

    def test_amount_above_threshold_is_risky(self):
        risky, reasons = is_high_risk(_good_txn(amount=999.99), self.THRESHOLD)
        self.assertTrue(risky)
        self.assertTrue(any("amount" in r for r in reasons))

    def test_high_risk_country_flagged(self):
        risky, reasons = is_high_risk(
            _good_txn(amount=10.0, country_code="NG"), self.THRESHOLD
        )
        self.assertTrue(risky)
        self.assertTrue(any("country" in r for r in reasons))

    def test_international_high_amount_flagged(self):
        risky, reasons = is_high_risk(
            _good_txn(amount=300.0, is_international=True), self.THRESHOLD
        )
        self.assertTrue(risky)
        self.assertTrue(any("international" in r for r in reasons))

    def test_international_low_amount_not_flagged_by_intl_rule(self):
        # amount=50, threshold=500 → 50 < 250 (threshold*0.5), no intl flag
        risky, reasons = is_high_risk(
            _good_txn(amount=50.0, is_international=True), self.THRESHOLD
        )
        self.assertFalse(risky)

    def test_multiple_risk_reasons_accumulated(self):
        risky, reasons = is_high_risk(
            _good_txn(amount=9999.0, country_code="RU", is_international=True),
            self.THRESHOLD,
        )
        self.assertTrue(risky)
        self.assertGreaterEqual(len(reasons), 2)

    def test_exact_threshold_not_risky(self):
        # amount == threshold is NOT > threshold
        risky, _ = is_high_risk(_good_txn(amount=500.0), self.THRESHOLD)
        self.assertFalse(risky)

    def test_just_above_threshold_is_risky(self):
        risky, _ = is_high_risk(_good_txn(amount=500.01), self.THRESHOLD)
        self.assertTrue(risky)


if __name__ == "__main__":
    unittest.main()
