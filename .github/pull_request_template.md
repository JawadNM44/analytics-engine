## Summary

- 

## Owner

- Project owner: Jawad NM (always)
- Lane: `A` / `B`
- Coordination entry updated in `WHO_OWNS_WHAT.md`: yes / no
- All commits authored as `JawadNM44 <jawad141005@gmail.com>` with no AI attribution: yes / no

## Feature Size

- Size: `S` / `M` / `L` / `XL`
- Why:

## Risk Checklist

- [ ] No always-on Cloud Run service added or restarted without explicit approval.
- [ ] `crypto-api` remains private (`--no-allow-unauthenticated`).
- [ ] No real-money trading, wallet access, or exchange API-key usage.
- [ ] No secrets or API keys in repo, env examples, logs, or direct Cloud Run env vars.
- [ ] BigQuery queries keep partition/cluster discipline and bytes-billed caps where applicable.
- [ ] IAM changes that are used immediately include a propagation wait where needed.

## Public API / Dashboard Changes

- Public routes changed:
- Backend routes changed:
- Dashboard views changed:

## Infra / Cost Delta

- Terraform resources changed:
- Expected monthly cost impact:
- Scale-to-zero preserved: yes / no

## Tests

- [ ] Unit tests added/updated
- [ ] Existing tests pass locally
- [ ] Terraform fmt/validate checked if Terraform changed
- [ ] Frontend lint/build checked if dashboard changed

