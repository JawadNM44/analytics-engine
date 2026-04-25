variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "pubsub_topic" {
  description = "Name of the Pub/Sub topic for raw transactions"
  type        = string
  default     = "transactions"
}

variable "pubsub_dead_letter_topic" {
  description = "Name of the dead-letter Pub/Sub topic"
  type        = string
  default     = "transactions-dead-letter"
}

variable "bq_dataset" {
  description = "BigQuery dataset ID"
  type        = string
  default     = "transactions_ds"
}

variable "bq_table_all" {
  description = "BigQuery table for all transactions"
  type        = string
  default     = "all_transactions"
}

variable "bq_table_risk" {
  description = "BigQuery table for high-risk transactions"
  type        = string
  default     = "high_risk_transactions"
}

variable "function_name" {
  description = "Name of the Cloud Function"
  type        = string
  default     = "process-transaction"
}

variable "risk_threshold" {
  description = "Dollar amount above which a transaction is flagged high-risk"
  type        = number
  default     = 500
}

variable "function_min_instances" {
  description = "Minimum Cloud Function instances (0 = scale to zero)"
  type        = number
  default     = 0
}

variable "function_max_instances" {
  description = "Maximum Cloud Function instances"
  type        = number
  default     = 100
}

variable "bq_partition_expiry_days" {
  description = "Days before BigQuery partitions expire (0 = never)"
  type        = number
  default     = 365
}

# ── Crypto pipeline (Coinbase WebSocket → Pub/Sub → BigQuery) ────────────────
variable "crypto_pubsub_topic" {
  description = "Pub/Sub topic for live Coinbase trade events"
  type        = string
  default     = "crypto-trades"
}

variable "crypto_pubsub_dead_letter_topic" {
  description = "Dead-letter Pub/Sub topic for crypto trades"
  type        = string
  default     = "crypto-trades-dead-letter"
}

variable "crypto_bq_table" {
  description = "BigQuery table for raw crypto trades"
  type        = string
  default     = "crypto_trades"
}

variable "alert_email" {
  description = "Email address for Cloud Monitoring alerts"
  type        = string
  default     = ""
}
