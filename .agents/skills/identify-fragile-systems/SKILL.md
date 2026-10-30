---
name: identify-fragile-systems
description: >-
  Nightly refactor review: find the systems the last day's commits hit
  hardest, use three weeks of history to tell fragile from fast-moving, write
  a plan per systemic fix, and file deduplicated Jira tickets. Use for
  /identify-fragile-systems or the nightly run. For a single bug report, use
  investigate-bug instead.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Identify fragile systems

Built to run unattended once a day. It strings together four skills, and
each step's details live in that skill's SKILL.md:

- `system-history`: collecting history and scoring systems;
- `jira-refactor-findings`: duplicate matching, sightings, and filing;
- `refactor-plan`: the fragile vs fast-moving judgment, and the plan file;
- `fragility-common`: the run directory and the plan format.

```bash
H=.agents/skills/system-history/scripts
J=.agents/skills/jira-refactor-findings/scripts
P=.agents/skills/refactor-plan/scripts
S=.agents/skills/identify-fragile-systems/scripts
RUN=<YYYY-MM-DD>   # defaults to today's UTC date
```

## Hard rules

- Planning only. Never change product code, open a PR, or push.
- Never run blob-reading git commands. See `fragility-common`.
- Check Jira for an existing ticket before investigating a system.
- A ticket covers only the evidence files on its paths. A ticket on the same
  system never covers the rest.
- A plan needs a named repeated mechanism, taken from diffs you read. A
  high fix count alone is not a finding.
- File only `high` or `medium` confidence plans. A `low` finding goes in
  `decisions.json`, so a later night can confirm it.
- Stop on any nonzero exit from a preflight and report it. Exit 2 is never a
  pass.

## Steps

1. **Preflight**: `$H/doctor.ts` and `$J/doctor.ts`. For a `run-link`
   warning, set `FRAGILITY_RUN_URL`.
2. **Collect**: `$H/collect.ts --run $RUN` (24 h window, 21-day lookback).
3. **Triage**: `$H/analyze.ts --run $RUN`. It writes `analysis.md` and
   `targets.json`, with the hot systems, their scores, and triage verdicts.
   Its Mega-PRs section lists window PRs that shipped 10 or more release
   notes. Their main systems are hot targets even with one window commit.
4. **Dedup early**: `$J/jira-match.ts --run $RUN`. For each hot system it
   prints how many evidence files (the window's fix and mega-PR files)
   each matched ticket's paths cover, and which files no open or declined
   ticket covers.
   - When a matched open or declined ticket covers some evidence, sight it:
     `$J/jira-upsert.ts --run $RUN --key <KEY> --system <system> --apply`.
   - When nothing is uncovered, don't re-plan the system.
   - Uncovered files go to step 6. If their diffs show the ticket's root
     problem, sight it with `--files <those files>`, which adds them to its
     paths. If they show a different one, plan it under a new slug, and name
     the related ticket.
   - A ticket resolved as fixed is a recurrence: plan it and upsert it,
     which opens a linked ticket.
5. **Audit mega-PRs**: a mega-PR means its area collected defects until
   someone swept them. For each one in analysis.md:
   - read its description with `$H/pr.ts --pr <N> --no-diff`;
   - list what it says it consolidated ("one shared X now owns", "the
     duplicated helpers are deleted", a default that hid a failure), and the
     follow-ups it names;
   - search the current tree for callers, sibling apps, and packages that
     still carry their own copy of each consolidated thing;
   - check `jira-findings.json` for each named follow-up.

   Plan what the sweep left behind, under the rubric. A sweep of pure
   polish gets a decisions.json line, not a plan. Its description is a lead:
   confirm the mechanism in the diff or the current code.
6. **Investigate** the unmatched systems and uncovered files in score
   order. Focus on `likely-fragile`, `mixed`, and high-scoring `settling`.
   Skip `coupled` unless the coupling is the defect. Skip
   `likely-fast-moving` and `insufficient-signal` unless their diffs say
   otherwise. For each system:
   - read 3 to 6 fix PRs with `$H/pr.ts`;
   - read the current top files;
   - decide using `.agents/skills/refactor-plan/references/rubric.md`.

   Fan out one read-only sub-agent per system or mega-PR when you can. Give
   it the system's `analysis.md` section and the rubric, and ask for the
   mechanism, the PR numbers, and a verdict.
7. **Plan**: one plan per root problem, which may span several systems.
   Scaffold it with `$P/new-plan.ts`, then fill it in as `refactor-plan`
   describes.
8. **Record decisions**: give every hot system you didn't plan or sight a
   one-line reason in `<dataDir>/$RUN/decisions.json`.
9. **File**: `$J/jira-upsert.ts --plan <file>` (a dry run), then add `--apply`.
   If it reports overlapping tickets, read their diffs: pass `--key KEY` when
   the plan is that ticket's problem, or `--distinct-from KEY,...` when it
   isn't.
10. **Summarize**: `$S/summarize.ts --run $RUN`. Exit 1 means some hot
    system is still undecided, so go back to step 8.

## Final report

Write 3 to 6 lines covering:

- tickets created and sighted, with links;
- each mega-PR audited, and what it left behind;
- plans held back by the cap;
- any check that could not run.

Use 🟢 when nothing is undecided and every applied upsert succeeded.
Use 🟡 when something was held back or a check exited 2, and say what.
