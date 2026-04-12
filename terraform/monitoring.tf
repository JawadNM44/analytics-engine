# ── Cloud Monitoring Dashboard ────────────────────────────────────────────────
resource "google_monitoring_dashboard" "analytics" {
  dashboard_json = jsonencode({
    displayName = "Analytics Engine — Real-Time Transactions"

    gridLayout = {
      columns = "2"
      widgets = [

        # ── Function Invocation Rate ──────────────────────────────────────────
        {
          title = "Function Invocations / min"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = join(" AND ", [
                    "resource.type=\"cloud_run_revision\"",
                    "metric.type=\"run.googleapis.com/request_count\"",
                    "resource.labels.service_name=\"${var.function_name}\"",
                  ])
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
            yAxis = { label = "req/min", scale = "LINEAR" }
          }
        },

        # ── P99 Request Latency ───────────────────────────────────────────────
        {
          title = "P99 Function Latency (ms)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = join(" AND ", [
                    "resource.type=\"cloud_run_revision\"",
                    "metric.type=\"run.googleapis.com/request_latencies\"",
                    "resource.labels.service_name=\"${var.function_name}\"",
                  ])
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_DELTA"
                    crossSeriesReducer = "REDUCE_PERCENTILE_99"
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "ms", scale = "LINEAR" }
          }
        },

        # ── Error Rate ───────────────────────────────────────────────────────
        {
          title = "Function Error Rate"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = join(" AND ", [
                    "resource.type=\"cloud_run_revision\"",
                    "metric.type=\"run.googleapis.com/request_count\"",
                    "resource.labels.service_name=\"${var.function_name}\"",
                    "metric.labels.response_code_class!=\"2xx\"",
                  ])
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
            yAxis = { label = "errors/min", scale = "LINEAR" }
          }
        },

        # ── Pub/Sub Undelivered Message Count ─────────────────────────────────
        {
          title = "Pub/Sub Undelivered Messages"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = join(" AND ", [
                    "resource.type=\"pubsub_subscription\"",
                    "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
                    "resource.labels.subscription_id=\"${var.pubsub_topic}-sub\"",
                  ])
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

        # ── Active Function Instances ─────────────────────────────────────────
        {
          title = "Active Function Instances"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = join(" AND ", [
                    "resource.type=\"cloud_run_revision\"",
                    "metric.type=\"run.googleapis.com/container/instance_count\"",
                    "resource.labels.service_name=\"${var.function_name}\"",
                  ])
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
            yAxis = { label = "instances", scale = "LINEAR" }
          }
        },

        # ── Pub/Sub Oldest Unacked Message Age ───────────────────────────────
        {
          title = "Oldest Unacked Message Age (s)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = join(" AND ", [
                    "resource.type=\"pubsub_subscription\"",
                    "metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\"",
                    "resource.labels.subscription_id=\"${var.pubsub_topic}-sub\"",
                  ])
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_MAX"
                    crossSeriesReducer = "REDUCE_MAX"
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "seconds", scale = "LINEAR" }
          }
        },

      ]
    }
  })

  depends_on = [google_project_service.apis]
}

# ── Alert Policy: high error rate ────────────────────────────────────────────
resource "google_monitoring_alert_policy" "high_error_rate" {
  display_name = "Transaction Processor — High Error Rate"
  combiner     = "OR"

  conditions {
    display_name = "Function error rate > 5% for 5 min"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"cloud_run_revision\"",
        "metric.type=\"run.googleapis.com/request_count\"",
        "metric.labels.response_code_class!=\"2xx\"",
      ])
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

  notification_channels = (
    var.alert_email != "" ? [google_monitoring_notification_channel.email[0].id] : []
  )

  alert_strategy {
    auto_close = "1800s"
  }
}

# ── Alert Policy: Pub/Sub backlog ─────────────────────────────────────────────
resource "google_monitoring_alert_policy" "pubsub_backlog" {
  display_name = "Pub/Sub — Message Backlog > 10k"
  combiner     = "OR"

  conditions {
    display_name = "Undelivered messages > 10,000 for 5 min"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type=\"pubsub_subscription\"",
        "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 10000
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  notification_channels = (
    var.alert_email != "" ? [google_monitoring_notification_channel.email[0].id] : []
  )
}

# ── Optional email notification channel ───────────────────────────────────────
resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "Alert Email"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}
