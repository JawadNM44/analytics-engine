# Phase 1: Evidence Model Implementation Plan

Phase 1 creates the storage and read surface for verified intelligence before
any LLM job is added. The dashboard should be able to render stored insight
objects from BigQuery, even if those objects are seeded test data at first.

## Why This Comes Before Agents

Agents are easy to demo and easy to make messy. The data contract is the hard
part. If `agent_runs`, `claims`, `evidence`, and `verdicts` are stable first,
then the Anomaly Investigator can be swapped, improved, or replaced without
breaking the dashboard.

## Ownership Split

Recommended lane assignments (project owner is always Jawad NM):

| PR | Lane | Files | Size | Risk |
|---|---|---|---|---|
| 1. BigQuery schema | B | `terraform/verified_intelligence.tf`, `terraform/outputs.tf` if needed | M | Infra, no runtime path |
| 2. FastAPI read endpoint | A or B | `api-public/main.py`, `api-public/bq.py`, `tests/test_api_public.py` | M | Read-only backend |
| 3. Dashboard empty/read UI | A | `dashboard-next/src/app/api/insights/route.ts`, `dashboard-next/src/components/*`, schemas | M | Public UI, graceful fallback |
| 4. Seed/dev data helper | A | script or SQL under `analytics/` | S-M | Dev-only, no scheduled job |

Do not combine these into one XL PR. The whole point is to keep the blast
radius small.

## BigQuery Tables

Create a new Terraform file:

`terraform/verified_intelligence.tf`

All tables should live in the existing `transactions_ds` dataset for now. This
keeps IAM simple because `sa-public-api` already has dataset-level read access.
Revisit a separate dataset only if agent data grows or needs different access
controls.

### Table: `agent_runs`

Partition:
- `DATE(started_at)`

Cluster:
- `agent_name`
- `status`

Fields:
- `run_id STRING REQUIRED`
- `agent_name STRING REQUIRED`
- `trigger_type STRING REQUIRED`
- `trigger_ref STRING`
- `status STRING REQUIRED`
- `started_at TIMESTAMP REQUIRED`
- `finished_at TIMESTAMP`
- `model_provider STRING`
- `model_name STRING`
- `input_json JSON`
- `output_json JSON`
- `error STRING`
- `cost_estimate_usd FLOAT64`

### Table: `claims`

Partition:
- `DATE(created_at)`

Cluster:
- `run_id`
- `subject_symbol`

Fields:
- `claim_id STRING REQUIRED`
- `run_id STRING REQUIRED`
- `claim_text STRING REQUIRED`
- `claim_type STRING`
- `subject_symbol STRING`
- `event_time TIMESTAMP`
- `created_at TIMESTAMP REQUIRED`

### Table: `evidence`

Partition:
- `DATE(created_at)`

Cluster:
- `run_id`
- `source_type`

Fields:
- `evidence_id STRING REQUIRED`
- `run_id STRING REQUIRED`
- `source_type STRING REQUIRED`
- `source_uri STRING`
- `source_time TIMESTAMP`
- `title STRING`
- `snippet STRING`
- `payload_json JSON`
- `created_at TIMESTAMP REQUIRED`

### Table: `verdicts`

Partition:
- `DATE(created_at)`

Cluster:
- `run_id`
- `verdict`

Fields:
- `verdict_id STRING REQUIRED`
- `claim_id STRING REQUIRED`
- `run_id STRING REQUIRED`
- `verdict STRING REQUIRED`
- `confidence FLOAT64 REQUIRED`
- `rationale STRING`
- `evidence_ids ARRAY<STRING>`
- `created_at TIMESTAMP REQUIRED`

Allowed verdict values are enforced in code first, not as a BigQuery
constraint:

- `supported`
- `contradicted`
- `insufficient_evidence`
- `not_checked`

## Read View

Add a BigQuery view for dashboard reads:

`view_recent_agent_insights`

Suggested shape:

- `run_id`
- `agent_name`
- `trigger_type`
- `trigger_ref`
- `status`
- `started_at`
- `finished_at`
- `summary`
- `subject_symbols ARRAY<STRING>`
- `claim_count`
- `supported_count`
- `contradicted_count`
- `insufficient_count`
- `avg_confidence`

The view should read from the normalized tables but return one row per run.
This keeps the dashboard cheap and avoids client-side joins.

## API Endpoint

Add:

`GET /agent-insights/recent?limit=10`

Response:

```json
{
  "insights": [
    {
      "run_id": "run_abc",
      "agent_name": "anomaly_investigator",
      "trigger_type": "zscore_anomaly",
      "trigger_ref": "BTC-USD:2026-05-08T15:24:00Z",
      "status": "succeeded",
      "started_at": "2026-05-08T15:26:00Z",
      "summary": "BTC-USD volume spiked far above its recent baseline.",
      "subject_symbols": ["BTC-USD"],
      "claim_count": 2,
      "supported_count": 1,
      "contradicted_count": 0,
      "insufficient_count": 1,
      "avg_confidence": 0.695
    }
  ]
}
```

Validation:
- `limit`: integer, `1..50`
- No symbol filter in the first endpoint; add later if needed.

Cost:
- Query only the view.
- Order by `started_at DESC`.
- Limit aggressively.
- Use the existing `BigQueryClient` bytes-billed cap.

## Dashboard Endpoint

Add:

`GET /api/insights?limit=10`

This proxies the private FastAPI endpoint using the existing `backend()` helper.
It must:
- use Zod response validation
- rate-limit using existing `allow(clientIp(req))`
- return a graceful `502` JSON error if backend fails

## Dashboard UI

Add a component:

`dashboard-next/src/components/evidence-briefing.tsx`

First version:
- Works with empty data.
- Shows recent insight cards if data exists.
- Does not block existing anomaly or whale tables.
- Does not call an LLM.

Placement:
- `/anomalies`, above the current two-column anomalies/whales grid.

Empty state:

`No verified briefs yet.`

This is important: the public dashboard should look intentional before agents
exist.

## Test Plan

PR 1:
- `terraform fmt -recursive`
- `terraform validate`
- No apply until Jawad approves.

PR 2:
- Unit tests for API route validation.
- Unit test for empty BigQuery result.
- Unit test for one populated insight row.

PR 3:
- `npm run lint`
- `npm run build`
- Manual check that `/anomalies` still renders when `/api/insights` returns an
  empty list or a 502.

## Rollback

Phase 1 is additive. Rollback is safe:
- Removing dashboard component returns `/anomalies` to its current state.
- API endpoint is read-only.
- BigQuery tables can remain unused if a later phase is paused.

