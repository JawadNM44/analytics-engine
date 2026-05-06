---
marp: true
theme: default
paginate: true
header: 'Real-Time Analytics Engine on GCP — JawadNM44/analytics-engine'
footer: 'Built April 2026 · live API + dashboard · 6 production incidents handled'
style: |
  section { font-size: 26px; }
  pre { font-size: 18px; line-height: 1.35; }
  code { font-size: 0.92em; }
  h1 { color: #1a73e8; }
  h2 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 4px; }
  table { font-size: 22px; }
  .small { font-size: 18px; }
---

<!-- _class: lead -->

# Real-Time Analytics Engine on GCP

**A serverless live-data pipeline with two-layer anomaly detection**

Live Coinbase WebSocket → Pub/Sub → Cloud Functions → BigQuery + BigQuery ML → REST API → Streamlit dashboard. Fully Terraformed, keyless CI/CD, 6 production incidents handled.

Live API: `https://crypto-api-jiuqt3hfoq-uc.a.run.app`
Live dashboard: `https://crypto-dashboard-jiuqt3hfoq-uc.a.run.app`

---

## What I built — at a glance

| | |
|---|---|
| End-to-end latency | **< 2 seconds** (exchange → queryable BigQuery row) |
| Sustained throughput | ~5 trades/sec across BTC/ETH/SOL |
| Trades processed (24h cut) | **508,615 trades · $432.9M USD volume · 0 errors** |
| Production incidents handled | **6** (postmortems in CHANGELOG.md) |
| Monthly infra cost | ~EUR 55, dominated by one always-on Cloud Run worker |
| Tests | 37/37 passing |
| Auth | Keyless — **no JSON service-account keys exist** |

> The point: not a tutorial; a working data product with cost, security, and ops thinking baked in.

---

## Architecture (high-level)

```
[Coinbase WebSocket]                     ← public, unauthenticated, 24/7
        │
        ▼
[Cloud Run: coinbase-producer]           ← async Python, always-on
        │  ordering key = product_id
        ▼
[Pub/Sub: crypto-trades] ── DLQ          ← managed bus, ordered, dead-lettered
        │  Eventarc trigger
        ▼
[Cloud Function: process-crypto-trade]   ← validate, idempotent insert
        │  insertId = trade_id
        ▼
[BigQuery: crypto_trades]                ← partitioned by day, clustered (product_id, side)
        ├── statistical views (z-score, whales, OHLCV, summary)
        ├── ARIMA_PLUS forecast model    ← retrained nightly via scheduled query
        │
        ├──► [FastAPI: crypto-api]       ← public REST, scale-to-zero
        └──► [Streamlit: crypto-dashboard] (reads via API only)

[Cloud Monitoring]: dashboard + 4 alerts        [WIF]: keyless GitHub Actions auth
```

---

## The producer — async WebSocket worker

**File**: `producer-coinbase/main.py` (387 lines, single Python file)

Why **Cloud Run** and not a Cloud Function?
- WebSockets are long-lived; Functions die after 60s
- Set `--no-cpu-throttling` so the reader thread stays alive between HTTP requests

```python
async with websockets.connect(
    COINBASE_WS_URL,
    ping_interval=20,        # heartbeat to detect dead connections
    ping_timeout=20,         # close if no pong in 20s
    close_timeout=5,
    max_size=2**20,          # 1 MiB cap; trade messages are < 1 KB
) as ws:
    subscribe = {"type": "subscribe",
                 "product_ids": PRODUCT_IDS,
                 "channels": ["matches"]}
    await ws.send(json.dumps(subscribe))
```

**Interview point**: I picked `ping_interval=20` because Cloud Run's load balancer drops idle connections after ~60s. Heartbeats every 20s keep the connection registered as live.

---

## Producer — `transform_match()` (the contract)

```python
def transform_match(msg: dict) -> dict | None:
    if msg.get("type") not in ("match", "last_match"):
        return None              # skip subscriptions/heartbeats/errors

    try:
        size  = float(msg["size"])
        price = float(msg["price"])
    except (KeyError, ValueError, TypeError):
        return None              # broken payload → drop, don't crash

    return {
        "trade_id":    f"{msg['product_id']}:{msg['trade_id']}",  # ← namespaced!
        "product_id":  msg["product_id"],
        "side":        msg["side"],
        "size":        size,
        "price":       price,
        "volume_usd":  round(size * price, 8),
        "trade_time":  msg["time"],
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
```

