---
name: Risk Review
about: Review infra, security, cost, or trading-risk changes before work starts
title: "[Risk Review] "
labels: risk, security
assignees: ""
---

## Change Under Review

What are we considering?

## Risk Type

- [ ] Security
- [ ] Cost
- [ ] Infra / IAM
- [ ] Data migration
- [ ] LLM/API spend
- [ ] Trading / financial action
- [ ] Public dashboard/API exposure

## Worst-Case Failure

What is the worst plausible thing that happens if this goes wrong?

## Controls Required

- [ ] Manual approval
- [ ] Rollback plan
- [ ] Cost cap
- [ ] Rate limit
- [ ] Secret Manager
- [ ] IAM propagation wait
- [ ] Dashboard graceful degradation
- [ ] Paper-only mode

## Decision

- Decision: approved / rejected / needs redesign
- Conditions:

