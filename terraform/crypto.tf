# ─────────────────────────────────────────────────────────────────────────────
# Crypto pipeline — Coinbase WebSocket → Pub/Sub → BigQuery
#
# Parallel to the synthetic 'transactions' pipeline. Kept in its own file so
# the data domain stays cleanly separated.
# ─────────────────────────────────────────────────────────────────────────────

# ── Pub/Sub topic for live Coinbase trades ───────────────────────────────────
resource "google_pubsub_topic" "crypto_trades" {
  name = var.crypto_pubsub_topic

  # Keep undelivered messages for 7 days
  message_retention_duration = "604800s"

  labels = {
    env     = "production"
    service = "analytics-engine"
    domain  = "crypto"
  }

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "crypto_trades_dead_letter" {
  name = var.crypto_pubsub_dead_letter_topic

  labels = {
    env     = "production"
    service = "analytics-engine"
    domain  = "crypto"
  }

  depends_on = [google_project_service.apis]
}

# NOTE: no standalone subscription is declared on this topic.
# The Eventarc trigger of process-crypto-trade creates and owns its own
# subscription (eventarc-us-central1-process-crypto-trade-...). A second
# subscription here would have no consumer, accumulating every published
# message — the original "for debugging" subscription generated a 320k+
# backlog within a day. For ad-hoc inspection use:
#   gcloud pubsub subscriptions create temp-debug --topic=crypto-trades
#   gcloud pubsub subscriptions pull temp-debug --auto-ack --limit=10
#   gcloud pubsub subscriptions delete temp-debug

# Allow Pub/Sub service agent to forward to the dead-letter topic.
resource "google_pubsub_topic_iam_member" "crypto_pubsub_sa_publisher" {
  topic  = google_pubsub_topic.crypto_trades_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# ── BigQuery table: crypto_trades ────────────────────────────────────────────
# Partitioned by processed_at (ingestion day) for cheap time-range queries.
# Clustered on product_id + side so per-symbol filtering scans minimal data.
resource "google_bigquery_table" "crypto_trades" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = var.crypto_bq_table
  deletion_protection = false

  description = "Live trade ticks from Coinbase Exchange (BTC-USD, ETH-USD, SOL-USD, ...)"

  time_partitioning {
    type  = "DAY"
    field = "processed_at"
    expiration_ms = (
      var.bq_partition_expiry_days > 0
      ? var.bq_partition_expiry_days * 86400 * 1000
      : null
    )
  }

  require_partition_filter = false
  clustering               = ["product_id", "side"]

  schema = jsonencode([
    { name = "trade_id", type = "STRING", mode = "REQUIRED", description = "Globally unique: '{product_id}:{coinbase_trade_id}'" },
    { name = "product_id", type = "STRING", mode = "REQUIRED", description = "Trading pair, e.g. BTC-USD" },
    { name = "side", type = "STRING", mode = "REQUIRED", description = "Taker side: 'buy' or 'sell'" },
    { name = "size", type = "FLOAT64", mode = "REQUIRED", description = "Quantity in base currency" },
    { name = "price", type = "FLOAT64", mode = "REQUIRED", description = "Price in quote currency" },
    { name = "volume_usd", type = "FLOAT64", mode = "REQUIRED", description = "size * price" },
    { name = "trade_time", type = "TIMESTAMP", mode = "REQUIRED", description = "Exchange-side trade timestamp" },
    { name = "ingested_at", type = "TIMESTAMP", mode = "REQUIRED", description = "Producer publish time" },
    { name = "processed_at", type = "TIMESTAMP", mode = "REQUIRED", description = "Function processing time (partition key)" },
  ])

  labels = {
    env     = "production"
    service = "analytics-engine"
    domain  = "crypto"
  }
}

# ── Saved analytical view: per-minute OHLCV ──────────────────────────────────
# OHLCV = Open / High / Low / Close / Volume — the canonical candle aggregation
# for any market data work. Pre-aggregated in BigQuery for cheap dashboard reads.
resource "google_bigquery_table" "view_crypto_ohlcv_1m" {
  dataset_id = google_bigquery_dataset.transactions.dataset_id
  table_id   = "view_crypto_ohlcv_1m"

  view {
    query          = <<-SQL
      WITH minute_bucket AS (
        SELECT
          product_id,
          TIMESTAMP_TRUNC(trade_time, MINUTE) AS minute,
          ARRAY_AGG(STRUCT(trade_time, price) ORDER BY trade_time ASC LIMIT 1)[OFFSET(0)].price  AS open,
          MAX(price)                                                                              AS high,
          MIN(price)                                                                              AS low,
          ARRAY_AGG(STRUCT(trade_time, price) ORDER BY trade_time DESC LIMIT 1)[OFFSET(0)].price AS close,
          SUM(size)                                                                               AS volume_base,
          SUM(volume_usd)                                                                         AS volume_usd,
          COUNT(*)                                                                                AS trade_count
        FROM `${var.project_id}.${var.bq_dataset}.${var.crypto_bq_table}`
        WHERE processed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        GROUP BY 1, 2
      )
      SELECT * FROM minute_bucket
      ORDER BY minute DESC, product_id
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.crypto_trades]
}

# ─────────────────────────────────────────────────────────────────────────────
# Cloud Function 2nd Gen — process-crypto-trade
# Subscribes to crypto-trades topic, validates, and streams to BigQuery.
# ─────────────────────────────────────────────────────────────────────────────

data "archive_file" "crypto_function_zip" {
  type        = "zip"
  output_path = "${path.module}/../.build/function-crypto.zip"

  source {
    content  = file("${path.module}/../function-crypto/main.py")
    filename = "main.py"
  }

  source {
    content  = file("${path.module}/../function-crypto/requirements.txt")
    filename = "requirements.txt"
  }
}

resource "google_storage_bucket_object" "crypto_function_zip" {
  name   = "function-crypto-${data.archive_file.crypto_function_zip.output_sha256}.zip"
  bucket = google_storage_bucket.function_artifacts.name
  source = data.archive_file.crypto_function_zip.output_path
}

resource "google_cloudfunctions2_function" "crypto_processor" {
  provider    = google-beta
  name        = var.crypto_function_name
  location    = var.region
  description = "Validates and streams live Coinbase trade events to BigQuery"

  build_config {
    runtime         = "python312"
    entry_point     = "process_crypto_trade"
    service_account = google_service_account.build_sa.id

    source {
      storage_source {
        bucket = google_storage_bucket.function_artifacts.name
        object = google_storage_bucket_object.crypto_function_zip.name
      }
    }
  }

  service_config {
    min_instance_count               = 0
    max_instance_count               = 50
    available_memory                 = "256M"
    timeout_seconds                  = 30
    max_instance_request_concurrency = 1
    service_account_email            = google_service_account.function_sa.email

    environment_variables = {
      GCP_PROJECT_ID  = var.project_id
      BQ_DATASET      = var.bq_dataset
      BQ_TABLE_CRYPTO = var.crypto_bq_table
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.crypto_trades.id
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = google_service_account.function_sa.email
  }

  depends_on = [
    google_project_service.apis,
    google_storage_bucket_object.crypto_function_zip,
    google_bigquery_table.crypto_trades,
  ]
}

output "crypto_function_uri" {
  value       = google_cloudfunctions2_function.crypto_processor.service_config[0].uri
  description = "Cloud Run URL backing the crypto-trade Cloud Function"
}
