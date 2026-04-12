# ── Cloud Monitoring Dashboard ────────────────────────────────────────────────
resource "google_monitoring_dashboard" "analytics" {
  dashboard_json = jsonencode({
    displayName = "Analytics Engine — Real-Time Transactions"

    gridLayout = {
      columns = "2"
      widgets = [

        # ── Function Invocation Count ─────────────────────────────────────────
        {
          title = "Function Invocations / min"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND resource.labels.function_name=\"${var.function_name}\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_SUM"
                    groupByFields      = ["resource.labels.function_name"]
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "executions/min", scale = "LINEAR" }
            timeshiftDuration = "0s"
          }
        },

        # ── Execution Time (P99) ──────────────────────────────────────────────
        {
          title = "Execution Time P99 (ms)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_times\" AND resource.labels.function_name=\"${var.function_name}\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_PERCENTILE_99"
                    crossSeriesReducer = "REDUCE_MAX"
                    groupByFields      = ["resource.labels.function_name"]
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "ms", scale = "LINEAR" }
          }
        },

        # ── Function Errors ───────────────────────────────────────────────────
        {
          title = "Function Errors / min"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND resource.labels.function_name=\"${var.function_name}\" AND metric.labels.status!=\"ok\""
                  aggregation = {
                    alignmentPeriod    = "60s"
                    perSeriesAligner   = "ALIGN_RATE"
                    crossSeriesReducer = "REDUCE_SUM"
                    groupByFields      = ["metric.labels.status"]
                  }
                }
              }
              plotType   = "LINE"
              targetAxis = "Y1"
            }]
            yAxis = { label = "errors/min", scale = "LINEAR" }
          }
        },

        # ── Pub/Sub Undelivered Messages ──────────────────────────────────────
        {
          title = "Pub/Sub Undelivered Messages"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"pubsub_subscription\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.labels.subscription_id=\"${var.pubsub_topic}-sub\""
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

        # ── Active Instances ──────────────────────────────────────────────────
        {
          title = "Active Function Instances"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/container/instance_count\" AND resource.labels.service_name=\"${var.function_name}\""
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

        # ── Pub/Sub Oldest Unacked Message Age ────────────────────────────────
        {
          title = "Pub/Sub Oldest Unacked Message Age (s)"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"pubsub_subscription\" AND metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" AND resource.labels.subscription_id=\"${var.pubsub_topic}-sub\""
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

# ── Alert Policy: high error rate ─────────────────────────────────────────────
resource "google_monitoring_alert_policy" "high_error_rate" {
  display_name = "Transaction Processor — High Error Rate"
  combiner     = "OR"

  conditions {
    display_name = "Function error rate > 5% for 5 min"
    condition_threshold {
      filter          = "resource.type=\"cloud_function\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status!=\"ok\""
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
      filter          = "resource.type=\"pubsub_subscription\" AND metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\""
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
