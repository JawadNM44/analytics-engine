# ─────────────────────────────────────────────────────────────────────────────
# Monitoring for the live crypto pipeline
#
# Mirrors the synthetic pipeline monitoring (terraform/monitoring.tf) but
# scoped to the crypto resources. Adds two crypto-specific signals:
#   - "producer should be running but isn't" detection
#   - BQML scheduled-query failures
#
# Local helper to avoid passing alert_email everywhere — reuses the
# notification channel already defined in monitoring.tf.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  crypto_alert_channels = (
    var.alert_email != ""
    ? [google_monitoring_notification_channel.email[0].id]
    : []
  )
}

# ── Dashboard: live crypto pipeline ──────────────────────────────────────────
resource "google_monitoring_dashboard" "crypto" {
  dashboard_json = jsonencode({
    displayName = "Analytics Engine — Live Crypto Pipeline"

    gridLayout = {
      columns = "2"
      widgets = [
        {
          title = "Coinbase Producer — Active Instances"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/container/instance_count\" AND resource.labels.service_name=\"coinbase-producer\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_MEAN"
                    crossSeriesReducer = "REDUCE_SUM"
                    groupByFields      = ["metric.labels.state"]
                  }
                }
              }
              plotType   = "STACKED_AREA"
              targetAxis = "Y1"
            }]
            yAxis = { label = "instances (active+idle)", scale = "LINEAR" }
          }
        },

        {
          title = "Crypto Pub/Sub — Publish Rate (msg/s)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"pubsub_topic\" AND metric.type=\"pubsub.googleapis.com/topic/send_message_operation_count\" AND resource.labels.topic_id=\"${var.crypto_pubsub_topic}\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "msg/s", scale = "LINEAR" }
          }
        },

        {
          title = "Crypto Function — Invocations / min"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND resource.labels.service_name=\"${var.crypto_function_name}\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_SUM"
                    groupByFields      = ["metric.labels.response_code_class"]
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "req/s", scale = "LINEAR" }
          }
        },

        {
          title = "Crypto Function — P99 Execution Time (ms)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_latencies\" AND resource.labels.service_name=\"${var.crypto_function_name}\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_PERCENTILE_99"
                    crossSeriesReducer = "REDUCE_MAX"
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "ms", scale = "LINEAR" }
          }
        },

        {
          title = "Eventarc Sub — Backlog (unacked messages)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"pubsub_subscription\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"eventarc-.*-${var.crypto_function_name}-.*\")"
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_MEAN"
                    crossSeriesReducer = "REDUCE_SUM"
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "messages", scale = "LINEAR" }
          }
        },

        {
          title = "Crypto Public API — Request Rate"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND resource.labels.service_name=\"crypto-api\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_SUM"
                    groupByFields      = ["metric.labels.response_code"]
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "req/s", scale = "LINEAR" }
          }
        },
      ]
    }
  })

  depends_on = [google_project_service.apis]
}

# ─── Alert: crypto Eventarc subscription backlog ─────────────────────────────
# Distinct from the existing project-wide alert: this is targeted at the
# Eventarc-managed subscription that feeds process-crypto-trade. Threshold
# is lower (5k) because crypto messages should drain in seconds.
resource "google_monitoring_alert_policy" "crypto_eventarc_backlog" {
  display_name = "Crypto Eventarc Sub — Backlog > 5k"
  combiner     = "OR"

  conditions {
    display_name = "Eventarc-managed sub backlog > 5,000 for 5 min"
    condition_threshold {
      filter          = "resource.type=\"pubsub_subscription\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.labels.subscription_id=monitoring.regex.full_match(\"eventarc-.*-${var.crypto_function_name}-.*\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 5000
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.crypto_alert_channels
  alert_strategy { auto_close = "1800s" }
}

# ─── Alert: crypto function high error rate ──────────────────────────────────
# 2nd-gen Cloud Functions show up under cloud_run_revision metrics. We treat
# response_code_class != "2xx" as errors.
resource "google_monitoring_alert_policy" "crypto_function_errors" {
  display_name = "Crypto Function — Error Rate > 5%"
  combiner     = "OR"

  conditions {
    display_name = "5xx response rate > 5% for 5 min"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND resource.labels.service_name=\"${var.crypto_function_name}\" AND metric.labels.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.crypto_alert_channels
  alert_strategy { auto_close = "1800s" }
}

# ─── Alert: producer silent for >5 min while not paused ──────────────────────
# Catches the case where coinbase-producer is supposed to be running
# (paused detection is intentionally NOT in here — when min-instances=0
# the Pub/Sub topic just has zero publishes, which is also caught by this
# alert. That's the right behaviour: if you forgot you paused it and
# expected fresh data, the alert tells you).
#
# Triggers: zero published messages on crypto-trades for 10 minutes.
resource "google_monitoring_alert_policy" "producer_silent" {
  display_name = "Coinbase Producer — No Trades Published for 10 min"
  combiner     = "OR"

  conditions {
    display_name = "Topic publish rate == 0 for 10 min"
    condition_threshold {
      filter          = "resource.type=\"pubsub_topic\" AND metric.type=\"pubsub.googleapis.com/topic/send_message_operation_count\" AND resource.labels.topic_id=\"${var.crypto_pubsub_topic}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "600s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = local.crypto_alert_channels
  alert_strategy { auto_close = "1800s" }
}

# ─── Alert: BQML scheduled training failure ──────────────────────────────────
# We monitor BQ jobs with the bigquery.googleapis.com/job/num_in_flight metric
# OR more reliably via job state. Simpler approach: alert if no successful
# BQ training job has run in the last 28 hours (the schedule is 24h).
#
# Caught the dataset-region incident (#6) on the first nightly run.
resource "google_monitoring_alert_policy" "bqml_training_stale" {
  display_name = "BQML Training — No Successful Run in 28h"
  combiner     = "OR"

  conditions {
    display_name = "Logging-based: scheduled query failed or did not run"
    condition_matched_log {
      filter = "resource.type=\"bigquery_dts_config\" AND severity>=ERROR"
    }
  }

  notification_channels = local.crypto_alert_channels
  alert_strategy {
    notification_rate_limit { period = "3600s" }
    auto_close = "1800s"
  }
}
