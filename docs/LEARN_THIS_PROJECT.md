# Learn This Project — A Complete Curriculum

This document is a **self-study curriculum** for the analytics-engine project. It is written so you (or a learning platform you build) can teach the entire stack from first principles, using this repository as the worked example.

> Goal: After completing this curriculum you can explain — without notes — every architectural decision, every line of Terraform, every endpoint, and every incident in this project. You can defend it in a 60-minute interview, you can rebuild it from scratch in a different cloud, and you can extend it.

---

## How to use this curriculum

Each of the 12 modules below has the same structure:

1. **Prerequisites** — what you need to know before starting
2. **Learning objectives** — what you'll be able to do after
3. **Key concepts** — the ideas, with plain-language explanations
4. **Read the code** — exact files in this repo to study
5. **Exercises** — hands-on tasks (modify code, predict output, debug)
6. **Self-test** — questions you must answer aloud without notes

Suggested study path: modules in order. Each module assumes the previous ones. Time: ~3-5 hours per module if you do the exercises seriously. Total: ~50-60 hours for full mastery.

If you only have a weekend: do modules 1, 4, 6, 9 — that gives you the spine.

---

## Prerequisite knowledge for the whole curriculum

Before starting, you should already know:

- Python 3 basics (functions, dicts, classes, exceptions)
- Git basics (clone, commit, push, branch)
- Command line (cd, ls, env vars, piping)
- HTTP basics (GET vs POST, status codes, headers)
- SQL basics (SELECT, WHERE, GROUP BY, JOIN)

