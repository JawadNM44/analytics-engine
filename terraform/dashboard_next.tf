# ─────────────────────────────────────────────────────────────────────────────
# Next.js dashboard — Cloud Run frontend
#
# This is the only public-facing component of the system. It runs as
# sa-dashboard-next, which has exactly two permissions:
#   1. Invoke the (now private) crypto-api Cloud Run service
#   2. (Implicit) write its own logs
#
# The browser never reaches the FastAPI directly. All data flows go:
#   Browser → Next.js (public)  →  FastAPI (private)
#
# This dramatically reduces the attack surface: rate-limit-bypass attacks
# against the FastAPI's BQ-scan budget are impossible because no one can
# reach it without an ID token signed for the FastAPI's audience by an
# SA that has the run.invoker role.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_service_account" "dashboard_next_sa" {
  account_id   = "sa-dashboard-next"
  display_name = "Next.js Dashboard SA"
  description  = "Cloud Run identity for the public Next.js dashboard. Allowed to invoke the private FastAPI."
}

# Allow the dashboard SA to invoke the (private) crypto-api Cloud Run.
# This is the IAM binding that makes the dashboard the *only* legitimate
# caller of the FastAPI in production.
resource "google_cloud_run_service_iam_member" "dashboard_invokes_api" {
  location = var.region
  service  = "crypto-api"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.dashboard_next_sa.email}"

  # crypto-api is created by the GitHub Actions deploy step, not by Terraform.
  # We depend on the run.admin propagation gate so a fresh-project Apply
  # doesn't 403 before the CI SA has the right to set Cloud Run IAM.
  depends_on = [time_sleep.wait_for_cicd_run_admin_propagation]
}

output "dashboard_next_sa_email" {
  value       = google_service_account.dashboard_next_sa.email
  description = "Service account that runs the Next.js dashboard on Cloud Run"
}
