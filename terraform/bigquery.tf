# ── BigQuery Dataset ──────────────────────────────────────────────────────────

resource "google_bigquery_dataset" "transactions" {
  dataset_id                  = var.bq_dataset
  friendly_name               = "Transactions Analytics"
  description                 = "Real-time financial transaction data from the analytics engine"
  location                    = "US"
  delete_contents_on_destroy  = false

  labels = {
    env     = "production"
    service = "analytics-engine"
  }

  depends_on = [google_project_service.apis]
}

# ── Shared schema (DRY via locals) ────────────────────────────────────────────
locals {
  base_schema = [
    { name = "transaction_id",  type = "STRING",    mode = "REQUIRED", description = "UUID for the transaction" },
    { name = "timestamp",       type = "TIMESTAMP", mode = "REQUIRED", description = "Transaction wall-clock time" },
    { name = "user_id",         type = "STRING",    mode = "REQUIRED", description = "Originating user" },
    { name = "merchant",        type = "STRING",    mode = "NULLABLE", description = "Merchant name" },
    { name = "amount",          type = "FLOAT64",   mode = "REQUIRED", description = "Transaction amount" },
    { name = "currency",        type = "STRING",    mode = "NULLABLE", description = "ISO 4217 currency code" },
    { name = "card_type",       type = "STRING",    mode = "NULLABLE", description = "VISA / MASTERCARD / AMEX / DISCOVER" },
    { name = "card_last4",      type = "STRING",    mode = "NULLABLE", description = "Last 4 digits of card" },
    { name = "country_code",    type = "STRING",    mode = "NULLABLE", description = "ISO 3166-1 alpha-2 country" },
    { name = "is_international",type = "BOOL",      mode = "NULLABLE", description = "Cross-border transaction flag" },
    { name = "device_id",       type = "STRING",    mode = "NULLABLE", description = "Device fingerprint" },
    { name = "ip_address",      type = "STRING",    mode = "NULLABLE", description = "Client IP (anonymised)" },
    { name = "processed_at",    type = "TIMESTAMP", mode = "REQUIRED", description = "Function processing time (partition key)" },
    { name = "is_high_risk",    type = "BOOL",      mode = "REQUIRED", description = "True when risk rules fired" },
    { name = "risk_reasons",    type = "STRING",    mode = "NULLABLE", description = "JSON array of risk rule descriptions" },
    { name = "risk_threshold",  type = "FLOAT64",   mode = "NULLABLE", description = "Threshold used during evaluation" },
  ]
}

# ── Table: all_transactions (partitioned by day) ──────────────────────────────
resource "google_bigquery_table" "all_transactions" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = var.bq_table_all
  deletion_protection = false

  description = "Every validated transaction processed by the Cloud Function"

  time_partitioning {
    type                     = "DAY"
    field                    = "processed_at"
    require_partition_filter = false
    expiration_ms = (
      var.bq_partition_expiry_days > 0
      ? var.bq_partition_expiry_days * 86400 * 1000
      : null
    )
  }

  clustering = ["country_code", "currency", "card_type"]

  schema = jsonencode(local.base_schema)

  labels = {
    env     = "production"
    service = "analytics-engine"
  }
}

# ── Table: high_risk_transactions ─────────────────────────────────────────────
resource "google_bigquery_table" "high_risk_transactions" {
  dataset_id          = google_bigquery_dataset.transactions.dataset_id
  table_id            = var.bq_table_risk
  deletion_protection = false

  description = "Transactions that triggered at least one risk rule"

  time_partitioning {
    type  = "DAY"
    field = "processed_at"
  }

  clustering = ["country_code", "currency"]

  schema = jsonencode(local.base_schema)

  labels = {
    env     = "production"
    service = "analytics-engine"
  }
}

# ── Saved analytical queries ──────────────────────────────────────────────────
resource "google_bigquery_table" "view_hourly_volume" {
  dataset_id = google_bigquery_dataset.transactions.dataset_id
  table_id   = "view_hourly_volume"

  view {
    query = <<-SQL
      SELECT
        TIMESTAMP_TRUNC(processed_at, HOUR) AS hour,
        COUNT(*)                             AS txn_count,
        SUM(amount)                          AS total_volume,
        AVG(amount)                          AS avg_amount,
        COUNTIF(is_high_risk)                AS high_risk_count
      FROM `${var.project_id}.${var.bq_dataset}.${var.bq_table_all}`
      WHERE processed_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
      GROUP BY 1
      ORDER BY 1 DESC
    SQL
    use_legacy_sql = false
  }

  depends_on = [google_bigquery_table.all_transactions]
}
