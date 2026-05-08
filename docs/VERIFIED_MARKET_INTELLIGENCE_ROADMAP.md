# Verified Market Intelligence Roadmap

Verified Market Intelligence is the working title for the next stage of
`analytics-engine`: an AI market intelligence platform where agents explain
anomalies, gather evidence, score their own claims, and publish only auditable
insights.

Brand note: this is a descriptive working title, not the final product name.
Pick a public name later after a separate name, domain, and trademark check.

## Product Thesis

Most crypto dashboards show prices. Most AI tools produce fluent summaries.
This system should be different: every insight must be backed by data,
evidence, confidence, and a verification trail.

The product is not "AI says BTC moved." The product is:

> An agent explains a market event, decomposes the explanation into claims,
> attaches evidence for each claim, flags unsupported claims, and stores the
> result as an auditable intelligence object.

## Non-Negotiable Safety

- Protect the live GCP system. Start with additive docs, tables, endpoints, and
  dashboard sections. Avoid rewiring ingestion until the design is proven.
- Keep all new agents scale-to-zero by default. Prefer Cloud Run Jobs, scheduled
  jobs, or manual triggers over always-on services.
- Start with paper intelligence only: no exchange API keys, no wallet actions,
  no live order placement.
- Every new LLM path needs rate limiting, retries, timeout, structured logging,
  and a cost cap.
- Every agent output must be stored before being displayed, so the dashboard can
  show provenance and past mistakes.

## Feature Size Guide

| Size | Meaning | Typical PR |
|---|---|---|
| S | 0.5-1 day, low blast radius | Docs, UI copy, one endpoint wrapper, one test file |
| M | 1-3 days, one subsystem | New BQ table + API read endpoint + tests |
| L | 3-7 days, cross-subsystem | Agent job + schema + dashboard section |
| XL | 1-2+ weeks, risky or product-defining | Multi-exchange migration, automated PR bot, real trading |

## Phases

### Phase 0: Foundation and Guardrails

Goal: make the collaboration safe before adding intelligence.

Features:
- `WHO_OWNS_WHAT.md` coordination file: S
- Verified Market Intelligence roadmap and safety model: S
- Verified Intelligence technical design: S
- Documentation drift cleanup around private API naming: S
- Issue labels / PR template for owner, risk, infra delta, cost delta: S-M

Exit criteria:
- Coordination lanes (A and B) are documented in `WHO_OWNS_WHAT.md`.
- No feature can begin without a lane assignment and a risk size.
- Jawad can explain the product thesis in one minute.

### Phase 1: Evidence Data Model

Goal: create the storage contract before LLMs touch production.

Features:
- BigQuery `agent_runs` table: M
- BigQuery `claims` table: M
- BigQuery `evidence` table: M
- BigQuery `verdicts` table: M
- Read-only FastAPI endpoint for recent agent insights: M
- Dashboard placeholder section reading empty/seed data: M

Exit criteria:
- Dashboard can render verified-insight objects without calling an LLM.
- All data is append-only and auditable.

### Phase 2: Anomaly Investigator v0

Goal: explain existing z-score and ARIMA anomalies without changing ingestion.

Features:
- Manual Cloud Run Job that investigates one anomaly: M
- Deterministic anomaly context builder from BigQuery: M
- LLM wrapper with timeout/retry/cost cap: M
- Claim extraction prompt returning strict JSON: M
- Store run + claims + initial verdicts: M
- Dashboard "Evidence Briefing" cards: L

Exit criteria:
- Jawad can click/read one anomaly explanation with claims and confidence.
- If the LLM fails, the dashboard degrades gracefully.

### Phase 3: Verification Guard v0

Goal: make unsupported claims visible instead of hidden in prose.

Features:
- Evidence retriever from BigQuery anomaly context: M
- RSS/news retriever with source timestamps: M
- Claim-evidence matching baseline: M-L
- Verdict states: `supported`, `contradicted`, `insufficient_evidence`: M
- Dashboard badges and evidence drawer: M

Exit criteria:
- Every displayed agent claim has a verdict.
- Unsupported claims are shown as unsupported, not silently removed.

### Phase 4: Multi-Exchange Foundation

Goal: expand market coverage only after the verified insight loop works.

Features:
- Schema migration from `crypto_trades` to `market_trades`: XL
- Exchange-agnostic producer interface: L
- Binance producer as first non-Coinbase source: L
- Exchange selector in dashboard: M-L
- Cross-exchange anomaly view: L

Exit criteria:
- Cross-exchange anomalies become evidence for agent explanations.
- No new always-on cost is introduced without approval.

### Phase 5: Trend Scout and Self-Extension

Goal: let the system propose what to watch next, but keep humans in control.

Features:
- Daily Trend Scout job: L
- Candidate assets table: M
- Dashboard candidate review screen: M-L
- Slack `/track` command that opens a PR, not a direct deploy: XL
- Auto-deprecate suggestions after sustained low volume: L

Exit criteria:
- The system can propose additions, but Jawad approves code and infra.

### Phase 6: Paper Trading and Strategy Lab

Goal: test ideas without touching real money.

Features:
- Strategy hypothesis input format: M
- Backtest job over historical BigQuery data: L
- Metrics: Sharpe, drawdown, win rate, exposure: L
- Paper portfolio table: M
- Risk monitor for hypothetical positions: L

Exit criteria:
- The system can evaluate strategies without executing trades.

### Phase 7: Real Trading Review Gate

Goal: decide whether real trading should exist at all.

This is intentionally not an implementation phase. Before any live trading:
- Legal/regulatory review.
- Exchange API-key handling design.
- Kill switch.
- Max position and max daily loss controls.
- Audit logs.
- Manual approval flow.
- Separate production environment.

Default decision: do not build real-money trading until the intelligence and
verification product is already strong without it.
