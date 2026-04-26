# Cost Engineering

What this project costs, why, and the levers available to change that.

> Recruiter-relevant signal: knowing your numbers and why they're what they are. Most candidates can build something. Senior engineers can tell you what it costs and how to halve it.

---

## Current monthly burn

Measured against a freshly-deployed copy of this project on 2026-04-26, in EUR (the billing account currency).

| Service | Configuration | EUR / month | % of total | Notes |
|---|---|---|---|---|
| Cloud Run `coinbase-producer` (vCPU) | 1 vCPU, **always-on** (`--no-cpu-throttling`, `min=1`) | ~52.50 | **94%** | 730 h × 3,600 s = 2,628,000 vCPU-s; first 240,000 free; rest × €0.0000216 |
| Cloud Run `coinbase-producer` (RAM) | 0.5 GiB, always-on | ~2.00 | 4% | 1,314,000 GiB-s; first 450,000 free; rest × €0.0000023 |
| Cloud Run `crypto-api` | scale-to-zero, max 5 instances | ~0.00 | 0% | Cold-start on demand; well within free tier |
| Cloud Function `process-crypto-trade` | scale-to-zero, ~5 invocations/s when producer runs | ~0.20 | < 1% | First 2M invocations/month free |
| Cloud Function `process-transaction` | scale-to-zero, idle | 0.00 | 0% | Only runs during synthetic loads |
| BigQuery storage | ~80 MB | 0.00 | 0% | First 10 GB/month free |
| BigQuery queries | views + nightly BQML training, ~100 MB scan/day | < 0.50 | < 1% | First 1 TB/month free |
| BQML training | 1 nightly `CREATE OR REPLACE MODEL`, ~10 MB scan | ~0.005 | ~0% | Negligible |
| Pub/Sub | < 1 GB/month | 0.00 | 0% | First 10 GB/month free |
| Cloud Build (CI deploys) | ~5 builds/day, ~3 min each | 0.00 | 0% | First 120 build-minutes/day free |
| Cloud Logging + Monitoring | a few hundred MB | 0.00 | 0% | First 50 GB logs / 150 MB metrics free |
| **Total** | | **~55** | | **94% from one always-on container** |

---

## Why the WebSocket worker dominates

Cloud Run was designed for **request-driven** workloads that scale to zero between requests. A WebSocket consumer is the opposite: it must hold a long-lived connection open, otherwise the connection drops and trades are lost.

Two flags pin the container in memory:

- `--min-instances=1` — Cloud Run never scales below one container.
- `--no-cpu-throttling` — CPU is *always* allocated, even when no HTTP request is in flight (otherwise the WebSocket reader thread would freeze).

Always-allocated CPU is billed per second, 24/7. That is your bill.

This is not a bug — it's the right architecture for this problem. The cost is the price of "always-on" on a managed platform. The alternatives (next section) trade that managed platform for less reliability or more operational work.

---

## Levers — cost vs trade-off

Ranked by impact on monthly burn.

### 1. Pause the WebSocket worker when not actively demoing

```bash
# Pause (instances → 0, burn → ~0):
gcloud run services update coinbase-producer --region us-central1 --min-instances=0 --quiet

# Resume:
gcloud run services update coinbase-producer --region us-central1 --min-instances=1 --quiet
```

- **Saves**: ~EUR 50/month while paused.
- **Trade-off**: no new trades arrive during the pause. Existing data in BigQuery stays.
- **Status in this repo**: this is the default. The CI workflow will not silently restart the worker — see `DEPLOY_COINBASE_PRODUCER_ON_PUSH` variable.

### 2. Move the worker to a small VM (Compute Engine / Hetzner / Hetzner CX11)

- **Cost**: ~EUR 5/month (Hetzner CX11) or ~EUR 7/month (GCP `e2-micro` outside free tier).
- **Saves**: ~EUR 45-50/month.
- **Trade-off**: lose managed deploys, no built-in healthchecks, no autoscaling, you maintain a Linux box. For a side project this is acceptable; for production it shifts operational risk to you.

### 3. CPU throttling on (`--cpu-throttling`)

- **Cost reduction**: ~EUR 30/month (CPU only billed during actual requests).
- **Trade-off**: WebSocket reader thread can be paused between client pings. The connection may silently die. Not recommended for a feed you need to be reliable.

### 4. Reduce BigQuery scan with partition + cluster discipline

