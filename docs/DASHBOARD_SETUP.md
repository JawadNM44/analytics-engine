# Dashboard Setup — Looker Studio

This is a clickstream guide. The dashboard itself is not in version control because Looker Studio has no programmatic API — but every chart maps to a dataset/view in BigQuery, so the dashboard is fully reproducible from this document.

Time required first time: ~20 minutes. After that the dashboard auto-refreshes every 15 minutes.

---

## Prerequisites

- The Apply has run: the four `view_dashboard_*` views must exist in `transactions_ds`. Verify:
  ```bash
  bq ls transactions_ds | grep view_dashboard
  ```
  You should see four entries.
- You have at least Viewer access on the BigQuery dataset.
- You do *not* need the live producer to be running. The views work on whatever data is already in `crypto_trades`.

---

## Step 1 — Create the report

1. Go to [lookerstudio.google.com](https://lookerstudio.google.com).
2. Click **Blank Report**.
3. Pick **BigQuery** as the connector.
4. Choose your billing account → project `project-1f299b47-8676-4148-acb` → dataset `transactions_ds`.
5. **Important**: click **Custom Query** tab (not the table picker). Paste the SQL for the first chart from the recipe below. Click **Add**.
6. Name the report **"Crypto Analytics — Live"**.

---

## Step 2 — Build the charts

Six charts. Each block below has the chart type, the SQL/source view, and the dimensions/metrics to drag onto it.

### Chart 1 — KPI scorecards (top of dashboard)

- **Type**: Scorecard (4×, side by side)
- **Source**: `view_dashboard_kpis_24h`
- **Scorecards**:
  - Total trades 24h → metric: `SUM(trade_count)`
  - Total volume 24h → metric: `SUM(volume_usd)`, format USD
  - Top symbol → dimension: `product_id`, filter to top row
  - Latest trade → metric: `MAX(latest_trade)`, format datetime

### Chart 2 — Price history (5-minute candles)

- **Type**: Line chart with date range
- **Source**: `view_dashboard_price_history_5m`
- **Date range**: `time`
- **Dimension**: `time`
- **Breakdown dimension**: `product_id` (one line per symbol)
- **Metric**: `close`
- **Tip**: enable secondary y-axis for `volume_usd` as a thin bar chart underneath.

### Chart 3 — Volume by symbol (24h)

- **Type**: Bar chart (horizontal)
- **Source**: `view_dashboard_kpis_24h`
- **Dimension**: `product_id`
- **Metric**: `volume_usd`
- **Sort**: descending by `volume_usd`

### Chart 4 — Live tape

- **Type**: Table
- **Source**: `view_dashboard_recent_trades`
- **Columns**: `trade_time`, `product_id`, `side`, `price`, `volume_usd`
- **Conditional formatting**:
  - `side = 'buy'` → green text
  - `side = 'sell'` → red text
- **Sort**: `trade_time` descending
- **Pagination**: 25 rows

### Chart 5 — Anomaly feed

- **Type**: Table
- **Source**: `view_dashboard_anomalies_unified`
- **Columns**: `minute`, `product_id`, `volume_usd`, `method`, `strength`
- **Sort**: `minute` descending
- **Tip**: add a filter control on `method` so viewers can flip between z-score and ML.

### Chart 6 — Buy/Sell imbalance

- **Type**: Bullet chart (or stacked bar)
- **Source**: `view_dashboard_kpis_24h`
- **Dimension**: `product_id`
- **Metric**: `buy_sell_imbalance`
- **Range**: -1.0 to 1.0 (negative = sell-pressure, positive = buy-pressure)

---

## Step 3 — Make the dashboard public

1. Click **Share** (top right).
2. Click **Manage access**.
3. Set link sharing to **"Anyone with the link can view"**.
4. Copy the shareable URL.
5. Paste it into the README under "Live Demo" (or add it to your CV directly).

The report executes BigQuery queries under your identity at view time. Because the views are read-only and the data is non-sensitive (public exchange data), this is safe. If you later add private data, switch sharing to **specific people** and use service-account-based viewing.

---

## Step 4 — Auto-refresh

1. Open report → **File → Report settings**.
2. Set **Data freshness** to 15 minutes per data source.
3. BigQuery query result cache makes the actual cost ~0 for repeated views within those 15 min.

---

## Cost estimate

Looker Studio itself is free. The cost is whatever it scans in BigQuery on your behalf:

- All six charts read from views with `WHERE` clauses bounded to the last 24h.
- Dataset is currently ~80 MB total. Even a full reload of every chart scans well under the 1 TB monthly free tier.
- Realistic monthly cost from dashboard usage at portfolio-demo traffic: **EUR 0**.

---

## Iteration tips

- **Live tape feels stale?** Lower data-freshness to 5 minutes; the LIMIT 200 view is tiny.
- **Want a forecast chart?** Add a chart sourced from a custom query against `ML.FORECAST(MODEL ...)` — see [`analytics/bqml_queries.sql`](../analytics/bqml_queries.sql) section 10.
- **Add a private dimension** (e.g. an "interesting" flag): create another view in `terraform/dashboard_views.tf`, run terraform apply, refresh the data source in Looker Studio.

---

## Why no Terraform for the dashboard itself?

Looker Studio has no public API for report definitions (the Looker Studio API is for Looker Enterprise, a different product). Community workarounds exist (puppeteer click-bots) but they're brittle. The pragmatic answer is: **infrastructure is in Terraform, the report is a 20-minute one-time click-build documented in this file**.

If a Terraform-managed dashboard is required, the alternative is a Streamlit or Flask app deployed on Cloud Run that reads the same views — fully version-controlled, but more code to maintain.
