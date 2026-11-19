---
name: ab-readout
description: >-
  Read the first-run Builder credits experiment output. Use for first-run
  onboarding experiment analysis or the weekly radar report.
scope: dev
---

# A/B readout

- Run `pnpm --filter analytics radar:ab --experiment first_run_builder_credits`.
- For the Design question-intake experiment, run
  `pnpm --filter analytics radar:ab --experiment design_no_questions` (or
  `radar:live-ab` against the live environment). Design-ready is client-observed
  at the user level across subsequent turns within 24 hours of the anchor so
  control users who answer or skip `show-design-questions` on a later turn are
  counted fairly; first-turn ready is reported separately as a diagnostic only.
  Post-ready follow-up prompts count 24h-mature users with a turn-identified
  first ready design and a server-traced generation on a distinct later turn
  strictly after that ready event (excluding intake-question answer turns and
  link-opened ready events without a `turn_id`), and completed UI exports match
  server-origin frontend exports for any qualifying ready `output_id` within 24
  hours.
- Verify the sample-ratio result and each arm's denominator before comparing
  rates. Under the configured minimum arm size, report not enough data.
- Read the 95% confidence interval and two-proportion p-value beside the raw
  counts. D1 and D7 only use mature cohorts.
- Keep per-app entry denominators separate from experiment-wide exposure counts.
  State the observation window and note the overlapping Clips recording
  experiment when interpreting Clips results.
- Report association only. Do not claim the credits variant caused a change.
