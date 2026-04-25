-- =============================================================================
-- Crypto trade analytics — sample queries
-- Replace `transactions_ds` with var.bq_dataset if you customised it.
-- =============================================================================

-- ── 1. Live tape (last 20 trades across all symbols) ────────────────────────
SELECT trade_time, product_id, side, price, size, ROUND(volume_usd, 2) AS usd
FROM `transactions_ds.crypto_trades`
ORDER BY trade_time DESC
LIMIT 20;

-- ── 2. Per-symbol summary (today) ───────────────────────────────────────────
SELECT
  product_id,
  COUNT(*)                         AS trades,
  ROUND(SUM(volume_usd), 0)        AS volume_usd,
  ROUND(AVG(volume_usd), 2)        AS avg_trade_usd,
  MIN(price)                       AS low,
  MAX(price)                       AS high
FROM `transactions_ds.crypto_trades`
WHERE DATE(trade_time) = CURRENT_DATE()
GROUP BY product_id
ORDER BY volume_usd DESC;

-- ── 3. OHLCV candles (per minute, last 30 min) ──────────────────────────────
SELECT *
FROM `transactions_ds.view_crypto_ohlcv_1m`
WHERE minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 MINUTE)
ORDER BY minute DESC, product_id;

-- ── 4. STATISTICAL ANOMALIES — 60-min rolling z-score on per-minute volume ──
-- Spikes beyond ±3σ are flagged. Works as soon as 30 baseline samples exist.
SELECT *
FROM `transactions_ds.view_crypto_anomalies_zscore`
WHERE is_anomaly
ORDER BY minute DESC
LIMIT 50;

-- ── 5. WHALE TRADES — single trades above the 99th percentile per symbol ────
SELECT *
FROM `transactions_ds.view_crypto_whale_trades`
WHERE DATE(trade_time) = CURRENT_DATE()
ORDER BY volume_usd DESC
LIMIT 20;

-- ── 6. HOURLY MARKET SUMMARY — buy/sell imbalance + VWAP per hour ───────────
SELECT *
FROM `transactions_ds.view_crypto_market_summary`
WHERE hour >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
ORDER BY hour DESC, product_id;

-- =============================================================================
-- LAYER 2 — BigQuery ML (requires the model to be trained first; the
-- scheduled query "crypto-volume-forecast-nightly-training" runs at 02:00 UTC.
-- To bootstrap manually after ~24h of data, run section 7 once.)
-- =============================================================================

-- ── 7. (Bootstrap) train the ARIMA_PLUS forecast model NOW ──────────────────
CREATE OR REPLACE MODEL `transactions_ds.model_crypto_volume_forecast`
OPTIONS (
  model_type                 = 'ARIMA_PLUS',
  time_series_timestamp_col  = 'minute',
  time_series_data_col       = 'volume_usd',
  time_series_id_col         = 'product_id',
  auto_arima                 = TRUE,
  data_frequency             = 'AUTO_FREQUENCY',
  decompose_time_series      = TRUE,
  holiday_region             = 'GLOBAL'
) AS
SELECT minute, product_id, volume_usd
FROM `transactions_ds.view_crypto_volume_1m`
WHERE minute < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MINUTE);

-- ── 8. Inspect what the model learned (per-symbol ARIMA coefficients) ───────
SELECT *
FROM ML.ARIMA_COEFFICIENTS(MODEL `transactions_ds.model_crypto_volume_forecast`);

-- ── 9. ML ANOMALY DETECTION — flag minutes where actual volume falls
--      outside the model's 95% confidence interval ──────────────────────────
SELECT
  product_id,
  minute,
  volume_usd,
  is_anomaly,
  lower_bound,
  upper_bound,
  anomaly_probability
FROM ML.DETECT_ANOMALIES(
  MODEL `transactions_ds.model_crypto_volume_forecast`,
  STRUCT(0.95 AS anomaly_prob_threshold),
  (
    SELECT minute, product_id, volume_usd
    FROM `transactions_ds.view_crypto_volume_1m`
    WHERE minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
  )
)
WHERE is_anomaly
ORDER BY minute DESC, product_id;

-- ── 10. FORECAST — predict the next 60 minutes of volume per symbol ─────────
SELECT *
FROM ML.FORECAST(
  MODEL `transactions_ds.model_crypto_volume_forecast`,
  STRUCT(60 AS horizon, 0.95 AS confidence_level)
)
ORDER BY product_id, forecast_timestamp;
