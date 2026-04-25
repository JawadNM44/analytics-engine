# Serverless Real-Time High-Throughput Analytics Engine

A fully automated, event-driven data pipeline on GCP that ingests, processes, and analyzes 100,000+ simulated financial transactions in real-time. Zero idle cost (scales to zero). Entirely deployed via Terraform.

**Live results:** 200,000 transactions processed · $55M simulated volume · 46.5% flagged as high-risk · 0 errors

## Architecture

```
Producer (local / Cloud Run)
        │  JSON transactions
        ▼
  GCP Pub/Sub Topic ──► Dead-Letter Topic
        │
        │  Eventarc trigger
        ▼
Cloud Function 2nd Gen
   • Schema validation
   • Risk scoring (amount threshold + country + velocity)
   • Secret Manager for threshold config
        │
        ├──► BigQuery: all_transactions       (partitioned by day)
        └──► BigQuery: high_risk_transactions (partitioned by day)

Cloud Monitoring Dashboard
   • Invocation rate  • P99 latency  • Error rate
   • Pub/Sub backlog  • Instance count
```

## Project Structure

```
.
├── producer/           # Python Pub/Sub message producer
│   ├── main.py
│   └── requirements.txt
├── function/           # 2nd-Gen Cloud Function
│   ├── main.py
│   └── requirements.txt
├── terraform/          # All infrastructure as code
│   ├── main.tf         # Provider + API enablement
│   ├── variables.tf
│   ├── outputs.tf
│   ├── pubsub.tf       # Topics + subscriptions
│   ├── bigquery.tf     # Dataset, partitioned tables, analytical view
│   ├── cloud_function.tf
│   ├── iam.tf          # Least-privilege SAs + Workload Identity for GitHub
│   ├── monitoring.tf   # Dashboard + alert policies
│   └── terraform.tfvars.example
├── tests/
│   └── test_function.py
└── .github/workflows/
    └── deploy.yml      # Test → Plan → Apply CI/CD
```

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.12+ |
| Terraform | 1.7+ |
| gcloud CLI | latest |
| GitHub Actions | — |

## Quick Start

### 1. Clone & configure

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd analytics-engine

cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# Edit terraform.tfvars — set project_id and github_repo
```

### 2. Authenticate locally

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

### 3. Deploy infrastructure

```bash
cd terraform
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

### 4. Run the producer

```bash
cd producer
pip install -r requirements.txt

export GCP_PROJECT_ID=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=path/to/producer-sa-key.json  # or use ADC
export TOTAL_MESSAGES=100000

python main.py
```

### 5. Query results in BigQuery

```sql
-- Hourly transaction volume
SELECT * FROM `YOUR_PROJECT.transactions_ds.view_hourly_volume`
ORDER BY hour DESC
LIMIT 24;

-- High-risk breakdown by country
SELECT country_code, COUNT(*) AS cnt, SUM(amount) AS total
FROM `YOUR_PROJECT.transactions_ds.high_risk_transactions`
WHERE DATE(processed_at) = CURRENT_DATE()
GROUP BY 1
ORDER BY 2 DESC;
```

## Live Crypto Pipeline (Coinbase WebSocket)

A second, independent pipeline runs alongside the synthetic one. It subscribes to the **public Coinbase Exchange WebSocket** (`wss://ws-feed.exchange.coinbase.com`, `matches` channel) for `BTC-USD`, `ETH-USD`, `SOL-USD`, and republishes every trade to Pub/Sub → Cloud Function → BigQuery. End-to-end latency: **<2s** from exchange to queryable row.

Components:

- `producer-coinbase/` — async Python WebSocket client on Cloud Run (`min-instances=1`, `--no-cpu-throttling`, dedicated SA `sa-coinbase-producer` with `pubsub.publisher` only on the `crypto-trades` topic).
- `function-crypto/` — Pub/Sub-triggered Cloud Function that validates and streams to BigQuery with `insertId = trade_id` for idempotent dedup.
- BigQuery `crypto_trades` — partitioned by ingestion day, clustered on `product_id + side`.

## Anomaly Detection (BigQuery ML)

Two layers, deployed as views and a scheduled training query in `terraform/bqml.tf`:

**Layer 1 — statistical (works immediately):**

| View | What it surfaces |
|---|---|
| `view_crypto_anomalies_zscore` | Per-minute volume spikes via 60-min rolling z-score (\|z\|>3) |
| `view_crypto_whale_trades` | Single trades above the 99th percentile per symbol per day |
| `view_crypto_market_summary` | Per-hour buy/sell imbalance + VWAP |
| `view_crypto_ohlcv_1m` | Per-minute OHLCV candles |

**Layer 2 — ML (kicks in after ~24h of data):**

A nightly scheduled query (`crypto-volume-forecast-nightly-training`, runs 02:00 UTC as `sa-bqml-trainer`) trains an `ARIMA_PLUS` model — one time-series per symbol, auto-tuned (p,d,q), with seasonality decomposition and confidence intervals.

```sql
-- Flag minutes where volume falls outside the 95% confidence interval
SELECT *
FROM ML.DETECT_ANOMALIES(
  MODEL `transactions_ds.model_crypto_volume_forecast`,
  STRUCT(0.95 AS anomaly_prob_threshold),
  (SELECT minute, product_id, volume_usd
   FROM `transactions_ds.view_crypto_volume_1m`
   WHERE minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR))
)
WHERE is_anomaly;
```

Sample queries for all views and ML functions live in [`analytics/bqml_queries.sql`](analytics/bqml_queries.sql).

## CI/CD Setup (GitHub Actions)

The pipeline uses **keyless authentication** via Workload Identity Federation — no service account JSON keys stored in GitHub.

### Required GitHub Secrets

| Secret | Value |
|--------|-------|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `WIF_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `WIF_SA_EMAIL` | `sa-github-cicd@PROJECT_ID.iam.gserviceaccount.com` |
| `ALERT_EMAIL` | (Optional) Email for Cloud Monitoring alerts |

### Pipeline

```
push / PR → Unit Tests → Terraform Fmt/Validate/Plan
                                  │
                         push to main only
                                  ▼
                    Terraform Apply (requires manual approval
                    via GitHub Environments: "production")
```

## Free Tier Strategy

| Resource | Free Tier |
|----------|-----------|
| Cloud Functions | 2M invocations/month |
| Pub/Sub | 10 GB/month |
| BigQuery | 10 GB storage + 1 TB queries/month |
| Cloud Monitoring | First 150 MB metrics/month |
| Secret Manager | 10,000 accesses/month |

With `min_instance_count = 0` the function **scales to zero** and incurs no idle compute cost.

## Running Unit Tests

```bash
pip install pytest pytest-cov functions-framework \
            google-cloud-bigquery google-cloud-secret-manager google-auth

pytest tests/ -v --cov=function
```

## Security Notes

- All service accounts follow **least privilege** — the function SA can only write to BigQuery and read secrets.
- The risk threshold is stored in **Secret Manager**, not in environment variables or code.
- GitHub Actions uses **Workload Identity Federation** — no long-lived JSON keys.
- `terraform.tfvars` and `*.json` credential files are in `.gitignore`.