If you don't have these yet:
- Python: [fast.ai's "Python for Data Science"](https://github.com/fastai/fastpages) or [Real Python](https://realpython.com)
- Git: [Pro Git book](https://git-scm.com/book) chapters 1-3
- SQL: [Mode Analytics SQL Tutorial](https://mode.com/sql-tutorial/) intermediate
- HTTP: [MDN's HTTP overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Overview)

---

# Module 1 — Cloud Functions and Pub/Sub Triggers

The smallest, most stateless piece of the system. Start here.

## Prerequisites

- Python basics
- "What is a webhook" / "What is event-driven"

## Learning objectives

After this module, you can:
- Explain why "function-as-a-service" exists and when it's the right choice
- Write an idempotent Pub/Sub-triggered Cloud Function
- Use BigQuery's `insertId` field to dedupe at-least-once delivery
- Read function logs in Cloud Logging

## Key concepts

**Function-as-a-service (FaaS)** — you give the cloud provider a function (literally one Python function); they run it once per event, then shut down. You pay per invocation, not per running container. Works best when:
- The work is short (sub-second to a few seconds)
- The work is stateless (no in-memory state between invocations)
- Traffic is bursty (some hours zero, some hours thousands/sec)

**Eventarc trigger** — Google's way of wiring "when this event happens (Pub/Sub message, Cloud Storage upload, etc.), run that Cloud Function". Eventarc creates and manages its own Pub/Sub subscription behind the scenes — you don't declare it.

**At-least-once delivery** — Pub/Sub guarantees a message is delivered *at minimum* once, but it might be delivered twice or more (e.g. if your function times out and Pub/Sub retries). Your code must be **idempotent** to handle this correctly.

**Idempotency via `insertId`** — BigQuery's streaming insert API accepts an `insertId` per row. If two rows arrive with the same `insertId` within a 1-minute window, BigQuery dedupes them automatically. We use the trade ID as `insertId`, so a duplicated message simply overwrites the row instead of creating a second copy.

## Read the code

In this order:

1. [`function-crypto/main.py`](../function-crypto/main.py) — 122 lines. The whole crypto-trade processor. Read top-to-bottom.
2. [`function-crypto/requirements.txt`](../function-crypto/requirements.txt) — note the *zero* extra deps. Just `functions-framework` and `google-cloud-bigquery`.
3. [`tests/test_function_crypto.py`](../tests/test_function_crypto.py) — see how validation and BQ insertion are tested with a mock client.
4. [`terraform/crypto.tf`](../terraform/crypto.tf) lines 158-235 — how the function is deployed via Terraform.

## Exercises

1. **Add a new validation rule**: reject trades with `volume_usd > 10_000_000` (likely data error). Run the tests. Predict if any of the existing 25 tests break.
2. **Read a real log**: in the GCP console, find the function `process-crypto-trade`. Open Logs Explorer, find a successful invocation. Identify the trade ID, the latency from event-time to log-time, and which BQ table it wrote to.
3. **Break it on purpose**: in `function-crypto/main.py`, change the `insertId` to a constant string `"foo"`. Deploy locally with the functions-framework, send two test events with different trade IDs. Predict what happens in BigQuery.

## Self-test (answer aloud)

1. Why is `insertId = trade_id` and not `insertId = uuid()`?
2. What happens if our function takes 70 seconds to run?
3. Why don't we declare a Pub/Sub subscription for the crypto-trade processor in `terraform/crypto.tf`?
4. If Coinbase sends 5 trades/second and we have 1 instance, how many in-flight invocations might we have at peak?
5. What's the difference between Eventarc and Cloud Tasks?

---

# Module 2 — Pub/Sub: ordering, dead-letters, and message contracts

The message bus that decouples everything else.

## Prerequisites

- Module 1
- Concept of "queue" and "publish-subscribe"

## Learning objectives

- Explain when to use Pub/Sub vs Kafka vs SQS vs Redis Streams
- Configure ordering keys, dead-letter topics, and message retention
- Recognise an orphan subscription before it kills your bill

## Key concepts

**Topic vs subscription** — A topic is a named publish target. A subscription is a named pull/push consumer. One topic can have many subscriptions; each subscription gets every message independently.

**Ordering keys** — Without them, Pub/Sub may deliver `msg2` before `msg1`. With an ordering key (e.g. `product_id="BTC-USD"`), all messages with the same key are delivered in publish order. The trade-off: parallelism per key drops to 1.

**Dead-letter topic (DLQ)** — A second topic that receives messages that failed too many times in the main subscription. Without a DLQ, a poison message can be retried forever. With one, it's parked for human inspection.

**Message retention** — How long Pub/Sub keeps undelivered messages before discarding. Default 7 days. **This was the root cause of incident #5**: an orphan subscription accumulated 322k messages because nothing pulled from it and the retention was 7 days.

**Orphan subscription** — a subscription with no consumer. Every message ever published just sits there until retention runs out. Always tie subscriptions to a known consumer or delete them.

## Read the code

1. [`terraform/crypto.tf`](../terraform/crypto.tf) lines 1-55 — topics, dead-letter, IAM
2. [`producer-coinbase/main.py`](../producer-coinbase/main.py) lines 130-205 — how the producer publishes with ordering key
3. **Incident #5 postmortem** in [`docs/PROJECT_DEFENSE.md`](PROJECT_DEFENSE.md) section 4

## Exercises

1. **Calculate cost**: if you publish 5 messages/second 24/7 with average payload 200 bytes, what's your monthly Pub/Sub bill in EUR? (Hint: free tier is 10 GB/month inbound + outbound.)
2. **Add a second consumer**: imagine you want to also send each trade to a Slack webhook. Sketch (don't implement) how you'd add a second subscription on the same topic. What new failure modes does this introduce?
3. **Order vs throughput**: explain why ordering keys cap parallelism per key. Why is this OK for our `product_id` use case but would be a problem if the key were `user_id` for a high-traffic site?

## Self-test

1. What happens to a message after `max_delivery_attempts = 5` retries?
2. Why does the dead-letter topic itself need IAM bindings?
3. Why didn't we use Kafka?
4. If the function is throwing an unhandled exception, where do the messages end up after 5 attempts?
5. How would you debug "messages are being published but the function isn't seeing them"?

---

# Module 3 — Long-running workers on Cloud Run

When function-as-a-service doesn't fit, because your work *can't* fit in one short invocation.

## Prerequisites

- Modules 1 and 2
- Async I/O concept (`async`/`await` in Python or any language)

## Learning objectives

- Explain when Cloud Run beats Cloud Functions, and when it beats GKE
- Set up `--min-instances`, `--max-instances`, `--no-cpu-throttling` correctly
- Implement graceful shutdown on `SIGTERM`
- Add a healthcheck that reflects actual readiness

## Key concepts

**Cloud Run vs Cloud Functions** — Cloud Run runs **containers**, Functions run **functions**. Cloud Run can stay alive between requests; Functions cannot. Use Cloud Run when:
- You hold a long-lived connection (WebSocket, SSE, gRPC stream)
- You need sub-100ms warm starts (configure `min-instances=1`)
- Your container has heavy startup cost you don't want to pay per request

**`--no-cpu-throttling`** — By default Cloud Run only allocates CPU during request handling. For a WebSocket worker that has no requests but needs to keep reading from a socket, you must set this flag. Cost: CPU is billed 24/7 instead of per-request.

**`--min-instances`** — Number of containers always running. `0` means scale-to-zero (cold starts allowed). `1` means at least one is always warm. **The dominant cost of this project is `--min-instances=1` × 730 hours/month.**

**SIGTERM and graceful shutdown** — When Cloud Run rolls a revision (after a deploy), it sends `SIGTERM` to the old container, waits up to `--timeout`, then `SIGKILL`. Your code must register a handler that closes connections cleanly, otherwise mid-flight messages get lost.

**Healthcheck design** — `/health` should return 200 only when the service is *actually* ready to do its job, not just "the HTTP server is up". For our WebSocket worker, healthy = "WS is connected AND we've seen a trade in the last 60s".

## Read the code

1. [`producer-coinbase/main.py`](../producer-coinbase/main.py) — entire file. ~280 lines.
2. [`producer-coinbase/Dockerfile`](../producer-coinbase/Dockerfile) — minimal, no surprises.
3. [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) lines 164-210 — deploy step.
4. **Incident #2 postmortem** in [`docs/PROJECT_DEFENSE.md`](PROJECT_DEFENSE.md) — why memory must be ≥512 MiB.

## Exercises

1. **Predict**: change `--no-cpu-throttling` to `--cpu-throttling` (CPU only during requests). What do you expect to happen to the WebSocket connection within 60 seconds?
2. **Add a metric**: in `producer-coinbase/main.py`, add a counter for "reconnect events". Where in the heartbeat log would you surface it?
3. **Read the SIGTERM handler**: trace the path from `signal.SIGTERM` to the WebSocket actually closing. How many `await`s deep is the chain?

## Self-test

1. Why is `--max-instances 1` correct for our producer? What goes wrong with `--max-instances 5`?
2. What's the failure mode of a Cloud Run service with `--min-instances=0` and a dying WebSocket reconnect loop?
3. Cost: 1 vCPU × 730h × always-on. Calculate the monthly EUR cost given Cloud Run pricing of EUR 0.0000216 per vCPU-second after free tier (240,000 sec/month).
4. Why does the healthcheck check `last_trade_ts` and not just "is the WebSocket connected"?
5. What's the first thing you'd do if `gcloud run services describe coinbase-producer` shows `status.conditions[0].type=Ready` but `status=False`?

---

# Module 4 — BigQuery: partitioning, clustering, and views

The warehouse layer. The single most-used GCP service in this project.

## Prerequisites

- SQL basics
- Modules 1-3

## Learning objectives

- Design a partitioned + clustered table for streaming inserts
- Choose the right partition column for your access pattern
- Build saved views and understand when they're free vs not
- Read query plans and understand "bytes processed"

## Key concepts

**Partitioning** — split a table by a date or integer column. Queries that filter on that column scan only the relevant partition. Saves money. Our `crypto_trades` is partitioned by `processed_at` (ingestion day) so a query for "today's trades" scans 1 day, not 30.

**Clustering** — within a partition, physically sort rows by up to 4 columns. Queries filtering on those columns scan a tiny slice of each partition. Our cluster on `(product_id, side)` means a query for `BTC-USD buys` reads orders of magnitude less data than the full partition.

**Views** — saved SELECT statements. A view is *free* to define and *re-runs* the underlying query each time you select from it. Cost = the underlying query's cost. Useful for: pre-shaped data for dashboards, hiding complexity, encoding business logic.

**Materialized views** — like views but precomputed and refreshed. Cost more (storage + refresh) but query-time is cheap. We don't use these — our views are cheap enough.

**`maximum_bytes_billed`** — per-query hard cap on scan size. Query is rejected if it would exceed. Cheapest possible defence against runaway queries (a buggy WHERE clause, a malicious caller).

**Query result cache** — BigQuery caches every query result for 24 hours. Identical query (same SQL, same data) returns the cache for free. Most "is BigQuery expensive?" worries vanish once you realise caching is on by default.

## Read the code

1. [`terraform/crypto.tf`](../terraform/crypto.tf) lines 86-156 — `crypto_trades` table + OHLCV view.
2. [`terraform/bqml.tf`](../terraform/bqml.tf) — every view in this file.
3. [`analytics/bqml_queries.sql`](../analytics/bqml_queries.sql) — runnable example queries.
4. [`api-public/bq.py`](../api-public/bq.py) — see how `maximum_bytes_billed` is set per query.

## Exercises

1. **Partition prediction**: write a query for "all BTC-USD trades on 2026-04-26". Predict bytes scanned. Run `bq query --dry_run` to verify.
2. **Add a clustering column**: how would you re-cluster `crypto_trades` to optimise for "trades by trade_time range"? What's the trade-off?
3. **Build a view**: write a new view `view_crypto_top_5_minutes` that returns the top 5 most-traded minutes per symbol per day. Don't deploy — just write the SQL.

## Self-test

1. What's the difference between partitioning and clustering? When do you use each?
2. Why is `processed_at` partitioned and not `trade_time`?
3. If you query `SELECT * FROM crypto_trades WHERE product_id = 'BTC-USD'` (no time filter), how does the cluster help? Does the partition help?
4. How do you find which queries are most expensive on your project?
5. Why would you ever NOT cache a query result?

---

# Module 5 — BigQuery ML: in-warehouse machine learning

Machine learning without leaving SQL. The differentiator of this project.

## Prerequisites

- Module 4
- "What is regression / forecasting" at the conceptual level (no calculus needed)

## Learning objectives

- Explain the ML pipeline: training data → model → prediction → evaluation
- Train an `ARIMA_PLUS` model in 5 lines of SQL
- Use `ML.DETECT_ANOMALIES` against the model's confidence interval
- Schedule nightly retraining via BQ Data Transfer

## Key concepts

**Training data, features, labels** — Even time-series ML follows the basic shape: rows of historical observations (training data) with a target value to predict (label). For ARIMA_PLUS the feature is the timestamp and the label is the value at that timestamp.

**Why ARIMA**:
- **AR** (Auto-Regressive): "current value depends on previous values"
- **I** (Integrated): "remove trend by taking differences"
- **MA** (Moving Average): "current value depends on previous noise"
- **PLUS**: Google's wrapping of seasonality, holidays, trend decomposition

**Auto-tuning** — `auto_arima=TRUE` makes BigQuery search across many `(p,d,q)` parameter combinations and pick the best by AIC criterion. You don't need to know what those numbers mean — just that the model picks them for you.

**Confidence interval** — instead of "I predict $50k volume next minute", the model says "I predict $50k with 95% confidence interval [$30k, $80k]". An anomaly is a minute where the **actual** value falls outside that interval.

**Scheduled query (BQ Data Transfer)** — a way to schedule a SQL query to run periodically (daily, hourly). We use it to run `CREATE OR REPLACE MODEL ...` every night. The model improves as more data arrives.

**Why this is "real" ML** — ARIMA is in the same family Uber uses for demand forecasting (Prophet is a fork). It's not deep learning, but it IS machine learning: parameters are learned from data via optimisation.

## Read the code

1. [`terraform/bqml.tf`](../terraform/bqml.tf) — entire file. Pay attention to the training query inside the `data_transfer_config`.
2. [`analytics/bqml_queries.sql`](../analytics/bqml_queries.sql) sections 7-10 — bootstrap, inspect, detect, forecast.
3. [`api-public/main.py`](../api-public/main.py) — `/anomalies/ml` and `/forecast/{symbol}` endpoints.

## Exercises

1. **Inspect the model**: in BigQuery, run `SELECT * FROM ML.ARIMA_COEFFICIENTS(MODEL transactions_ds.model_crypto_volume_forecast)`. What do the AR/MA coefficients tell you?
2. **Forecast on demand**: write a query that returns the next 30 minutes of predicted volume for ETH-USD with a 90% confidence interval (default is 95%).
3. **Compare layers**: take 5 anomalies flagged by z-score and check if ML also flagged them. When do they agree, when do they disagree, why?

## Self-test

1. What does `data_frequency='AUTO_FREQUENCY'` mean and why is it useful?
2. Why does the model retrain every night instead of every hour or every week?
3. What's the difference between `ML.FORECAST` and `ML.DETECT_ANOMALIES`?
4. If the model has only 2 hours of training data, what kind of forecast quality should you expect?
5. Why is BigQuery ML cheaper than Vertex AI for this use case? When would Vertex be the right choice instead?

---

# Module 6 — REST API design with FastAPI

Turning data into a product.

## Prerequisites

- Python (decorators, type hints)
- HTTP basics
- Module 4

## Learning objectives

- Design read-only REST endpoints over a database
- Use Pydantic-style query parameter validation
- Add a security allow-list, response caching, and CORS
- Generate OpenAPI docs automatically

## Key concepts

**FastAPI vs Flask** — Both are Python web frameworks. FastAPI is:
- async-native (Flask is not)
- typed (Pydantic validation built in)
- auto-generates OpenAPI/Swagger docs at `/docs`
- the standard for new Python APIs in 2025

**Path vs query parameters** — `/price/{symbol}` is a path parameter (mandatory, identifies the resource). `/candles/{symbol}?minutes=60` adds a query parameter (optional refinement).

**Validation as the first line of defence** — `Annotated[int, Query(ge=1, le=1440)]` rejects out-of-range inputs *before* they reach your code. Saves you from validating manually and saves the database from useless queries.

**Allow-listing > rejecting** — for `/price/{symbol}`, we allow-list `BTC-USD`, `ETH-USD`, `SOL-USD` and reject everything else with 404. Cheaper than letting the query reach BigQuery and fail there.

**Cost-control by request** — `maximum_bytes_billed=100MB` per query. A buggy WHERE clause that would scan 1TB now fails fast with no charge.

**CORS** — controls which other origins can call your API from a browser. We allow `*` because the data is public — this is *not* always the right call.

## Read the code

1. [`api-public/main.py`](../api-public/main.py) — entire file. Read endpoint by endpoint.
2. [`api-public/bq.py`](../api-public/bq.py) — the BQ wrapper with safety caps.
3. [`api-public/Dockerfile`](../api-public/Dockerfile) — note the single `uvicorn` worker.
4. [`tests/test_api_public.py`](../tests/test_api_public.py) — 3 tests. See how FastAPI's test client works.

## Exercises

1. **Add an endpoint**: design (don't implement) `GET /summary/daily?days=7` returning per-day per-symbol stats. What query? What validation?
2. **Break the allow-list**: change `_validate_symbol` to skip the allow-list. Trace what would happen if someone called `/price/'; DROP TABLE crypto_trades; --`. Does the parameterised query save you?
3. **Open the docs**: visit `/docs` on the live API. Use the "Try it out" button. What does it generate behind the scenes?

## Self-test

1. Why is the API public (`--allow-unauthenticated`) but considered safe?
2. What's the worst case under sustained abuse? Show the math.
3. Why is the Dockerfile `--workers 1` and not `--workers 4`?
4. If you wanted to authenticate this API, what's the minimum-effort change?
5. Why does the dashboard call this API instead of querying BigQuery directly?

---

# Module 7 — Streamlit and dashboard composition

The visual layer. Where data becomes story.

## Prerequisites

- Python basics
- Module 6

## Learning objectives

- Build an interactive dashboard with Streamlit
- Use `@st.cache_data` correctly
- Compose Plotly charts (candles + overlays + subplots)
- Render an ML forecast with confidence intervals

## Key concepts

**Streamlit's mental model** — Every interaction reruns the entire script top-to-bottom. State is lost unless you put it in `st.session_state` or a cache. Sounds wasteful but is brilliant for fast iteration.

**`@st.cache_data(ttl=10)`** — wraps a function so its return value is cached for 10 seconds. Critical for not hammering your API on every rerun. Cache key = function name + arguments.

**Plotly subplots** — `make_subplots(rows=2, cols=1, shared_xaxes=True)` puts two charts on top of each other with synchronised x-axes. We use it for "price chart + volume bars".

**Overlay vs subplot** — same chart with multiple traces (price line + anomaly dots) is an overlay. Two related charts stacked is subplots. Anomaly markers belong overlaid on the price chart, volume belongs in a subplot.

**Confidence interval rendering in Plotly** — two `Scatter` traces with `fill='tonexty'` between them. The order matters: upper trace first (transparent line), then lower trace with fill.

## Read the code

1. [`dashboard-streamlit/main.py`](../dashboard-streamlit/main.py) — entire file.
2. [`dashboard-streamlit/Dockerfile`](../dashboard-streamlit/Dockerfile) — note the `STREAMLIT_*` env vars.

## Exercises

1. **Add a metric**: surface "anomalies in the last hour" as a fourth scorecard. Which API endpoint? What aggregation?
2. **Improve the candle chart**: colour the volume bars green/red based on whether close > open or close < open.
3. **Cache experiment**: change `CACHE_TTL_SECONDS` to 1. Watch the network tab in your browser. How often does the dashboard hit the API? What goes wrong?

## Self-test

1. Why does the dashboard not need GCP credentials?
2. Where would you add a "click on anomaly to see the trades that caused it" feature?
3. What happens if 100 viewers open the dashboard simultaneously? How many BigQuery queries do you fire?
4. Why are the tables inside `st.expander`?
5. Why is the dashboard `--max-instances 5` and not `--max-instances 100`?

---

# Module 8 — Infrastructure as Code with Terraform

The single source of truth for "what exists in cloud".

## Prerequisites

- Cloud concepts (regions, projects, IAM)
- "Declarative vs imperative" — you describe what you want, not how to get there

## Learning objectives

- Read and write Terraform resource definitions
- Use providers, variables, outputs, and `depends_on`
- Manage remote state with object locking
- Diagnose IAM eventual-consistency issues with `time_sleep`

## Key concepts

**Declarative model** — you describe the end state ("I want a Pub/Sub topic named X"). Terraform figures out the diff between current state and desired state and applies the changes.

**Providers** — plugins that know how to talk to a specific cloud (`google`, `google-beta`, `aws`, `azurerm`). Pinned by version in `required_providers`.

**State** — Terraform tracks what it has created in a state file. Without state it can't compute the diff. State must be **shared** (so multiple devs/CI can collaborate) and **locked** (so two `apply`s don't run simultaneously).

**GCS state backend with object generation locking** — Terraform 1.7+ uses GCS object-generation numbers as the lock. No DynamoDB workaround needed.

**Eventual consistency** — IAM changes propagate across GCP in ~60 seconds. Terraform fires dependent operations immediately. We use `time_sleep` to bridge this gap. **This was incidents #4 and #6.**

**`depends_on`** — explicit dependency edge. Use only when the implicit dependency (one resource references another's attribute) is missing.

## Read the code

1. [`terraform/main.tf`](../terraform/main.tf) — providers, API enablement.
2. [`terraform/iam.tf`](../terraform/iam.tf) — every service account in this project.
3. [`terraform/api_public.tf`](../terraform/api_public.tf) — minimal example, ~30 lines.
4. [`terraform/crypto.tf`](../terraform/crypto.tf) — compound example with multiple resources.
5. **Incident #4 postmortem** in [`docs/PROJECT_DEFENSE.md`](PROJECT_DEFENSE.md).

## Exercises

1. **Read a plan**: clone the repo, run `terraform plan -var=project_id=test`. Without applying, identify what would be created.
2. **Add a resource**: declare a second BigQuery dataset for "crypto_archive". Predict what `terraform plan` shows.
3. **Trace a dependency**: start at `terraform/api_public.tf`'s `public_api_data_viewer` and trace the dependency graph backwards. Why does it depend on `time_sleep`?

## Self-test

1. What's the difference between `var`, `local`, and `output`?
2. Why is the GCS state bucket named `project-1f299b47-tf-state` and not just `tf-state`?
3. If two CI runs apply simultaneously, what stops them from corrupting the state?
4. Why is `disable_on_destroy = false` set on the API enablement?
5. What does `for_each = toset([...])` do that a regular `count = N` can't?

---

# Module 9 — IAM least privilege per workload

The skill that separates "I can deploy" from "I can deploy securely".

## Prerequisites

- Modules 1, 3, 6
- Concept of "user" vs "role" vs "permission"

## Learning objectives

- Design a per-workload service account inventory
- Choose roles that match the principle of least privilege
- Use Workload Identity Federation for keyless CI auth
- Recognise IAM eventual consistency in a deploy log

## Key concepts

**Service Account (SA)** — an identity for a workload (not a person). Has an email, can be granted IAM roles.

**Least privilege** — the smallest set of permissions a workload needs to function. Not "give it Owner because it's easier" — that's how leaks become catastrophes.

**Project-level IAM vs resource-level IAM**:
- Project-level: `roles/X` granted on the whole project. Wide blast radius.
- Resource-level: `roles/X` granted on one specific resource (one bucket, one dataset). Tight blast radius.
- Use resource-level whenever the resource exists.

**Workload Identity Federation (WIF)** — exchanges an external OIDC token (from GitHub Actions) for a short-lived GCP token. **No JSON keys exist.** The #1 source of GCP credential leaks (committed JSON keys) is eliminated.

**Service-agent SA** — a Google-managed SA that some Google services use under the hood (e.g. BigQuery Data Transfer's agent). Lazy-created on first API use. Sometimes you need to force its creation with `google_project_service_identity` (this was incident #7-adjacent).

## Read the code

1. [`terraform/iam.tf`](../terraform/iam.tf) — every SA, top to bottom.
2. [`SECURITY.md`](../SECURITY.md) — the SA inventory table.
3. [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) lines 56-68 — how WIF is consumed.

## Exercises

1. **Inventory map**: list every workload in this project and the *minimum* permissions it actually uses (look at the code, not the IAM bindings — be honest about what's used).
2. **Tighten one binding**: pick `function_secret_accessor`. Could it be tighter? How?
3. **WIF debugging**: imagine WIF auth fails in CI with a 403. Where would you look first?

## Self-test

1. Why does the public API have `bigquery.dataViewer` on *only* the `transactions_ds` dataset and not project-wide?
2. What's the difference between `roles/editor` and `roles/owner`?
3. Why does `sa-github-cicd` need `roles/iam.serviceAccountAdmin` (a broad role) — couldn't we use something narrower?
4. What's the WIF `attribute_condition` for and why is it critical?
5. If a JSON key ever did leak from this project, would it be exploitable? Why or why not?

---

# Module 10 — CI/CD with GitHub Actions

Automating the deploy from commit to running container.

## Prerequisites

- Module 8 and 9
- YAML basics

## Learning objectives

- Read a multi-job GitHub Actions workflow
- Pass artefacts between jobs on different runners
- Gate dangerous deploys behind manual approval
- Use repository variables for dynamic feature flags

## Key concepts

**Jobs vs steps** — A workflow has multiple jobs. Each job runs on its own fresh runner (clean VM). Within a job, steps share the runner's filesystem. Across jobs, you must explicitly pass files (artefacts).

**Artefacts** — `actions/upload-artifact` and `actions/download-artifact`. The way Plan jobs pass `tfplan` to Apply jobs. **This was incident #1**: hidden directories were silently excluded.

**GitHub Environments** — a way to gate jobs behind approval. Our `production` environment requires manual approval before Apply runs. A merged PR doesn't auto-deploy.

**Repository variables vs secrets** — variables are visible (configuration), secrets are not (passwords/tokens). Both injected into workflows via `${{ vars.X }}` and `${{ secrets.X }}`.

**`workflow_dispatch`** — manual trigger via the UI or `gh workflow run`. Useful for "run this only when a human says so" (we use it for the always-on producer deploy).

## Read the code

1. [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — entire file, job by job.
2. **Incident #1 postmortem** in [`docs/PROJECT_DEFENSE.md`](PROJECT_DEFENSE.md).

## Exercises

1. **Trace the Plan → Apply handoff**: which exact files are passed via artefacts? Where are they consumed in Apply?
2. **Add a step**: insert a `terraform fmt -check` step before Plan. If formatting drifts, what happens to the PR?
3. **Predict a failure**: if `WIF_PROVIDER` secret is mistyped, where in the workflow does it fail?

## Self-test

1. Why does Apply need `environment: name: production`?
2. Why is `deploy-coinbase-producer` gated and `deploy-public-api` not?
3. What does `permissions: id-token: write` enable?
4. If you push a commit that breaks unit tests, does Apply still run?
5. How would you add a "dry-run plan only" mode triggered by a label on the PR?

---

# Module 11 — Cloud Monitoring, alerting, and incident response

Knowing it's broken before users tell you.

## Prerequisites

- All previous modules

## Learning objectives

- Build a Cloud Monitoring dashboard via Terraform
- Write alert policies that catch real failure modes
- Run an incident through detect → triage → mitigate → fix → postmortem

## Key concepts

**Metrics vs logs** — metrics are numeric time-series (CPU%, request rate). Logs are text events. Metrics power alerts; logs power debugging.

**Alert policy structure** — a *condition* (metric > threshold for X minutes), a *notification channel* (email, Slack), and an *auto-close* timeout. Without auto-close, alerts become noise.

**Threshold tuning** — too sensitive = alert fatigue. Too loose = missed incidents. Tune to the actual normal range. Our backlog alert is at 5k because under normal load we're at <50.

**The incident lifecycle** — Detect (alert fires) → Triage (which subscription? which function?) → Mitigate (drain, rollback, scale) → Fix (code/config change) → Postmortem (write down what happened so it doesn't recur).

**Postmortem culture** — blameless writeup of root cause + fix + lesson. **All six incidents in this project follow this format** in `PROJECT_DEFENSE.md` section 4.

## Read the code

1. [`terraform/monitoring.tf`](../terraform/monitoring.tf) — synthetic-pipeline dashboard + alerts.
2. [`terraform/monitoring_crypto.tf`](../terraform/monitoring_crypto.tf) — crypto-pipeline dashboard + 4 alerts.
3. [`docs/PROJECT_DEFENSE.md`](PROJECT_DEFENSE.md) section 4 — all 6 postmortems.

## Exercises

1. **Walk through incident #5**: read the postmortem. Without looking ahead, what would have been *your* triage step? How long until you'd find the root cause?
2. **Add an alert**: write a condition for "more than 100 anomalies flagged in 1 hour" — could indicate a broken ML model. What metric type is it? Log-based or metric-based?
3. **Tune a threshold**: the producer-silent alert fires at 0 publishes for 10 min. When would 10 min be wrong (too short / too long)?

## Self-test

1. What's the difference between an alert "open" and "closed"?
2. Why does `notification_rate_limit` exist on log-based alerts?
3. Walk through what you'd do, step-by-step, if the "high error rate" alert fired right now.
4. Which incident in this project would the producer-silent alert have caught?
5. How do you test that a new alert policy actually works without waiting for a real incident?

---

# Module 12 — Cost engineering and budget protection

The senior-engineer skill.

## Prerequisites

- All previous modules

## Learning objectives

- Read a GCP billing report and identify the dominant line item
- Calculate the cost of an architectural choice before building
- Set up budget alerts with sensible thresholds
- Distinguish "free trial" from "always-free tier"

## Key concepts

**Free trial vs Always Free** — Two distinct programs. Trial = $300 credits for 90 days, all usage drains credits. Always Free = small permanent quotas per service. During trial, Always Free quotas are *not* applied; they kick in only after.

**The dominant line item** — In any cloud bill, one resource is usually >50% of cost. Find it. Decide: keep it, replace it, accept it. Ours is `coinbase-producer` Cloud Run vCPU at 94%.

**Scale-to-zero pattern** — Anything that *can* scale to zero, should. Cost = 0 when idle. Our API, Cloud Functions, and dashboard all scale to zero. Only the WebSocket worker can't (by design).

**Budget alerts** — Notify (don't stop) when spend hits thresholds. Configure 50%, 90%, 100%, 150% of a sensible cap. We have EUR 50/month with these thresholds.

**Cost protection on public services** — `--max-instances`, `maximum_bytes_billed`, allow-lists. Bound the worst case before it happens.

## Read the code

1. [`docs/COSTS.md`](COSTS.md) — entire file.
2. [`terraform/api_public.tf`](../terraform/api_public.tf) — see how the API SA is scoped.
3. [`api-public/main.py`](../api-public/main.py) — see `MAX_BYTES_BILLED`.

## Exercises

1. **Calculate worst case**: if someone DDoS'd `/anomalies/recent` with 100 req/sec for 24h, what would the bill look like? Prove with numbers.
2. **Pause math**: you go on holiday for 30 days and forget to pause the producer. Calculate how much trial credit you'd have left if you started with EUR 200.
3. **Cheap alternative**: design (don't implement) a way to run the producer for EUR 5/month instead of EUR 50.

## Self-test

1. Which one resource costs you the most? Why?
2. If you had to halve the bill tomorrow, what's your first action?
3. What's a budget alert? What does it NOT do?
4. Why is BigQuery storage essentially free for this project?
5. What protection prevents the public API from costing you serious money under abuse?

---

# Cross-cutting concepts (read after the 12 modules)

Concepts that show up across multiple modules and deserve their own consolidation:

## Idempotency

Doing the same operation multiple times produces the same result. Critical when:
- Pub/Sub redelivers a message
- A user double-clicks "submit"
- A retried CI deploy

Implementations:
- BigQuery `insertId` (Module 1)
- HTTP `PUT` (vs `POST`)
- Dedupe within a window using a unique key

## Eventual consistency

Most cloud APIs are eventually consistent. A change you just made may not be visible everywhere immediately. Patterns:
- Wait + retry (`time_sleep` in Terraform)
- Read-after-write workarounds
- Accept stale reads as a normal state

## Backpressure

When producers outpace consumers, messages queue up. Pub/Sub buffers (good), but unbounded buffers eventually break. Solutions:
- DLQ for poison messages
- Alerts on backlog growth
- Consumer scaling (more functions, more cores)

## Observability triangle

Logs (what happened in detail), metrics (numeric trends), traces (request paths through services). This project does logs and metrics; tracing would be the next step (Cloud Trace).

## Defence in depth

Multiple independent layers of protection. The public API has three (max-instances, byte cap, allow-list). If any one fails, the others still bound damage.

---

# How to defend this project in an interview

After completing the curriculum, work through [`docs/PROJECT_DEFENSE.md`](PROJECT_DEFENSE.md):

1. Read the document end-to-end once.
2. Pick 5 of the 20 follow-up questions at random. Answer each aloud, recording yourself.
3. Listen back. Where did you say "uhh" or hesitate? Re-read the relevant module.
4. Repeat with another 5 questions until you can answer all 20 confidently.

Specifically practise:
- The 5-stage narrative (business problem → solution → decisions → problems → outcome) without notes
- One incident postmortem in 2 minutes
- The cost story in 30 seconds

---

# What you will be able to do after the full curriculum

You will be able to:

- Rebuild this entire system in a different cloud (AWS/Azure) given a week
- Defend every architectural choice against a senior engineer
- Walk through any of the six incidents like a postmortem
- Design a similar system for a new domain (ad-tech events, IoT telemetry, payment fraud) within a day
- Estimate the cost of a proposed architecture before any code is written
- Identify the dominant cost in any cloud bill and propose alternatives
- Design IAM with least privilege from a blank slate
- Set up CI/CD with no static credentials
- Build a publicly-shareable demo that's safe against abuse
- Explain ML forecasting at the right level for any audience (business, eng, ML specialist)

---

# After this curriculum — what's next

The natural follow-on projects, in order of new-skill-addition:

1. **Same architecture on AWS** — replace Pub/Sub with SNS+SQS or Kinesis, BigQuery with Athena/Redshift, Cloud Run with Fargate. Same patterns, different vocabulary.
2. **Add a real-time dashboard with Server-Sent Events** — push trades to the browser as they arrive, no polling. Adds: SSE protocol, browser long-lived connections, connection state management.
3. **Replace ARIMA with a custom PyTorch/JAX model** — gradient-boosted or transformer for multivariate forecasting. Adds: deep learning, Vertex AI training, model serving.
4. **Add a write path** — let users tag anomalies as "real" or "false-positive", store the labels, retrain a classifier. Adds: write APIs, auth, supervised learning.
5. **Multi-region deploy** — duplicate the stack in `europe-west4`, add traffic routing. Adds: global load balancing, multi-region BQ, latency optimisation.

Pick the one that aligns with the next role you want.
