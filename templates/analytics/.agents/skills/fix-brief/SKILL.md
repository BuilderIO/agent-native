---
name: fix-brief
description: >-
  Turn a fired radar check into a local, evidence-backed repair brief. Use when
  Steve asks for a fix brief or approves one.
scope: dev
---

# Fix brief

- Choose one fired check and write `.tmp/first-touch-radar/briefs/<id>.md`.
- Include its query window, numerator and denominator, comparison baseline,
  affected app, relevant redacted replay link, and likely source files from
  `git grep origin/main`.
- Make acceptance measurable: the detecting query returns under threshold with
  sufficient coverage on a fresh run.
- Do not change application code until Steve explicitly approves the fix task.
  Keep UI changes out; any proposed UI repair needs Steve's screenshot approval.
- Do not include recipient emails, prompt text, or copied user content.
