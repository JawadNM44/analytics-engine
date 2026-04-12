output "pubsub_topic_id" {
  description = "Fully qualified Pub/Sub topic ID"
  value       = google_pubsub_topic.transactions.id
}

output "bq_dataset" {
  description = "BigQuery dataset ID"
  value       = google_bigquery_dataset.transactions.dataset_id
}

output "bq_table_all" {
  description = "BigQuery all-transactions table"
  value       = "${var.project_id}.${var.bq_dataset}.${var.bq_table_all}"
}

output "bq_table_risk" {
  description = "BigQuery high-risk-transactions table"
  value       = "${var.project_id}.${var.bq_dataset}.${var.bq_table_risk}"
}

output "cloud_function_uri" {
  description = "Cloud Function HTTP trigger URI (Cloud Run underlying URL)"
  value       = google_cloudfunctions2_function.processor.service_config[0].uri
}

output "function_service_account" {
  description = "Service account email used by the Cloud Function"
  value       = google_service_account.function_sa.email
}

output "monitoring_dashboard_url" {
  description = "URL to the Cloud Monitoring dashboard"
  value = "https://console.cloud.google.com/monitoring/dashboards/custom/${element(split("/", google_monitoring_dashboard.analytics.id), length(split("/", google_monitoring_dashboard.analytics.id)) - 1)}?project=${var.project_id}"
}