Already applied in this project — `crypto_trades` is partitioned by `processed_at` and clustered on `(product_id, side)`. A query like `WHERE product_id = 'BTC-USD' AND processed_at = CURRENT_DATE()` scans MBs, not GBs. Without these, full-table scans would land us in BQ pay-per-TB territory.

### 5. Drop the synthetic pipeline if you only care about crypto

- **Saves**: < EUR 1/month — already cheap because it scales to zero.
- **Trade-off**: lose the cross-domain demonstration value. Not worth it just for cost.

---

## Free trial vs Always Free — what's actually shielding you

Two distinct programs:

**Free Trial**: $300 / ~EUR 275 in credits, 90 days. *All* usage burns credits — including Always Free quotas during this period. When credits are exhausted or 90 days lapse, GCP pauses your services after a 30-day grace period unless you actively upgrade. Your credit card is **not** charged automatically.

**Always Free Tier** (active after trial ends): permanent free quotas per service. The relevant ones for this project:
- Cloud Run: 180,000 vCPU-seconds + 360,000 GiB-seconds + 2M requests/month
- Pub/Sub: 10 GB messages/month
- BigQuery: 10 GB storage + 1 TB query data scanned/month
- Cloud Functions: 2M invocations/month

**Implication for this project after trial**: the always-on `coinbase-producer` will exhaust the 180,000 vCPU-seconds free quota in ~2 days (it consumes ~86,400/day). Beyond that you'd start paying real money. Either pause the worker or move to a VM at that point.

---

## Budget alert — your safety net

A budget is configured on this project: **EUR 50/month** with notifications at 50%, 90%, 100%, and 150%. Notifications go to the billing-account-owner email. The budget *alerts* — it does not stop spend. If a runaway cost ever hits, you get four emails over hours/days, far before any catastrophic damage.

To inspect or change:

```bash
gcloud billing budgets list --billing-account=015258-60EBE2-637561
```

Console: https://console.cloud.google.com/billing/015258-60EBE2-637561/budgets

---

## Cost protection on the public API

Three independent layers prevent the public `/anomalies/recent` URL from becoming an attack vector:

1. **`--max-instances 5`** caps concurrent compute. A traffic spike serves slowly, not expensively.
2. **`MAX_BYTES_BILLED=104857600`** (100 MB) on every BigQuery query. A single rogue query costs at most ~EUR 0.001.
3. **`ALLOWED_SYMBOLS` allow-list**. Unknown symbols are rejected at the API edge with HTTP 404 *before* any BQ call is made.

Worst-case under sustained abuse: ~EUR 10/day. Without these, a bot scanning the URL could rack up real charges.

---

## How to read your billing console

1. https://console.cloud.google.com/billing/015258-60EBE2-637561/reports → "Reports" view shows cost per service, per day.
2. Group by **Service** to see which line item is dominant.
3. Group by **SKU** to see the exact billable item (e.g. "Cloud Run vCPU Allocation Time" vs "Cloud Run Memory Allocation Time").
4. Filter by date range; the trailing-30-days view is the most informative.

If the dominant line item is anything other than Cloud Run vCPU, something has gone wrong — investigate.

---

## Engineering principle behind these numbers

The pattern: **make scaling-to-zero the default, pay only for the one component that can't**.

This is the modern serverless playbook:

- Storage is cheap and pay-per-byte (BigQuery, GCS).
- Compute is pay-per-request when possible (Cloud Run, Functions).
- The dominant cost is whatever has to remain running.
- Architecture decisions follow that constraint: anything that can be a stateless event handler should be one.

Inverted: a project where everything is "always on" pays at every layer. A project where one component is always on (because the workload demands it) and everything else scales to zero pays for that one component only.

---

## What this number tells a recruiter

**Wrong frame**: "EUR 55/month is cheap" — that's relative, not informative.

**Right frame** (what you actually say in an interview):

> "The system costs ~EUR 55/month, dominated by one always-on Cloud Run instance for the WebSocket worker (94%). The rest scales to zero. I considered moving the worker to a EUR 5 Hetzner VM but kept it on Cloud Run for managed deploys and consistent monitoring. If I scaled to 100 symbols, the cost stays roughly flat — 100 symbols multiplexed over the same connection — until I hit BigQuery query volume, which would scale linearly."

That answer shows: you measured it, you know the dominant item, you considered alternatives, you understand how it scales.
