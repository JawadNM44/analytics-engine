# ── Zip the function source ───────────────────────────────────────────────────
data "archive_file" "function_zip" {
  type        = "zip"
  output_path = "${path.module}/../.build/function.zip"

  source {
    content  = file("${path.module}/../function/main.py")
    filename = "main.py"
  }

  source {
    content  = file("${path.module}/../function/requirements.txt")
    filename = "requirements.txt"
  }
}

# ── GCS bucket to hold the function artifact ──────────────────────────────────
resource "google_storage_bucket" "function_artifacts" {
  name                        = "${var.project_id}-function-artifacts"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition { age = 30 }
    action    { type = "Delete" }
  }
}

resource "google_storage_bucket_object" "function_zip" {
  name   = "function-${data.archive_file.function_zip.output_sha256}.zip"
  bucket = google_storage_bucket.function_artifacts.name
  source = data.archive_file.function_zip.output_path
}

# ── Secret Manager: risk threshold ───────────────────────────────────────────
resource "google_secret_manager_secret" "risk_threshold" {
  secret_id = "risk-threshold"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "risk_threshold" {
  secret      = google_secret_manager_secret.risk_threshold.id
  secret_data = tostring(var.risk_threshold)
}

# ── Cloud Function 2nd Gen ────────────────────────────────────────────────────
resource "google_cloudfunctions2_function" "processor" {
  provider    = google-beta
  name        = var.function_name
  location    = var.region
  description = "Validates, scores, and streams financial transactions to BigQuery"

  build_config {
    runtime          = "python312"
    entry_point      = "process_transaction"
    service_account  = google_service_account.build_sa.id

    source {
      storage_source {
        bucket = google_storage_bucket.function_artifacts.name
        object = google_storage_bucket_object.function_zip.name
      }
    }
  }

  service_config {
    min_instance_count             = var.function_min_instances
    max_instance_count             = var.function_max_instances
    available_memory               = "256M"
    timeout_seconds                = 60
    max_instance_request_concurrency = 1
    service_account_email          = google_service_account.function_sa.email

    environment_variables = {
      GCP_PROJECT_ID          = var.project_id
      BQ_DATASET              = var.bq_dataset
      BQ_TABLE_ALL            = var.bq_table_all
      BQ_TABLE_RISK           = var.bq_table_risk
      RISK_THRESHOLD_SECRET   = google_secret_manager_secret.risk_threshold.secret_id
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.transactions.id
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = google_service_account.function_sa.email
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.risk_threshold,
    google_storage_bucket_object.function_zip,
  ]
}
