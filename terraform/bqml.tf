# ─────────────────────────────────────────────────────────────────────────────
# BigQuery ML — anomaly detection on the live crypto trade stream
#
# Two layers, deliberately:
#
#   Layer 1 — STATISTICAL (works from minute one)
#     view_crypto_anomalies_zscore: rolling 60-min z-score on per-minute
#     volume per symbol. Flags spikes (|z| > 3) — useful immediately.
#     view_crypto_whale_trades:     individual trades > 99th percentile
#                                   (per product, per day).
#
#   Layer 2 — MACHINE LEARNING (kicks in after ~24h of data)
#     model_crypto_volume_forecast: ARIMA_PLUS, one time-series per symbol,
#     trained nightly via a scheduled query. Forecasts per-minute volume
#     with confidence intervals. ML.DETECT_ANOMALIES surfaces deviations
#     the z-score can't catch (regime shifts, seasonality breaks).
#
# Layer 1 gives us something to demo today. Layer 2 is the differentiator
# for technical reviewers — ML inside the warehouse, no extra services.
# ─────────────────────────────────────────────────────────────────────────────

# ── Input view for ARIMA_PLUS ────────────────────────────────────────────────
# ARIMA_PLUS wants a clean (timestamp, id, value) shape — minimal schema is
# faster to scan and avoids accidentally training on irrelevant columns.
resource "google_bigquery_table" "view_crypto_volume_1m" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_crypto_volume_1m"
  deletion_protection = false

  description = "Per-minute USD volume per symbol — input for ARIMA_PLUS forecasting"

  view {
    query          = <<-SQL
      SELECT
        TIMESTAMP_TRUNC(trade_time, MINUTE) AS minute,
        product_id,
        SUM(volume_usd) AS volume_usd,
        COUNT(*)        AS trade_count
      FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
      WHERE processed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY minute, product_id
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# ── Layer 1a: rolling z-score anomalies ──────────────────────────────────────
# Classic statistical baseline: window of 60 minutes per symbol, z = (x - μ) / σ.
# |z| > 3 ≈ <0.3% probability under a normal distribution → almost certainly
# an outlier. Cheap, interpretable, no training required.
resource "google_bigquery_table" "view_crypto_anomalies_zscore" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_crypto_anomalies_zscore"
  deletion_protection = false

  description = "Per-minute volume anomalies via 60-min rolling z-score"

  view {
    query          = <<-SQL
      WITH stats AS (
        SELECT
          minute,
          product_id,
          volume_usd,
          AVG(volume_usd)  OVER w AS mean_60m,
          STDDEV(volume_usd) OVER w AS stddev_60m,
          COUNT(*)         OVER w AS samples_60m
        FROM `${var.project_id}.${var.bq_dataset}.view_crypto_volume_1m`
        WINDOW w AS (
          PARTITION BY product_id
          ORDER BY UNIX_SECONDS(minute)
          RANGE BETWEEN 3600 PRECEDING AND 1 PRECEDING
        )
      )
      SELECT
        minute,
        product_id,
        volume_usd,
        mean_60m,
        stddev_60m,
        SAFE_DIVIDE(volume_usd - mean_60m, stddev_60m) AS z_score,
        ABS(SAFE_DIVIDE(volume_usd - mean_60m, stddev_60m)) > 3 AS is_anomaly,
        'zscore_60m' AS method
      FROM stats
      WHERE samples_60m >= 30  -- need a meaningful baseline before scoring
      ORDER BY minute DESC, product_id
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.view_crypto_volume_1m]
}

