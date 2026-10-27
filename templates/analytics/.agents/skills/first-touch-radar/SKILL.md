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
   emits aggregate counts only. With a PostgreSQL sink, recipient identifiers
   are parameters to the read-only query and caching is disabled. A BigQuery
   sink cannot run campaign follow-up until a keyed recipient matching
   function is configured; report it as incomplete rather than treating it as
   zero. Unknown signup campaign labels are grouped as `other`. Anonymous
   landings cannot be assigned to a recipient; do not interpret identified
   counts as a complete click total.
8. This radar changes scripts and skills only. Do not make user-visible UI
   changes. If UI work becomes necessary, stop that scope and request Steve's
   screenshot approval before implementing it.
9. A fired metric may create a local brief through `fix-brief`; no fix starts
   until Steve approves it.
10. Interpret the first-touch journeys separately: Design web excludes
    `/mcp/oauth%` signup paths; Design MCP is signup → `agent_connected` → first
    `$mcp_tool_call` → `design_created`. Clips activation is signup →
    `recording_ready` within 24 hours. Treat 2026-10-21 as a definition break:
    `recording_started` before then includes local-only recordings.
11. Read the weekly paid-acquisition notes alongside signup counts: Slides ads
    stopped after 2026-10-16, Bing CPC ended around 2026-10-20 21:00 UTC for
    Clips/Design, and Google paid spend was about 45% lower from 2026-10-21.
