# Changelog

All notable changes to this project. Format roughly follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.4.0] — 2026-04-26 — Frontend & polish

### Added
- **Streamlit dashboard** (`dashboard-streamlit/`) deployed to Cloud Run. Reads exclusively from the public REST API; no BigQuery credentials in the container. KPI scorecards, candlestick chart, anomaly + whale tables, ML anomaly section. Scale-to-zero, ~EUR 0/month at portfolio traffic.
- **Public REST API** (`api-public/`) — FastAPI on Cloud Run with 8 endpoints, three-layer cost protection (max-instances, max-bytes-billed, symbol allow-list), dedicated `sa-public-api` SA with dataset-only `bigquery.dataViewer`. Live at `https://crypto-api-jiuqt3hfoq-uc.a.run.app`.
- **`SECURITY.md`** — threat model (3 adversaries with specific mitigations), per-workload SA inventory, verified absences via concrete `git grep` commands.
- **`docs/COSTS.md`** — concrete monthly burn breakdown (EUR ~55, 94% from one always-on Cloud Run worker), pause/resume levers ranked by impact, free-trial vs always-free explainer.
- **`docs/DASHBOARD_SETUP.md`** — alternative click-stream guide for assembling a Looker Studio dashboard from the same views (kept as reference; Streamlit is the canonical frontend).
- **Crypto pipeline monitoring** (`terraform/monitoring_crypto.tf`) — six-widget Cloud Monitoring dashboard plus four targeted alerts (Eventarc backlog > 5k, function 5xx > 5%, producer silent for 10 min, BQML training failures).
- **Producer test coverage** — twelve unit tests for the Coinbase producer (`tests/test_producer_coinbase.py`); coverage on `producer-coinbase/` rises from 0% to ~70%.
- **Deploy gating** — `deploy-coinbase-producer` CI job now requires `vars.DEPLOY_COINBASE_PRODUCER_ON_PUSH == 'true'` or explicit `workflow_dispatch`. A merge cannot silently restart the EUR 50/mo always-on worker.
- **Budget alert** on the billing account (EUR 50/month, notifications at 50/90/100/150%).

### Fixed
- **Incident #1 — function-zip artifact lost between CI jobs**. Plan and Apply run on different runners; `actions/upload-artifact@v4` excludes hidden directories by default. Fix: `include-hidden-files: true`.
- **Incident #2 — Cloud Run rejected 256 MiB memory** when CPU is always allocated. Cloud Run requires ≥ 512 MiB with `--no-cpu-throttling`. Bump applied.
- **Incident #3 — Cloud Build SA had zero permissions** on a fresh GCP project (post-2024 security hardening). Fix: pass `--build-service-account` so builds run as our dedicated `sa-function-build`.
- **Incident #4 — IAM eventual consistency** caused a 403 race when a freshly-granted role was used immediately. Fix: `time_sleep` (90s) gates dependent resources. Pattern reused twice (`serviceAccountAdmin`, `bigquery.admin`).
- **Incident #5 — leaking Pub/Sub subscription** declared "for inspection" had no consumer; accumulated 322k messages within hours and tripped the backlog alert. Fix: removed the orphan resource; documented ad-hoc-subscription pattern for one-off debugging.
- **Incident #6 — BQML scheduled query in wrong region**. Dataset is `US` (multi-region), scheduled query was created in `us-central1`. Fix: reference `google_bigquery_dataset.transactions.location` so the two stay in lockstep.
- **BQ Data Transfer service agent lazy-creation** — granting `tokenCreator` to the BQDTS agent failed because the agent SA hadn't been materialised. Fix: `google_project_service_identity` forces creation.

### Changed
- **README** rewritten as a portfolio-grade landing page: hero metrics table above the fold, Mermaid architecture diagram, tech-stack table explaining each choice vs alternatives, live API URL, full doc index.
- Coverage scope in CI now includes `producer-coinbase` and `api-public` alongside the original `function` and `function-crypto`.

## [0.3.0] — 2026-04-25 — Live data pipeline + ML

### Added
- **Live Coinbase pipeline** (`producer-coinbase/`) — async Python WebSocket client on Cloud Run, subscribes to the public `matches` channel for BTC-USD/ETH-USD/SOL-USD, republishes every trade to Pub/Sub with `product_id` as ordering key. Auto-reconnect with exponential backoff, graceful SIGTERM, aiohttp `/health` endpoint.
- **Crypto trade processor** (`function-crypto/`) — Pub/Sub-triggered Cloud Function that validates and streams to BigQuery with `insertId = trade_id` for idempotent dedup against at-least-once delivery.
- **`crypto_trades` table** partitioned by `processed_at`, clustered on `(product_id, side)`.
- **BigQuery ML — two-layer anomaly detection** (`terraform/bqml.tf`):
  - Layer 1 (statistical, works from minute one): `view_crypto_anomalies_zscore` (60-min rolling z-score), `view_crypto_whale_trades` (> 99th percentile), `view_crypto_market_summary` (per-hour buy/sell imbalance + VWAP), `view_crypto_volume_1m` (model input).
  - Layer 2 (ML, kicks in after ~24h data): `model_crypto_volume_forecast` — `ARIMA_PLUS`, one time-series per symbol, auto-tuned (p,d,q), seasonality decomposition, holiday-aware. Retrained nightly at 02:00 UTC via a scheduled query running as dedicated `sa-bqml-trainer`.
- **Dashboard helper views** (`view_dashboard_*`) shaped one-per-chart so the frontend does no joins or aggregations at view time.
- **`analytics/bqml_queries.sql`** — ten runnable example queries for every view and ML function.

## [0.2.0] — 2026-04-12 — Synthetic pipeline hardening

### Added
- Workload Identity Federation for keyless GitHub Actions → GCP auth.
- GCS state backend with native object-generation locking (Terraform 1.7+).
- Cloud Monitoring dashboard + alert policies for the synthetic pipeline.
- Manual `production` environment approval gate before any Apply.
- Dead-letter topic and ordered subscription on the synthetic Pub/Sub pipeline.

## [0.1.0] — 2026-04-04 — Initial synthetic pipeline

### Added
- Python producer publishing JSON transactions to Pub/Sub.
- Cloud Function 2nd Gen processor: schema validation + risk scoring (amount threshold + country + velocity) using Secret Manager for the threshold value.
- BigQuery `all_transactions` and `high_risk_transactions` tables, partitioned by ingestion day.
- Terraform-managed dataset, tables, IAM, Pub/Sub topics, function deploys.
- 13 unit tests for the synthetic processor.
