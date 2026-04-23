# Project Context — Serverless Real-Time Analytics Engine

> Dit bestand beschrijft de volledige staat van het project.
> Plak dit bovenaan een nieuwe Claude chat om direct verder te gaan.

---

## Wie ben ik
Jawad — eerstejaars student, Nederlands. Aan het ontwikkelen van een engineering mindset. Ambitieus, bouwt actief grote projecten. GitHub: JawadNM44

---

## Wat dit project is

Een volledig werkende, live serverless data pipeline op GCP die financiële transacties verwerkt in real-time. Gebouwd als portfolio project om Big Tech-niveau vaardigheden te bewijzen.

**Repo:** https://github.com/JawadNM44/analytics-engine  
**Status:** Live en werkend in productie

---

## Architectuur

```
Producer (Python, lokaal)
    │  100k+ JSON transacties via batch publish
    ▼
GCP Pub/Sub Topic: "transactions"
    │  Eventarc trigger (push)
    ▼
Cloud Function 2nd Gen: "process-transaction"  (us-central1)
    │  • Schema validatie
    │  • Risk scoring: bedrag > $500, hoog-risico landen (NG/RU/CN/IR/KP), internationaal
    │  • Risk threshold opgehaald uit Secret Manager
    ▼
BigQuery Dataset: transactions_ds
    ├── all_transactions          (gepartitioneerd per dag op processed_at)
    └── high_risk_transactions    (gepartitioneerd per dag op processed_at)

Cloud Monitoring Dashboard (live):
https://console.cloud.google.com/monitoring/dashboards/custom/d8f2e3a1-8c05-4241-a346-9b00b9f01980?project=project-1f299b47-8676-4148-acb
```

---

## GCP Project

| Item | Waarde |
|------|--------|
| Project ID | `project-1f299b47-8676-4148-acb` |
| Project Number | `35630345943` |
| Region | `us-central1` |
| Cloud Function URL | `https://process-transaction-jiuqt3hfoq-uc.a.run.app` |

---

## Wat er al gebouwd is

### Infrastructure (alles via Terraform)
- [x] Pub/Sub topic `transactions` + dead-letter topic
- [x] Pub/Sub subscription met retry policy
- [x] Cloud Function 2nd Gen (Python 3.12, Pub/Sub triggered)
- [x] Secret Manager secret `risk-threshold` = 500
- [x] GCS bucket voor function artifacts
- [x] BigQuery dataset `transactions_ds`
- [x] BigQuery table `all_transactions` (partitioned + clustered)
- [x] BigQuery table `high_risk_transactions` (partitioned + clustered)
- [x] BigQuery view `view_hourly_volume`
- [x] 5 Service accounts (least privilege)
- [x] Workload Identity Federation pool voor GitHub Actions
- [x] Custom build SA (standaard Cloud Build SA uitgeschakeld door GCP org policy)
- [x] Cloud Monitoring dashboard (6 panels)
- [x] 2 Alert policies (error rate + Pub/Sub backlog)

### CI/CD
- [x] GitHub Actions: test → plan → apply pipeline
- [x] Keyless GCP auth via Workload Identity Federation (geen JSON keys)
- [x] GitHub Environment "production" voor manual approval gate

### Code
- [x] Python producer (`producer/main.py`) — 100k msgs in ~15s
- [x] Cloud Function (`function/main.py`) — validatie + risk scoring + BQ streaming
- [x] 15 unit tests (`tests/test_function.py`) — draaien zonder GCP credentials

---

## Wat er NIET is / volgende stappen

Zie **FEATURES.md** voor volledige uitleg per feature.

| # | Feature | Moeilijkheid | Impact |
|---|---------|-------------|--------|
| 1 | GitHub Secrets instellen (CI/CD voltooien) | ⭐ | ⭐⭐⭐⭐⭐ |
| 2 | Looker Studio dashboard (business laag) | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 3 | Velocity detection (fraude upgrade) | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 4 | Producer als Cloud Run Job | ⭐⭐⭐ | ⭐⭐⭐ |
| 5 | Fan-out: meerdere Pub/Sub consumers | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 6 | Load testing rapport | ⭐⭐ | ⭐⭐⭐ |

---

## Bewezen resultaten

```
Run 1 (12 apr 2026):  100,000 transacties gepubliceerd in 14s, 0 errors
Run 2 (12 apr 2026):  100,000 transacties gepubliceerd in 18s, 0 errors
Totaal in BigQuery:   200,000 verwerkt
High-risk geflagd:    92,967 (46.5%)
Totaal volume:        $55,201,701
Gemiddeld bedrag:     $276
```

---

## Stack

| Laag | Technologie |
|------|-------------|
| Taal | Python 3.12 |
| Messaging | GCP Pub/Sub |
| Compute | Cloud Functions 2nd Gen (serverless) |
| Storage | BigQuery (partitioned tables) |
| Secrets | Secret Manager |
| IaC | Terraform 1.5 |
| CI/CD | GitHub Actions + Workload Identity Federation |
| Observability | Cloud Monitoring |

---

## Lokaal draaien

```bash
# Vereisten
source /opt/homebrew/share/google-cloud-sdk/path.zsh.inc
gcloud auth application-default login

# Producer
cd producer
source .venv/bin/activate  # Python 3.12 venv
GCP_PROJECT_ID=project-1f299b47-8676-4148-acb python main.py

# Terraform
cd terraform
terraform apply  # terraform.tfvars staat lokaal (niet in git)

# Tests
pytest tests/ -v
```

---

## Huidige status CI/CD (Feature 1 — in progress)

**Wat werkt:**
- ✅ GitHub Secrets ingesteld (GCP_PROJECT_ID, WIF_PROVIDER, WIF_SA_EMAIL)
- ✅ GitHub Environment `production` aangemaakt met approval gate
- ✅ Unit Tests stap → 15/15 groen
- ✅ GCS remote state bucket aangemaakt (`project-1f299b47-tf-state`)
- ✅ State gemigreerd van lokaal naar GCS
- ✅ Cloud Resource Manager API ingeschakeld

**Nog te fixen:**
- ❌ Terraform Plan in CI geeft nog errors — run #13 loopt nog / moet gecheckt worden
- Laatste fout was: `cloudresourcemanager.googleapis.com` niet ingeschakeld → opgelost in commit `b51c244`
- Volgende run (#13) zou `Plan: 0 to add, 0 to change, 0 to destroy` moeten tonen

**Morgen als eerste doen:**
1. Check run #13 op https://github.com/JawadNM44/analytics-engine/actions
2. Als er nog een error is → foutmelding lezen en fixen
3. Als groen → Feature 1 klaar, door naar Feature 2 (Looker Studio)

## Commit geschiedenis

```
b51c244  fix(terraform): enable Cloud Resource Manager API for CI
0aa873e  feat(terraform): configure GCS remote state backend
16fc34c  fix(tests): resolve import errors in CI environment
eb71ccb  fix: remove terraform.tfvars from tracking
92385d6  style(terraform): auto-format all .tf files for CI fmt check
7358c85  docs(readme): add live results summary to project description
ac7d50e  docs: add detailed feature roadmap with engineering context
e0a90d5  docs: add PROJECT.md as living project context document
562121c  fix(outputs): correct monitoring dashboard URL format
007d87e  fix(monitoring): switch to cloudfunctions.googleapis.com metrics
da306bc  fix: resolve Cloud Function build failures on new GCP projects
e94e606  Initial commit: Serverless Real-Time Analytics Engine
```
