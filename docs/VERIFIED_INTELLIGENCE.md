# Verified Intelligence Design

This document defines the core Verified Market Intelligence invention: agentic
market intelligence that is auditable by default.

## Core Loop

```text
Anomaly detected
  -> context builder gathers market facts
  -> investigator proposes explanation
  -> claim extractor splits prose into atomic claims
  -> evidence retriever attaches data and sources
  -> verifier assigns verdicts and confidence
  -> dashboard renders insight + evidence + uncertainty
  -> memory layer stores the outcome for future runs
```

## First Use Case

Start with the live `/anomalies` page. It already shows unusual minutes and
whale trades. The first intelligence layer should explain those events without
changing ingestion.

Input example:

```json
{
  "kind": "zscore_anomaly",
  "minute": "2026-05-08T15:24:00Z",
  "symbol": "BTC-USD",
  "volume_usd": 1606925.66,
  "mean_60m": 256895.76,
  "stddev_60m": 182438.74,
  "z_score": 7.40
}
```

Output shape:

```json
{
  "summary": "BTC-USD volume spiked far above its recent baseline.",
  "claims": [
    {
      "claim": "BTC-USD volume was more than six times its 60-minute average.",
      "verdict": "supported",
      "confidence": 0.98,
      "evidence_ids": ["ev_001"]
    },
    {
      "claim": "The spike was likely caused by ETF-related news.",
      "verdict": "insufficient_evidence",
      "confidence": 0.41,
      "evidence_ids": []
    }
  ]
}
```

## Proposed BigQuery Tables

### `agent_runs`

One row per agent execution.

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

### `claims`

One row per atomic claim.

Fields:
- `claim_id STRING REQUIRED`
- `run_id STRING REQUIRED`
- `claim_text STRING REQUIRED`
- `claim_type STRING`
- `subject_symbol STRING`
- `event_time TIMESTAMP`
- `created_at TIMESTAMP REQUIRED`

### `evidence`

One row per evidence item.

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

### `verdicts`

One row per claim verdict.

Fields:
- `verdict_id STRING REQUIRED`
- `claim_id STRING REQUIRED`
- `run_id STRING REQUIRED`
- `verdict STRING REQUIRED`
- `confidence FLOAT64 REQUIRED`
- `rationale STRING`
- `evidence_ids ARRAY<STRING>`
- `created_at TIMESTAMP REQUIRED`

Allowed verdict values:
- `supported`
- `contradicted`
- `insufficient_evidence`
- `not_checked`

## Agent Runtime Principles

- Agents run as jobs, not hot-path request handlers.
- The dashboard reads stored outputs; it does not call an LLM directly.
- Every LLM response must be strict JSON validated by code before storage.
- Failed runs are first-class records in `agent_runs`.
- Claims must be small enough to verify independently.
- The verifier must be allowed to disagree with the investigator.

## Dashboard Surface

Add an "Evidence Briefing" section to `/anomalies`.

Card fields:
- anomaly timestamp
- symbol
- generated summary
- claim count
- supported / insufficient / contradicted counts
- confidence
- "view evidence" drawer

Empty state:
- "No verified briefs yet."
- Do not block the existing anomalies and whales tables.

Failure state:
- Show the failed run status only in an internal/admin view at first.
- Public dashboard should degrade silently until the feature is mature.

## Risk Register

| Risk | Mitigation |
|---|---|
| LLM invents a cause | Claim verifier marks unsupported claims as `insufficient_evidence`. |
| LLM costs grow silently | Per-run token/cost cap, model allow-list, Cloud Run Job timeout. |
| Dashboard waits on LLM | Dashboard only reads stored rows. |
| Infra apply races IAM | Preserve existing `time_sleep` pattern for immediate IAM dependencies. |
| BigQuery scans grow | Keep partition filters and `maximum_bytes_billed` caps. |
| Feature becomes trading advice | Use explanatory language, confidence, and paper-only constraints. |
