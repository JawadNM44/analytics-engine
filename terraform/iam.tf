# ── Service Account: Cloud Function ──────────────────────────────────────────
resource "google_service_account" "function_sa" {
  account_id   = "sa-transaction-processor"
  display_name = "Transaction Processor Cloud Function SA"
  description  = "Least-privilege SA for the Pub/Sub-triggered Cloud Function"
}

# BigQuery — stream rows only (no read/admin)
resource "google_project_iam_member" "function_bq_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# BigQuery — run jobs (required for streaming inserts)
resource "google_project_iam_member" "function_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# Secret Manager — read secrets only
resource "google_project_iam_member" "function_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# Cloud Run invoker (required for 2nd-gen functions)
resource "google_project_iam_member" "function_run_invoker" {
  project = var.project_id
  role    = "roles/run.invoker"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# Pub/Sub subscriber (so function can acknowledge messages)
resource "google_project_iam_member" "function_pubsub_subscriber" {
  project = var.project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.function_sa.email}"
}

# ── Service Account: Producer (local or Cloud Run) ────────────────────────────
resource "google_service_account" "producer_sa" {
  account_id   = "sa-transaction-producer"
  display_name = "Transaction Producer SA"
  description  = "SA for the Python transaction producer"
}

resource "google_project_iam_member" "producer_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.producer_sa.email}"
}

# ── Eventarc SA needs pubsub.subscriber ───────────────────────────────────────
resource "google_project_iam_member" "eventarc_pubsub_sub" {
  project = var.project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-eventarc.iam.gserviceaccount.com"
}

# ── Workload Identity for GitHub Actions (keyless auth) ───────────────────────
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"
  description               = "Keyless auth for GitHub Actions CI/CD"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC Provider"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  # Only allow tokens from your specific repo
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  # Replace with your GitHub org/repo
  attribute_condition = "assertion.repository == '${var.github_repo}'"
}

resource "google_service_account" "cicd_sa" {
  account_id   = "sa-github-cicd"
  display_name = "GitHub Actions CI/CD SA"
}

# CI/CD needs to manage all infrastructure resources
resource "google_project_iam_member" "cicd_editor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.cicd_sa.email}"
}

resource "google_service_account_iam_member" "github_impersonate_cicd" {
  service_account_id = google_service_account.cicd_sa.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
