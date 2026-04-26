# ─────────────────────────────────────────────────────────────────────────────
# Dashboard helper views
#
# Dashboards (Looker Studio, Grafana, Streamlit) are happiest with
# pre-shaped views: minimal columns, predictable types, sensible time
# windows. Each chart on the dashboard maps 1-to-1 to one view here, so
# the dashboard does no JOINs and no expensive aggregations at query time.
# ─────────────────────────────────────────────────────────────────────────────

# Live tape — the most-recent N trades across all symbols. Powers the
# "live trade feed" widget on the dashboard.
resource "google_bigquery_table" "view_dashboard_recent_trades" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_dashboard_recent_trades"
  deletion_protection = false

  description = "Last 200 trades, lightweight schema for the dashboard live tape"

  view {
    query          = <<-SQL
      SELECT
        trade_time,
        product_id,
        side,
        price,
        size,
        ROUND(volume_usd, 2) AS volume_usd
      FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
      ORDER BY trade_time DESC
      LIMIT 200
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# 5-minute OHLCV — coarser candles for price/volume charts that span
# several hours. The 1-minute view is too noisy for those zoom levels.
resource "google_bigquery_table" "view_dashboard_price_history_5m" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_dashboard_price_history_5m"
  deletion_protection = false

  description = "5-minute OHLCV per symbol — last 24h, dashboard-ready"

  view {
    query          = <<-SQL
      WITH minute_bucket AS (
        SELECT
          product_id,
          TIMESTAMP_TRUNC(trade_time, MINUTE) AS minute,
          TIMESTAMP_SECONDS(
            CAST(FLOOR(UNIX_SECONDS(trade_time) / 300) * 300 AS INT64)
          ) AS bucket_5m,
          ARRAY_AGG(STRUCT(trade_time, price) ORDER BY trade_time ASC LIMIT 1)[OFFSET(0)].price  AS open,
          MAX(price) AS high,
          MIN(price) AS low,
          ARRAY_AGG(STRUCT(trade_time, price) ORDER BY trade_time DESC LIMIT 1)[OFFSET(0)].price AS close,
          SUM(volume_usd) AS volume_usd
        FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
        WHERE trade_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        GROUP BY product_id, minute, bucket_5m
      )
      SELECT
        bucket_5m AS time,
        product_id,
        ANY_VALUE(open  HAVING MIN minute) AS open,
        MAX(high) AS high,
        MIN(low)  AS low,
        ANY_VALUE(close HAVING MAX minute) AS close,
        ROUND(SUM(volume_usd), 2) AS volume_usd
      FROM minute_bucket
      GROUP BY time, product_id
      ORDER BY time DESC, product_id
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# Per-symbol totals over the last 24h — powers the bar chart and KPI
# scorecards (total trades, total volume, top-symbol).
resource "google_bigquery_table" "view_dashboard_kpis_24h" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_dashboard_kpis_24h"
  deletion_protection = false

  description = "Per-symbol KPI scorecards over the trailing 24 hours"

  view {
    query          = <<-SQL
      SELECT
        product_id,
        COUNT(*)                          AS trade_count,
        ROUND(SUM(volume_usd), 2)         AS volume_usd,
        ROUND(AVG(volume_usd), 4)         AS avg_trade_usd,
        ROUND(AVG(price), 6)              AS avg_price,
        MIN(price)                        AS low_price,
        MAX(price)                        AS high_price,
        SUM(IF(side = 'buy',  1, 0))      AS buy_trades,
        SUM(IF(side = 'sell', 1, 0))      AS sell_trades,
        ROUND(SAFE_DIVIDE(
          SUM(IF(side = 'buy',  volume_usd, 0)) - SUM(IF(side = 'sell', volume_usd, 0)),
          SUM(volume_usd)
        ), 4) AS buy_sell_imbalance,
        MAX(trade_time)                   AS latest_trade
      FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
      WHERE trade_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
      GROUP BY product_id
      ORDER BY volume_usd DESC
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# Unified anomaly feed — z-score and ML anomalies normalised into one
# shape so a single dashboard widget can render both with a "method" filter.
# Falls back gracefully when the ML model has not yet been trained
# (the LEFT JOIN on the model produces NULL rows that are filtered out).
resource "google_bigquery_table" "view_dashboard_anomalies_unified" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = "view_dashboard_anomalies_unified"
  deletion_protection = false

  description = "Z-score + ML anomalies in one schema for the dashboard alert feed"

  view {
    query          = <<-SQL
      SELECT
        minute,
        product_id,
        ROUND(volume_usd, 2)            AS volume_usd,
        method,
        CAST(NULL AS FLOAT64)           AS lower_bound,
        CAST(NULL AS FLOAT64)           AS upper_bound,
        ROUND(ABS(z_score), 2)          AS strength
      FROM `${var.project_id}.${var.bq_dataset}.view_crypto_anomalies_zscore`
      WHERE is_anomaly
      ORDER BY minute DESC
      LIMIT 500
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.view_crypto_anomalies_zscore]
}
