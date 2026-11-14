---
name: replay-triage
description: >-
  Review outcome-ranked first-touch sessions and their replay evidence. Use when
  radar checks or the weekly report identify a first-session failure.
scope: dev
---

# Replay triage

- Run `pnpm --filter analytics radar:triage` or pass `--date YYYY-MM-DD` for a
  UTC day.
- Start with `prompted_no_output`, `recording_started_no_ready_clip`, and
  `onboarding_abandoned`. Friction and performance fields explain outcomes; do
  not rank sessions by friction score.
- Review at most the top 15–30 sessions. When a bearer is available, fetch replay
  timelines only for those recording ids through Analytics' deployed action.
- Use event names, offsets, counts, trouble labels, and performance summaries.
  Never include emails, prompt text, URLs, or other user content in a report.
