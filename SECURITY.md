# Security Policy

This document records the threat model, security controls, and reporting process for the analytics-engine project. The project is a portfolio demo with intentionally public surface area — every control below exists because of, not despite, that fact.

---

## Threat model

Three realistic adversaries were considered while designing this:

| Adversary | What they want | What they can do | Mitigations in this project |
|---|---|---|---|
| **GitHub-scanning bot** | A leaked service-account JSON key to spin up crypto-mining or LLM-call workloads on the project's bill | Continuously scan public GitHub for credential strings | **No JSON keys exist for this project.** All CI uses Workload Identity Federation. `*.json` credential files are gitignored. Verified: `git grep` for any credential pattern returns 0 hits across all branches and history. |
| **Public-API abuser** | Run thousands of expensive BigQuery scans on the project's bill via the unauthenticated API | Hammer `https://crypto-api-*.run.app/*` from a botnet | Three layers: `--max-instances 5` caps compute, `MAX_BYTES_BILLED=104857600` caps each query at 100 MB scan, `ALLOWED_SYMBOLS` rejects unknown inputs at the API edge with HTTP 404 before any BQ call. Worst case under abuse: ~EUR 10/day. |
| **Compromised dev laptop** | Use stale local credentials to push malicious infra changes | Steal Application Default Credentials, push to a feature branch | All production changes require a PR and a manual "production" environment approval in GitHub Environments before Apply runs. A pushed branch alone cannot change cloud resources. |

Out of scope: **state-level adversaries**, **insider threats from owners** (you), **supply-chain attacks on Python/Terraform providers** (mitigated only by pinned versions, not this doc).

---

## Security controls

### Authentication

- **GitHub Actions → GCP**: Workload Identity Federation via OIDC token exchange. No long-lived credentials anywhere. The federation pool is pinned with `attribute.repository == 'JawadNM44/analytics-engine'` so only this exact repo can mint GCP tokens.
- **Operator → GCP**: Application Default Credentials (`gcloud auth application-default login`). Per-laptop OAuth tokens, revocable from the Google Account console.
- **No service-account keys are issued, period.**

### Authorization (least privilege per workload)

Every workload has a dedicated service account scoped to the minimum it needs:

| Workload | Service Account | Permissions |
|---|---|---|
| Synthetic producer | `sa-transaction-producer` | `pubsub.publisher` (project-wide on its topic) |
| Synthetic processor (Cloud Function) | `sa-transaction-processor` | `bigquery.dataEditor` + `jobUser`, `secretmanager.secretAccessor`, `run.invoker`, `pubsub.subscriber` |
| Coinbase producer (Cloud Run) | `sa-coinbase-producer` | `pubsub.publisher` **only on the `crypto-trades` topic** (not project-wide) |
| Crypto processor (Cloud Function) | `sa-transaction-processor` (shared) | as above |
| Public crypto API (Cloud Run) | `sa-public-api` | `bigquery.dataViewer` **only on `transactions_ds`** + `bigquery.jobUser` (project-wide, required to run any query) |
| BQML training (scheduled query) | `sa-bqml-trainer` | `bigquery.dataEditor` + `jobUser` |
| Cloud Build (deploys) | `sa-function-build` | `cloudbuild.builds.builder`, `storage.objectViewer`, `artifactregistry.writer`, `logging.logWriter`, `run.developer` |
| GitHub Actions CI | `sa-github-cicd` | `roles/editor` + `projectIamAdmin` + `bigquery.admin` + `iam.serviceAccountAdmin` + `securityReviewer` + `secretmanager.secretAccessor` |

The CI SA is intentionally broad — it has to manage all of the above. It is impersonated only via WIF from GitHub Actions running on the protected `main` branch's `production` environment.

### Secret handling

- **Risk threshold for synthetic-pipeline scoring**: stored in **Secret Manager** (not env vars, not config files). Function reads at runtime via `secretmanager.secretAccessor`.
- **No application secrets** elsewhere in this project. Coinbase WebSocket is public/unauthenticated.
- **`*.tfvars`, `*-credentials.json`, `application_default_credentials.json` are in `.gitignore`.**
- Verified by automated scan: `git grep -E 'sk-ant-|AIza[0-9A-Za-z_-]{35}|"private_key":|-----BEGIN.*PRIVATE KEY'` returns 0 hits across all branches and the full git history.

### Input validation on the public API

The public REST API (`api-public/main.py`) validates every input boundary:

