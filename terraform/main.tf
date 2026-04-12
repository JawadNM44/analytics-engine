terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Uncomment to use GCS for remote state (recommended for team use)
  # backend "gcs" {
  #   bucket = "your-tf-state-bucket"
  #   prefix = "analytics-engine/state"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ── Enable required APIs ───────────────────────────────────────────────────────
resource "google_project_service" "apis" {
  for_each = toset([
    "pubsub.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "bigquery.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "eventarc.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}
