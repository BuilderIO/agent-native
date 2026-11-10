---
name: ab-readout
description: >-
  Read the first-run Builder credits experiment output. Use for first-run
  onboarding experiment analysis or the weekly radar report.
scope: dev
---

# A/B readout

- Run `pnpm --filter analytics radar:ab --experiment first_run_builder_credits`.
- Verify the sample-ratio result and each arm's denominator before comparing
  rates. Under the configured minimum arm size, report not enough data.
- Read the 95% confidence interval and two-proportion p-value beside the raw
  counts. D1 and D7 only use mature cohorts.
- Keep per-app entry denominators separate from experiment-wide exposure counts.
  State the observation window and note the overlapping Clips recording
  experiment when interpreting Clips results.
- Report association only. Do not claim the credits variant caused a change.