**Why namespace `trade_id`**: Coinbase trade IDs are unique **per product**, not globally. Without `BTC-USD:` prefix, BTC and ETH trades with the same numeric ID would collide. Caught this on day 1 — would have silently lost rows.

---

## Producer — auto-reconnect with exponential backoff

```python
backoff = RECONNECT_INITIAL  # 1.0s
while not _shutdown.is_set():
    try:
        await consume_once(publisher, topic_path, dry_run, counters)
        backoff = RECONNECT_INITIAL              # clean close → reset
    except asyncio.CancelledError:
        raise
    except Exception as exc:                     # noqa: BLE001
        _alive["ws_connected"] = False
        log.warning("WebSocket loop error: %s — reconnecting in %.1fs", exc, backoff)
        try:
            await asyncio.wait_for(_shutdown.wait(), timeout=backoff)
        except asyncio.TimeoutError:
            pass
        backoff = min(backoff * 2, RECONNECT_MAX)  # cap at 60s
```

- **Exponential backoff** (1 → 2 → 4 → 8 → 16 → 32 → 60s) prevents hammering the server during an outage.
- `asyncio.wait_for(_shutdown.wait(), timeout=backoff)` makes the wait **interruptible by SIGTERM** — graceful shutdown during a backoff window.

---

## Producer — graceful shutdown

```python
def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown.set)
        except NotImplementedError:
            pass  # Windows / restricted env — fall back to default

# In the consumer loop:
async for raw in ws:
    if _shutdown.is_set():
        log.info("Shutdown signalled — closing WebSocket")
        await ws.close()
        return
```

**Why this matters**: Cloud Run sends `SIGTERM` on every revision rollover (deploy). Without this handler, in-flight messages would be dropped mid-write. With it, the WebSocket closes cleanly and Pub/Sub flushes pending publishes.

---

## Producer — `/health` endpoint with semantic readiness

```python
async def _health(_request: web.Request) -> web.Response:
    now = time.time()
    fresh = (now - _alive["last_trade_ts"]) < 60
    healthy = _alive["ws_connected"] and (
        fresh or _alive["last_trade_ts"] == 0  # allow startup grace
    )
    body = {
        "status": "ok" if healthy else "degraded",
        "ws_connected": _alive["ws_connected"],
        "seconds_since_last_trade": (
            round(now - _alive["last_trade_ts"], 2)
            if _alive["last_trade_ts"] else None
        ),
    }
    return web.json_response(body, status=200 if healthy else 503)
```

**Interview point**: a healthcheck that returns 200 just because "the HTTP server is up" is useless. Mine returns 503 if no trade was seen in 60s — Cloud Run's liveness probe then rolls the container, which reconnects to the WebSocket. Self-healing without external orchestration.

---

## Pub/Sub configuration — `terraform/crypto.tf`

```hcl
resource "google_pubsub_topic" "crypto_trades" {
  name                       = var.crypto_pubsub_topic
  message_retention_duration = "604800s"   # 7 days
}

resource "google_pubsub_topic" "crypto_trades_dead_letter" {
  name = var.crypto_pubsub_dead_letter_topic
}

# Pub/Sub service agent must be allowed to forward to the dead-letter topic
resource "google_pubsub_topic_iam_member" "crypto_pubsub_sa_publisher" {
  topic  = google_pubsub_topic.crypto_trades_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
```