# ── Layer 1b: whale trades (top 1% by USD volume per product per day) ───────
# Single-trade outliers — useful for spotting individual large prints that
# the per-minute aggregation would smooth away.
resource "google_bigquery_table" "view_crypto_whale_trades" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_crypto_whale_trades"
  deletion_protection = false

  description = "Individual trades above the 99th-percentile USD volume for that symbol/day"

  view {
    query          = <<-SQL
      WITH thresholds AS (
        SELECT
          product_id,
          DATE(trade_time) AS trade_date,
          APPROX_QUANTILES(volume_usd, 100)[OFFSET(99)] AS p99_volume_usd
        FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
        WHERE processed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
        GROUP BY product_id, trade_date
      )
      SELECT
        t.trade_time,
        t.product_id,
        t.side,
        t.size,
        t.price,
        t.volume_usd,
        th.p99_volume_usd,
        ROUND(t.volume_usd / th.p99_volume_usd, 2) AS x_above_p99
      FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}` t
      JOIN thresholds th
        ON t.product_id = th.product_id
       AND DATE(t.trade_time) = th.trade_date
      WHERE t.volume_usd >= th.p99_volume_usd
      ORDER BY t.trade_time DESC
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# ── Layer 1c: hourly market summary (cheap reads for dashboards) ─────────────
resource "google_bigquery_table" "view_crypto_market_summary" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_crypto_market_summary"
  deletion_protection = false

  description = "Per-symbol per-hour summary stats — pre-aggregated for dashboards"

  view {
    query          = <<-SQL
      SELECT
        TIMESTAMP_TRUNC(trade_time, HOUR) AS hour,
        product_id,
        COUNT(*)                            AS trade_count,
        SUM(volume_usd)                     AS volume_usd,
        SUM(IF(side = 'buy',  volume_usd, 0)) AS buy_volume_usd,
        SUM(IF(side = 'sell', volume_usd, 0)) AS sell_volume_usd,
        SAFE_DIVIDE(
          SUM(IF(side = 'buy',  volume_usd, 0)) - SUM(IF(side = 'sell', volume_usd, 0)),
          SUM(volume_usd)
        ) AS buy_sell_imbalance,
        AVG(price) AS vwap_naive,
        SUM(price * size) / NULLIF(SUM(size), 0) AS vwap,
        MIN(price) AS low_price,
        MAX(price) AS high_price
      FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
      WHERE processed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY hour, product_id
      ORDER BY hour DESC, product_id
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — BigQuery ML ARIMA_PLUS volume forecast
# ─────────────────────────────────────────────────────────────────────────────

# Dedicated SA for the scheduled training query — least privilege.
resource "google_service_account" "bqml_trainer_sa" {
  account_id   = "sa-bqml-trainer"
  display_name = "BigQuery ML Trainer SA"
  description  = "Runs the nightly CREATE OR REPLACE MODEL scheduled query for crypto forecasts"
}

resource "google_project_iam_member" "bqml_trainer_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.bqml_trainer_sa.email}"
}

resource "google_project_iam_member" "bqml_trainer_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.bqml_trainer_sa.email}"
}

# BQ Data Transfer service agent must be able to mint tokens for the trainer SA.
# Depends on the IAM-propagation sleep so a fresh project deploy doesn't 403
# before the CI SA's serviceAccountAdmin role has propagated.
resource "google_service_account_iam_member" "bqdts_token_creator_on_trainer" {
  service_account_id = google_service_account.bqml_trainer_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com"

  depends_on = [
    google_project_service.apis,
    time_sleep.wait_for_cicd_sa_admin_propagation,
  ]
}

# Scheduled query — runs daily at 02:00 UTC, rebuilds the forecast model
# from the last 30 days of per-minute volume. CREATE OR REPLACE makes the
# first run also the bootstrap (no chicken-and-egg with manual setup).
#
# ARIMA_PLUS auto-tunes (p,d,q) per series, decomposes seasonality, and
# yields confidence intervals usable by ML.DETECT_ANOMALIES downstream.
resource "google_bigquery_data_transfer_config" "crypto_volume_forecast_training" {
  display_name         = "crypto-volume-forecast-nightly-training"
  location             = var.region
  data_source_id       = "scheduled_query"
  schedule             = "every day 02:00"
  service_account_name = google_service_account.bqml_trainer_sa.email

  params = {
    query = <<-SQL
      CREATE OR REPLACE MODEL `${var.project_id}.${var.bq_dataset}.model_crypto_volume_forecast`
      OPTIONS (
        model_type             = 'ARIMA_PLUS',
        time_series_timestamp_col = 'minute',
        time_series_data_col   = 'volume_usd',
        time_series_id_col     = 'product_id',
        auto_arima             = TRUE,
        data_frequency         = 'AUTO_FREQUENCY',
        decompose_time_series  = TRUE,
        holiday_region         = 'GLOBAL'
      ) AS
      SELECT minute, product_id, volume_usd
      FROM `${var.project_id}.${var.bq_dataset}.view_crypto_volume_1m`
      WHERE minute < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MINUTE);
    SQL
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.bqml_trainer_data_editor,
    google_project_iam_member.bqml_trainer_job_user,
    google_service_account_iam_member.bqdts_token_creator_on_trainer,
    google_bigquery_table.view_crypto_volume_1m,
  ]
}