- **Path parameters** (`{symbol}`): rejected against an explicit allow-list (`ALLOWED_SYMBOLS`) at the function entry. Unknown values return 404 *before* any BigQuery call is built. This kills SQL-injection-style attempts at the cheapest possible point.
- **Query parameters**: typed via FastAPI's `Annotated[int, Query(ge=1, le=1440)]` style. Out-of-range or non-numeric values return HTTP 422 before reaching handler code.
- **All BigQuery queries** use parameterised queries (`@symbol`, `@lim`) — never string concatenation. Even if a parameter slipped past validation, it cannot inject SQL.
- **Hard scan cap** (`maximum_bytes_billed=100MB`) means a query that *did* somehow scan unintended data is rejected by BigQuery itself, not just by our code.

### Network surface

| Component | Exposure | Why |
|---|---|---|
| `coinbase-producer` (Cloud Run) | `--no-allow-unauthenticated` | Egress-only worker; nothing should call its `/health` from outside the project |
| `process-crypto-trade` (Cloud Function) | invoked only via Eventarc (Pub/Sub trigger) | Pub/Sub-triggered, no public HTTP |
| `process-transaction` (Cloud Function) | invoked only via Eventarc | Same |
| `crypto-api` (Cloud Run) | `--allow-unauthenticated` | Intentional — portfolio demo. Cost-protected (see threat model) |

### CI/CD safeguards

- **Production gate**: every Apply requires manual approval via GitHub Environments → `production`. A merge to main does not auto-apply.
- **Always-on worker is gated**: the `deploy-coinbase-producer` job will only run if `vars.DEPLOY_COINBASE_PRODUCER_ON_PUSH == 'true'` or via explicit `workflow_dispatch`. A merge cannot silently restart the dominant cost component.
- **State backend**: Terraform state lives in a private GCS bucket with versioning + native object-generation locking (Terraform 1.7+). No DynamoDB workarounds.
- **Plan artifact** is uploaded from Plan job and consumed by Apply job; the same plan that was reviewed is the plan that runs.

### Cost as a security signal

A budget of **EUR 50/month** with notifications at 50%, 90%, 100%, and 150% acts as the catch-all canary for any control failure. If any of the above mitigations break — leaked key, runaway query, accidentally-restarted worker — the bill spikes long before damage compounds. Notifications go to the billing-account-owner email.

---

## Verified absences

These were checked, not assumed:

```bash
# 1. No credential patterns in any tracked file or any git history
git grep -nE 'sk-ant-[a-zA-Z0-9_-]{30,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|"private_key":|-----BEGIN.*PRIVATE KEY' \
  -- ':!*.lock' ':!*.sum'
# → 0 hits

git log --all -p | grep -E 'sk-ant-|"private_key":'
# → 0 hits

# 2. No .tfvars, .env, or *-credentials.json committed
git ls-files | grep -iE '\.tfvars$|\.env$|.*-credentials\.json$|application_default_credentials\.json'
# → only terraform.tfvars.example (no secrets)

# 3. No Co-Authored-By or AI-tool attribution in commit history
git log --all --format='%B' | grep -iE 'co-authored-by|claude|anthropic'
# → 0 hits
```

---

## Reporting a security issue

If you discover a vulnerability in this code, please open a **private security advisory** on GitHub:

https://github.com/JawadNM44/analytics-engine/security/advisories/new

Or email: jawad141005@gmail.com

Please do not file a public issue or pull request for security findings until the issue is resolved or you have explicit acknowledgement that public disclosure is appropriate.

---

## Known accepted risks

Documented for honesty:

1. **Public API is unauthenticated.** Mitigated by the cost-protection layers above. If this becomes a real product, switch to `--no-allow-unauthenticated` and fronted by API Gateway with API keys.
2. **`sa-github-cicd` has `roles/editor` + `bigquery.admin` + several IAM roles.** Justified because Terraform Apply needs to manage almost every resource type. Scoped to GitHub Actions only via WIF, only invokable on the protected `main` branch.
3. **No CSP / security headers on the public API.** It only serves JSON, no HTML, no cookies. Adding HSTS, CSP, etc. would be theatre at this layer (Cloud Run already terminates TLS with managed certs).
4. **No SBOM generation.** Pinned versions in `requirements.txt` and `terraform.lock.hcl` give reproducibility; full SBOM tooling (e.g. `syft`, GitHub dependency-graph) is a follow-up.

---

## Compliance

This is a personal portfolio project with no users, no PII, no regulated data (the only data ingested is **public** Coinbase exchange tape). It is therefore not subject to GDPR, PCI-DSS, SOC 2, or any compliance framework. The controls above exist for engineering hygiene, not regulatory obligation.
