---
name: metric-watch
description: >-
  Inspect first-touch radar checks, their query coverage, thresholds, and
  backtests. Use when a watch fires or a metric needs calibration.
scope: dev
---

# Metric watch

- Run `pnpm --filter analytics radar:watch --window daily`; use `--window
  hourly` for provisioning and environment-key checks.
- Read the check status, numerator, denominator, seven-day comparison, and
  coverage. `insufficient` is not a pass. `unavailable` and `insufficient`
  remain explicit and make a completed watch exit 1; exit 2 means the run could
  not complete.
- Compare daily thresholds with the incident window and an ordinary week before
  changing them. Record both windows and the observed counts in the PR or report.
- Use `pnpm --filter analytics radar:backtest` to compare the Oct 9–23 incident
  window with the Oct 2–8 clean week.
- Action success uses a weighted `action.response` rate. Keep its app-specific
  threshold below the quiet-week distribution; do not copy the 95% starting
  value without a backtest.
- Read signup campaign tags beside signup drops. Paid search changes are context,
  not proof that product behavior changed.
- Event first-seen checks require 10 events that day; went-to-zero checks require
  at least 50 events across the preceding seven days.
- Read `campaign-followup` as identified recipient counts after send versus the
  same recipients' prior seven days, split by recipient and activity app.
  Anonymous landings cannot be attributed to recipients.
- The hourly Analytics alert rules cannot express ratios or trailing baselines;
  do not replace these checks with simple count rules.
