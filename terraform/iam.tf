# ── Service Account: Custom Build SA (replaces default Cloud Build SA) ────────
# New GCP projects disable the default Cloud Build SA via org policy.
# We create a dedicated build SA and pass it to build_config.service_account.
resource "google_service_account" "build_sa" {
  account_id   = "sa-function-build"
  display_name = "Cloud Function Build SA"
  description  = "Custom build service account for Cloud Functions 2nd Gen"
}

resource "google_project_iam_member" "build_sa_builder" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${google_service_account.build_sa.email}"
}

resource "google_project_iam_member" "build_sa_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build_sa.email}"
}

resource "google_project_iam_member" "build_sa_storage_viewer" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.build_sa.email}"
}

resource "google_project_iam_member" "build_sa_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.build_sa.email}"
}

resource "google_project_iam_member" "build_sa_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.build_sa.email}"
}

# Cloud Functions service agent must be allowed to impersonate the build SA
resource "google_service_account_iam_member" "gcf_agent_act_as_build_sa" {
  service_account_id = google_service_account.build_sa.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcf-admin-robot.iam.gserviceaccount.com"
}

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

# ── Service Account: Coinbase Producer (Cloud Run, 24/7) ─────────────────────
# Dedicated SA — least privilege: publish only to the crypto-trades topic.
resource "google_service_account" "coinbase_producer_sa" {
  account_id   = "sa-coinbase-producer"
  display_name = "Coinbase Producer SA"
  description  = "Cloud Run service account for the live Coinbase WebSocket bridge"
}

resource "google_pubsub_topic_iam_member" "coinbase_producer_publisher" {
  topic  = google_pubsub_topic.crypto_trades.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.coinbase_producer_sa.email}"
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

# roles/editor excludes setIamPolicy — CI needs this to manage IAM bindings
resource "google_project_iam_member" "cicd_iam_admin" {
  project = var.project_id
  role    = "roles/resourcemanager.projectIamAdmin"
  member  = "serviceAccount:${google_service_account.cicd_sa.email}"
}

# roles/editor excludes secretmanager.versions.access by design —
# Terraform plan needs to read secret versions to detect drift
resource "google_project_iam_member" "cicd_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cicd_sa.email}"
}

# roles/editor excludes getIamPolicy on Pub/Sub subscriptions —
# Terraform plan needs this to read current IAM state for drift detection
resource "google_project_iam_member" "cicd_security_reviewer" {
  project = var.project_id
  role    = "roles/iam.securityReviewer"
  member  = "serviceAccount:${google_service_account.cicd_sa.email}"
}

# roles/resourcemanager.projectIamAdmin only covers project-level IAM
# bindings. Setting IAM *on an individual service-account resource*
# (e.g. granting the BQ Data Transfer agent token-creator on
# sa-bqml-trainer) requires iam.serviceAccounts.setIamPolicy, which
# only roles/iam.serviceAccountAdmin grants at the SA-resource level.
resource "google_project_iam_member" "cicd_sa_admin" {
  project = var.project_id
  role    = "roles/iam.serviceAccountAdmin"
  member  = "serviceAccount:${google_service_account.cicd_sa.email}"
}

resource "google_service_account_iam_member" "github_impersonate_cicd" {
  service_account_id = google_service_account.cicd_sa.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
