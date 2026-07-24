---
"@agent-native/core": patch
---

Drop the hardcoded `--maxWorkers=25%` cap from core's `test` script. It was a
mitigation for co-scheduled `pnpm -r` test runs; CI now runs core on its own
parallel shard where the cap only served to under-use the runner.