**Why no manual subscription**: the Cloud Function is wired via Eventarc, which **manages its own Pub/Sub subscription** behind the scenes. Declaring an extra one for "manual inspection" cost me 322k unacked messages (incident #5).

---

## Publisher with ordering + batching

```python
publisher = pubsub_v1.PublisherClient(
    batch_settings=pubsub_v1.types.BatchSettings(
        max_messages=BATCH_MAX_MESSAGES,    # 100
        max_latency=BATCH_MAX_LATENCY,      # 0.25s
    )
)

future = publisher.publish(
    topic_path,
    data,
    product_id=trade["product_id"],   # ← becomes the ordering key
    side=trade["side"],
)
future.add_done_callback(_make_publish_callback(counters))
```

- **Ordering key per `product_id`** keeps BTC trades in sequence with each other but lets BTC and ETH publish in parallel — best of both worlds.
- **Batching** (100 messages or 250ms, whichever first) reduces RPC overhead at our 5/sec rate without delaying the slow path.
- **Fire-and-forget** with a callback for error counting: we don't `await` each publish (would tank throughput).

---

## Cloud Function — `function-crypto/main.py`

```python
@functions_framework.cloud_event
def process_crypto_trade(cloud_event):
    try:
        payload = base64.b64decode(cloud_event.data["message"]["data"])
        trade = json.loads(payload)
    except (KeyError, ValueError, json.JSONDecodeError, binascii.Error):
        return  # corrupt → ack and drop

    ok, reason = validate(trade)
    if not ok:
        log.warning("invalid trade dropped: %s", reason)
        return

    stream_to_bq(trade)
```

The function is **38 lines of business logic**. Eventarc + Pub/Sub + retry policy do the heavy lifting.

**Why `return` and not `raise`** on bad data: raising would cause Pub/Sub to retry (and hit dead-letter after 5 attempts). Bad payloads aren't transient — they'll never succeed, so we drop silently to avoid filling the DLQ with garbage.

---

## Idempotent BigQuery insert

```python
def stream_to_bq(trade: dict) -> None:
    errors = _bq_client.insert_rows_json(
        f"{PROJECT_ID}.{BQ_DATASET}.{BQ_TABLE_CRYPTO}",
        [trade],
        row_ids=[trade["trade_id"]],     # ← BigQuery dedup window
    )
    if errors:
        raise RuntimeError(f"BQ insert failed: {errors}")
```

**This single line** (`row_ids=[trade["trade_id"]]`) handles Pub/Sub's "at-least-once" delivery contract. If the same trade is delivered twice within ~1 minute, BigQuery dedupes silently. Without it, retries would create duplicate rows that `COUNT(*)` queries would over-count by exactly the retry rate.

> A duplicated row is a *silent* bug. The pipeline reports success while delivering wrong totals.

---

## BigQuery schema — partitioning + clustering

**File**: `terraform/crypto.tf`

```hcl
resource "google_bigquery_table" "crypto_trades" {
  dataset_id = google_bigquery_dataset.transactions.dataset_id
  table_id   = var.crypto_bq_table

  time_partitioning {
    type  = "DAY"
    field = "processed_at"          # ← ingestion time, not exchange time
  }

  clustering = ["product_id", "side"]   # ← physical sort within partition

  schema = jsonencode([
    {name = "trade_id",     type = "STRING",    mode = "REQUIRED"},
    {name = "product_id",   type = "STRING",    mode = "REQUIRED"},
    {name = "side",         type = "STRING",    mode = "REQUIRED"},
    {name = "size",         type = "FLOAT",     mode = "REQUIRED"},
    {name = "price",        type = "FLOAT",     mode = "REQUIRED"},
    {name = "volume_usd",   type = "FLOAT",     mode = "REQUIRED"},
    {name = "trade_time",   type = "TIMESTAMP", mode = "REQUIRED"},
    {name = "ingested_at",  type = "TIMESTAMP", mode = "REQUIRED"},
    {name = "processed_at", type = "TIMESTAMP", mode = "REQUIRED",
     defaultValueExpression = "CURRENT_TIMESTAMP()"},
  ])
}
```

---

## Why partition by `processed_at` and not `trade_time`?

- **Partitioning**: queries filtering on the partition column scan only the relevant partition. "Today's trades" reads 1 day instead of 30.
- `processed_at` = ingestion time → grows monotonically → partitions are stable.
- `trade_time` = exchange time → can be out-of-order on retries → would create messy partitions.
- **Clustering** on `(product_id, side)`: physical sort within each partition. A query for `BTC-USD buys` reads orders of magnitude less data.

**Cost lesson**: a query with a partition filter and matching cluster keys can scan **MBs** where a naïve `SELECT *` would scan **GBs**. At BigQuery's $5/TB pricing, this is the difference between $0 and $50/month.

---

## Statistical anomaly detection — z-score view

**File**: `terraform/bqml.tf`

```sql
WITH stats AS (
  SELECT
    minute, product_id, volume_usd,
    AVG(volume_usd)    OVER w AS mean_60m,
    STDDEV(volume_usd) OVER w AS stddev_60m,
    COUNT(*)           OVER w AS samples_60m
  FROM `view_crypto_volume_1m`
  WINDOW w AS (
    PARTITION BY product_id
    ORDER BY UNIX_SECONDS(minute)
    RANGE BETWEEN 3600 PRECEDING AND 1 PRECEDING
  )
)
SELECT
  minute, product_id, volume_usd, mean_60m, stddev_60m,
  SAFE_DIVIDE(volume_usd - mean_60m, stddev_60m) AS z_score,
  ABS(SAFE_DIVIDE(volume_usd - mean_60m, stddev_60m)) > 3 AS is_anomaly
FROM stats
WHERE samples_60m >= 30                 -- need a baseline before scoring
```

**`|z| > 3`**: under a normal distribution, ≈99.7% of values fall within ±3σ. Anything outside has < 0.3% probability of being normal — almost certainly an outlier.

---

## ML anomaly detection — ARIMA_PLUS

```sql
CREATE OR REPLACE MODEL `transactions_ds.model_crypto_volume_forecast`
OPTIONS (
  model_type                = 'ARIMA_PLUS',
  time_series_timestamp_col = 'minute',
  time_series_data_col      = 'volume_usd',
  time_series_id_col        = 'product_id',     -- ← one model per symbol
  auto_arima                = TRUE,             -- ← search (p,d,q) automatically
  data_frequency            = 'AUTO_FREQUENCY',
  decompose_time_series     = TRUE,             -- ← extract trend + seasonality
  holiday_region            = 'GLOBAL'
) AS
SELECT minute, product_id, volume_usd
FROM `view_crypto_volume_1m`
WHERE minute < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MINUTE);
```

**Why ARIMA and not LSTM/Transformer**: ARIMA is the classic, well-understood choice for univariate time-series with seasonality. Same family Uber uses for demand forecasting (Prophet). For *our* data (one symbol → one volume series), neural nets would have more parameters than data points.

---

## Nightly retraining via scheduled query

```hcl
resource "google_bigquery_data_transfer_config" "crypto_volume_forecast_training" {
  display_name         = "crypto-volume-forecast-nightly-training"
  location             = google_bigquery_dataset.transactions.location  # ← match dataset region!
  data_source_id       = "scheduled_query"
  schedule             = "every day 02:00"
  service_account_name = google_service_account.bqml_trainer_sa.email

  params = {
    query = <<-SQL
      CREATE OR REPLACE MODEL `...model_crypto_volume_forecast` OPTIONS(...) AS
      SELECT minute, product_id, volume_usd FROM `...view_crypto_volume_1m`
      WHERE minute < TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), MINUTE);
    SQL
  }
}
```

**`location = ...transactions.location`**: incident #6 — the scheduled query was in `us-central1`, the dataset in `US` (multi-region). Every run failed `Not found: Dataset ... was not found in location us-central1`. **Multi-region != single region**.

---

## Detecting anomalies against the model

```sql
SELECT
  product_id, minute, volume_usd,
  is_anomaly, lower_bound, upper_bound, anomaly_probability
FROM ML.DETECT_ANOMALIES(
  MODEL `transactions_ds.model_crypto_volume_forecast`,
  STRUCT(0.95 AS anomaly_prob_threshold),
  (SELECT minute, product_id, volume_usd
   FROM `view_crypto_volume_1m`
   WHERE minute >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR))
)
WHERE is_anomaly;
```

**Why two layers** (z-score + ARIMA):
- **z-score** works from minute one but assumes stationarity. Mis-flags "busy Monday open" as anomaly.
- **ARIMA** learns hour-of-day, day-of-week patterns. A busy Monday is *expected*, not anomalous. But it needs ~24h of data to be useful.
- Running both = immediate coverage + higher-recall ML detection. Same pattern as Stripe fraud + Netflix recs.

---

## Public REST API — FastAPI on Cloud Run

**File**: `api-public/main.py`

```python
@app.get("/price/{symbol}")
def price(
    response: Response,
    symbol: Annotated[str, Path(description="e.g. BTC-USD")],
) -> dict:
    s = _validate_symbol(symbol)               # ← reject anything outside allow-list
    rows = bq.run_query("""
        SELECT
          (SELECT price FROM latest)               AS price,
          (SELECT trade_time FROM latest)          AS price_at,
          (SELECT price FROM an_hour_ago)          AS price_1h_ago,
          SAFE_DIVIDE(...) AS pct_change_1h
        ...
    """, params={"symbol": s})                # ← parameterised: no string concat
    if not rows or rows[0]["price"] is None:
        raise HTTPException(status_code=404, detail=f"No trades for {s}")
    response.headers["Cache-Control"] = CACHE_HEADER
    return {"symbol": s, **rows[0]}
```

---

## API — three layers of cost protection

```python
def _validate_symbol(symbol: str) -> str:
    s = symbol.upper()
    if s not in ALLOWED_SYMBOLS:                       # Layer 1: allow-list
        raise HTTPException(status_code=404, ...)
    return s

# In bq.py:
job_config = bigquery.QueryJobConfig(
    query_parameters=bq_params,
    use_query_cache=True,
    maximum_bytes_billed=self.max_bytes_billed,        # Layer 2: 100 MB hard cap
)

# In CI deploy:
gcloud run deploy crypto-api --max-instances 5 ...     # Layer 3: scaling cap
```

**Worst case under sustained abuse**: ~EUR 10/day. Without these layers, a bot scanning the URL could run unbounded queries.

> **Defense in depth**: each layer is independent. Any single layer failing still leaves the other two intact.

---

## Streamlit dashboard — visible ML

**File**: `dashboard-streamlit/main.py`

The dashboard reads the API only — **no BigQuery credentials in this container**. Three visualisations a generic price ticker cannot show:

1. **Candle chart with red anomaly markers** — z-score-flagged minutes overlaid as red triangles
2. **ARIMA forecast band** — actual line + shaded 95% confidence interval + red dots on ML anomalies
3. **Volume comparison bars** per symbol

```python
@st.cache_data(ttl=CACHE_TTL_SECONDS, show_spinner=False)
def fetch(path: str) -> dict | None:
    r = requests.get(f"{API_BASE}{path}", timeout=10)
    r.raise_for_status()
    return r.json()
```

**Caching matters**: every Streamlit interaction reruns the script top-to-bottom. Without `@st.cache_data` we'd hit the API once per widget per rerun. With it, **at most one API fetch per endpoint per 10 seconds, regardless of viewer count**.

---

## Terraform structure — what lives where

```
terraform/
├── main.tf            # providers, API enablement, GCS state backend with object locking
├── pubsub.tf          # synthetic pipeline bus
├── bigquery.tf        # synthetic pipeline tables
├── crypto.tf          # crypto pipeline: topic, table, function, OHLCV view
├── bqml.tf            # ARIMA_PLUS model + scheduled query + 4 anomaly views
├── api_public.tf      # public-API service account + dataset-level IAM
├── dashboard_views.tf # 4 dashboard-shaped views
├── cloud_function.tf  # synthetic processor function
├── iam.tf             # ALL service accounts, WIF, propagation gates
├── monitoring.tf      # synthetic dashboard + alerts
├── monitoring_crypto.tf   # crypto dashboard + 4 alerts
├── variables.tf
└── outputs.tf
```

**State backend**: GCS bucket with versioning + native object-generation locking (Terraform 1.7+). No DynamoDB workaround.

---

## IAM — least privilege per workload

| Workload | SA | Permissions |
|---|---|---|
| Crypto producer | `sa-coinbase-producer` | `pubsub.publisher` **only on crypto-trades topic** |
| Crypto processor | `sa-transaction-processor` | `bigquery.dataEditor` + `jobUser`, `pubsub.subscriber` |
| Public API | `sa-public-api` | `bigquery.dataViewer` **only on transactions_ds** + `jobUser` |
| BQML training | `sa-bqml-trainer` | `bigquery.dataEditor` + `jobUser` |
| Cloud Build | `sa-function-build` | builder + storage viewer + artifact writer + log writer |
| GitHub Actions CI | `sa-github-cicd` | `editor` + `projectIamAdmin` + `bigquery.admin` + `serviceAccountAdmin` |

**Resource-level vs project-level**: where possible, IAM is bound to one specific resource (one dataset, one topic) instead of the whole project. Smaller blast radius if a credential leaks.

---

## Workload Identity Federation — keyless CI/CD

**File**: `terraform/iam.tf` + `.github/workflows/deploy.yml`

```hcl
resource "google_iam_workload_identity_pool_provider" "github" {
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }

  attribute_condition = "assertion.repository == '${var.github_repo}'"
  #                     ^^^ only THIS exact repo can mint GCP tokens
}
```

```yaml
- name: Authenticate to GCP (Workload Identity)
  uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
    service_account:            ${{ secrets.WIF_SA_EMAIL }}
```

**There is no JSON service-account key for this project.** GitHub's OIDC token is exchanged for a short-lived GCP token, scoped to the exact repo. The #1 source of GCP credential leaks is eliminated.

---

## CI/CD pipeline

```
push / PR → Unit Tests
              │
              ▼
        Terraform Plan      ← fmt-check + validate + plan + upload artifacts
              │
   ┌──────────┴──────────┐
   │  push to main only  │
   │                     │
   ▼                     ▼
[production env]    Terraform Apply ← downloads plan + function build
 (manual approval)    │
                      ▼
                 Deploy crypto-api → Deploy crypto-dashboard
                      │
                 [gated]→ Deploy coinbase-producer (only with explicit flag)
```

**Coinbase producer deploy is gated** behind `DEPLOY_COINBASE_PRODUCER_ON_PUSH=true` repo variable or `workflow_dispatch`. A merge to main cannot silently restart the EUR 50/mo always-on worker.

---

## Monitoring — `terraform/monitoring_crypto.tf`

**6-widget dashboard** + **4 targeted alerts**, each catching a specific failure mode I actually hit:

| Alert | Catches |
|---|---|
| `crypto_eventarc_backlog` (>5k for 5m) | function down, message stuck |
| `crypto_function_errors` (5xx >5%) | code/data bug post-deploy |
| `producer_silent` (0 publishes for 10m) | upstream WS storm, or "I forgot it was paused" |
| `bqml_training_stale` (log-based) | scheduled-query failures (incident #6) |

**Producer-silent intentionally fires when paused** — that's the right behaviour. If you forgot the producer was paused and expected fresh data, the alert tells you.

---

## Incident #1 — Function-zip artifact lost between CI jobs

**Symptom**: Apply failed: `path .build/function.zip not found`.

**Root cause**: Plan and Apply jobs run on **different GitHub runners**. A file written in Plan does not exist in Apply.

**Fix**:
```yaml
- uses: actions/upload-artifact@v4
  with:
    name: function-build
    path: .build/
    include-hidden-files: true   # ← .build/ starts with dot, excluded by default in v4
```

**Lesson**: read CI action release notes. Subtle defaults break silent assumptions.

---

## Incident #2 — Cloud Run rejected 256 MiB memory

**Symptom**:
```
Error: Total memory < 512 Mi is not supported with cpu always allocated.
```

**Root cause**: `--no-cpu-throttling` (CPU always allocated, needed for the WebSocket reader) requires **≥ 512 MiB**.

**Fix**: bumped `--memory 256Mi` → `--memory 512Mi`.

**Lesson**: cloud-provider-specific business rules are often only in error messages, not docs. The error message itself is the documentation.

---

## Incident #3 — Cloud Build SA had zero permissions

**Symptom**:
```
35630345943-compute@developer.gserviceaccount.com does not have storage.objects.get
```

**Root cause**: `gcloud run deploy --source` uses Cloud Build, which defaults to the **compute default SA**. New GCP projects start that SA with zero permissions (post-2024 security hardening).

**Fix**:
```bash
gcloud run deploy ... --build-service-account=projects/$PROJECT/serviceAccounts/sa-function-build@...
```

**Lesson**: default SAs are a legacy footgun. Always create a dedicated SA per workload, even for the build step.

---

## Incident #4 — IAM eventual consistency

**Symptom**: 403 on a freshly-granted role within the same Apply.

**Root cause**: GCP IAM is **eventually consistent** — a new role-binding propagates in ~60s. Terraform fired the dependent operation immediately, before propagation.

**Fix**:
```hcl
resource "time_sleep" "wait_for_cicd_sa_admin_propagation" {
  depends_on      = [google_project_iam_member.cicd_sa_admin]
  create_duration = "90s"
}

resource "google_service_account_iam_member" "x" {
  ...
  depends_on = [time_sleep.wait_for_cicd_sa_admin_propagation]
}
```

**Lesson**: cloud APIs *look* synchronous but aren't. When granting and using a role in the same plan, buffer for propagation.

---

## Incident #5 — Leaking Pub/Sub subscription

**Symptom**: alert fired — backlog **322,000 messages within hours**.

**Root cause**: a Pub/Sub subscription declared "for inspection" had no consumer. The Cloud Function uses its own Eventarc-managed subscription. Every published trade accumulated against the orphan with 7-day retention.

**Fix**:
```hcl
# REMOVED: google_pubsub_subscription "crypto_trades_sub" { ... }
# Eventarc creates and owns its own subscription. For ad-hoc inspection use:
#   gcloud pubsub subscriptions create temp-debug --topic=crypto-trades
#   gcloud pubsub subscriptions pull temp-debug --auto-ack --limit=10
```

Plus `gcloud pubsub subscriptions seek <sub> --time=NOW` to drain the live backlog.

**Lesson**: never declare a subscription without a planned consumer.

---

## Incident #6 — BQML scheduled query in wrong region

**Symptom**: scheduled query failed 0.4s into every run with:
```
Not found: Dataset transactions_ds was not found in location us-central1
```

**Root cause**: dataset is in **`US` multi-region**, scheduled query was created in **`us-central1`** (single region). BigQuery jobs must run in the same location as the dataset.

**Fix**:
```hcl
location = google_bigquery_dataset.transactions.location  # ← keep them in lockstep
```

**Lesson**: BigQuery `US` (multi-region) is **not** the same location as `us-central1`. This bites everyone once.

---

## Cost engineering — concrete numbers

| Service | Configuration | EUR / month |
|---|---|---|
| `coinbase-producer` (vCPU, always-on) | 1 vCPU × 730h | ~52.50 |
| `coinbase-producer` (memory) | 0.5 GiB × 730h | ~2.00 |
| Everything else (scale-to-zero) | API + Functions + dashboard | < 1 |
| BigQuery storage + queries + BQML training | < 100 MB scan/day | < 1 |
| Pub/Sub, logs, monitoring | within free tiers | 0 |
| **Total** | | **~55** |

**94% from one always-on container** — the WebSocket worker can't scale to zero by definition.

> Levers if needed: pause the worker (saves ~50/mo), move to a EUR 5 VM, or accept and budget for it.

---

## What I'd do differently

1. **Monitoring from day 1, not bolted on.** Incident #5 was caught by alert *only* because we got lucky with timing.
2. **Never declare a subscription without a planned consumer** (incident #5 again — architectural mistake in IaC).
3. **Couple BigQuery location to a variable** instead of relying on default `US`. Multi-region migration would touch fewer files.
4. **Schema versioning on Pub/Sub messages** (`schema_version` field). Future schema-evolution is currently silent-breaking.
5. **Producer integration test** — current tests cover `transform_match` but not the WebSocket reconnect loop.
6. **Cost dashboard before resources are spun up**, not after.

> Honest reflection beats defensive answers in interviews.

---

## What this demonstrates — for a reviewer

- **End-to-end serverless data engineering** — WebSocket → message bus → streaming inserts → analytics
- **In-warehouse ML** with `CREATE MODEL ... ARIMA_PLUS` + nightly retraining
- **Two-layer anomaly detection** — fast statistical + slower ML, the same pattern Stripe / Netflix use
- **Production-grade IaC** — Terraform, IAM eventual-consistency handling, GCS state with native locking
- **Keyless CI/CD** — Workload Identity Federation, zero JSON keys in the project
- **Real incident response** — six documented postmortems with code-level fixes
- **Cost-conscious design** — EUR 55/mo dominated by one explicit always-on container, everything else scales to zero

---

## Live demo URLs

- **REST API**: https://crypto-api-jiuqt3hfoq-uc.a.run.app
  - `/stats` — 24h aggregate per symbol
  - `/price/BTC-USD` — latest price + 1h delta
  - `/anomalies/recent` — z-score (Layer 1)
  - `/forecast/BTC-USD` — ARIMA forecast band
  - `/docs` — auto-generated OpenAPI documentation

- **Dashboard**: https://crypto-dashboard-jiuqt3hfoq-uc.a.run.app

- **Repository**: https://github.com/JawadNM44/analytics-engine

---

<!-- _class: lead -->

## Questions?

Documentation in the repository:

- `README.md` — landing page with architecture + tech-stack rationale
- `CHANGELOG.md` — chronological history including all six incident postmortems
- `docs/COSTS.md` — cost engineering writeup
- `docs/DASHBOARD_SETUP.md` — Looker Studio click-stream alternative
- `SECURITY.md` — threat model, per-workload SA scopes, verified absences
- `analytics/bqml_queries.sql` — runnable SQL for every view and ML function
