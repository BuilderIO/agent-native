---
name: first-touch-radar
description: >-
  Run the first-touch product radar for Design, Slides, and Clips. Use for daily
  watch, replay triage, weekly growth reports, or first-session incidents.
scope: dev
---

# First-touch radar

1. Run `pnpm --filter analytics radar:watch --window daily` and read both the
   JSON and Markdown under `.tmp/first-touch-radar/runs/`.
2. Treat exit 0 as clear, exit 1 as one or more fired checks, and exit 2 as
   incomplete evidence. Never turn a missing source or failed query into zero.
3. On a fire, run `pnpm --filter analytics radar:triage` and inspect the
   outcome-ranked sessions. Use `metric-watch` and `replay-triage` for details.
4. For a weekly review, run `pnpm --filter analytics radar:report --week
   <Monday>` and read the coverage flags, denominators, campaign annotations,
   previous-issue recovery, and A/B maturity before drawing conclusions.
   The `campaign-followup` check runs in daily watch and weekly report; compare
   identified recipients' post-send activity with the seven days before each
   send, split by recipient app and activity app.
5. Run `feedback-ingest` for Slack themes. Searches are read-only and begin at
   the saved watermark.
6. Send one Telegram to Steve only when a check fired or the weekly report is
   ready. Include counts and the private run-file path. Send nothing on a quiet
   day. Never send Slack or email.
7. Keep recipient emails and prompt text out of logs, reports, Telegram, and
   commits. The campaign check reads its mode-0600 recipient file in memory and
   emits aggregate counts only. It queries the recent PostgreSQL event mirror,
   including when the configured sink is BigQuery, so recipient identifiers do
   not leave the local database. Query caching is disabled. Unknown signup
   campaign labels are grouped as `other`. Anonymous landings cannot be
   assigned to a recipient; do not interpret identified counts as a complete
   click total.
8. This radar changes scripts and skills only. Do not make user-visible UI
   changes. If UI work becomes necessary, stop that scope and request Steve's
   screenshot approval before implementing it.
9. A fired metric may create a local brief through `fix-brief`; no fix starts
   until Steve approves it.
