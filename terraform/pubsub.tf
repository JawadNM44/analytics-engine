# ── Pub/Sub Topics ────────────────────────────────────────────────────────────

resource "google_pubsub_topic" "transactions" {
  name = var.pubsub_topic

  # Retain undelivered messages for 7 days
  message_retention_duration = "604800s"

  labels = {
    env     = "production"
    service = "analytics-engine"
  }

  depends_on = [google_project_service.apis]
}

resource "google_pubsub_topic" "dead_letter" {
  name = var.pubsub_dead_letter_topic

  labels = {
    env     = "production"
    service = "analytics-engine"
  }

  depends_on = [google_project_service.apis]
}

# ── Subscription (used by Cloud Function trigger via Eventarc) ────────────────
# Eventarc manages its own subscription for 2nd-gen functions, but we create an
# explicit one here for monitoring and manual consumer access.

resource "google_pubsub_subscription" "transactions_sub" {
  name  = "${var.pubsub_topic}-sub"
  topic = google_pubsub_topic.transactions.name

  # Cloud Function typically processes messages within 60s; give 120s ack window
  ack_deadline_seconds = 120

  # Keep unacked messages for 7 days
  message_retention_duration = "604800s"

  # Retry policy — exponential back-off
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  expiration_policy {
    ttl = "" # Never expire
  }

  labels = {
    env     = "production"
    service = "analytics-engine"
  }
}

# ── Dead-letter subscription (so messages aren't lost) ────────────────────────
resource "google_pubsub_subscription" "dead_letter_sub" {
  name  = "${var.pubsub_dead_letter_topic}-sub"
  topic = google_pubsub_topic.dead_letter.name

  ack_deadline_seconds       = 600
  message_retention_duration = "604800s"

  expiration_policy {
    ttl = "" # Never expire
  }
}

# ── IAM: allow Pub/Sub SA to forward to dead-letter topic ────────────────────
data "google_project" "current" {}

resource "google_pubsub_topic_iam_member" "pubsub_sa_publisher" {
  topic  = google_pubsub_topic.dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription_iam_member" "pubsub_sa_subscriber" {
  subscription = google_pubsub_subscription.transactions_sub.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
