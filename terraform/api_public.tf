# ─────────────────────────────────────────────────────────────────────────────
# Public Crypto Analytics API (Cloud Run)
#
# - Service is deployed by the GitHub Actions workflow (gcloud run deploy
#   --source ./api-public). Terraform only owns the IAM scaffolding so the
#   service identity exists before the first deploy.
# - Dedicated SA, scoped strictly to read the transactions_ds dataset and
#   run BQ jobs in the project.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_service_account" "public_api_sa" {
  account_id   = "sa-public-api"
  display_name = "Public Crypto API SA"
  description  = "Cloud Run identity for the read-only public crypto analytics API"
}

# Read access on this dataset only — not project-wide bigquery.dataViewer.
# Depends on the IAM-propagation sleep so a fresh-project Apply doesn't
# 403 before the CI SA's bigquery.admin role has propagated.
resource "google_bigquery_dataset_iam_member" "public_api_data_viewer" {
  dataset_id = google_bigquery_dataset.transactions.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.public_api_sa.email}"

  depends_on = [time_sleep.wait_for_cicd_bq_admin_propagation]
}

# Required to *run* a query (jobs are project-level, not dataset-level).
resource "google_project_iam_member" "public_api_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.public_api_sa.email}"
}

# Surface the SA email so the CI workflow can reference it.
output "public_api_sa_email" {
  value       = google_service_account.public_api_sa.email
  description = "Service account that runs the public crypto analytics API on Cloud Run"
}
