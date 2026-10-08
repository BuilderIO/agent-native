---
name: identify-fragile-systems
description: >-
  Nightly refactor review: find systems the last day's commits hit hardest,
  test three weeks of history to tell fragile from fast-moving, write a plan
  per systemic fix, and file deduplicated Jira tickets. Use for /identify-fragile-systems.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Identify Fragile Systems

Built to run unattended once a day. Every data step is a script in `scripts/`.
Do not write one-off scripts, and do not hand-roll git, `gh`, or Jira calls.
If a script is missing a capability, extend the script, then use it.

Run scripts from the repo root:

```bash
S=.agents/skills/identify-fragile-systems/scripts
pnpm exec tsx $S/<script>.ts --run <YYYY-MM-DD> [...]
```

`--run` defaults to today's UTC date. Every script accepts `--help`.
Exit codes: 0 ok, 1 failed, 2 could not run (credentials, network). A 2 is
never a pass: report it.

## Hard rules

- This checkout is usually a blobless partial clone. `git show`, `git diff`,
  `git log -p`, `--stat`, `--numstat` and `git blame` fetch blobs one at a
  time from GitHub and stall. Only `collect.ts` touches history, and it
  uses tree-level data. Read PR diffs with `pr.ts`. Read current code
  from the working tree.
- Planning only. Never change product code, open a PR, or push.
- Check Jira for an existing ticket before investigating a system.
- A plan needs a named repeated mechanism, taken from diffs you read. A
  high fix count alone is not a finding. See `references/rubric.md`.
- At most `jira.maxNewTicketsPerRun` (3) new tickets per run. Keep the
  strongest plans. Leave any extras as plan files and list them in the
  summary.

## Steps

1. **Preflight**: `doctor.ts`. Stop on exit 2 and report which check failed.
   A `run-link` warning means you must set `FRAGILITY_RUN_URL`, or pass
   `--run-url` to the upsert.
2. **Collect**: `collect.ts`. This step takes about 15 seconds. It writes
   `commits.json` with the window, the lookback, and PR metadata for window
   PRs.
3. **Triage**: `analyze.ts`. It writes `analysis.md` and `analysis.json`. Each
   hot system gets a percentile score against the repo's own baseline, plus a
   verdict: `likely-fragile`, `settling`, `mixed`, `coupled`,
   `likely-fast-moving`, or `insufficient-signal`. Verdicts are leads, not
   conclusions.
4. **Dedup early**: `jira-findings.ts`. It writes `jira-matches.json`. For
   each hot system matched to an existing ticket, run
   `jira-sighting.ts --key <KEY> --system <system> --apply` and do not
   re-plan it. The one exception is when the diffs show a different root
   problem: then write a new plan with a new slug and name the related
   ticket in it.
5. **Investigate** the unmatched systems in score order. Spend effort on
   `likely-fragile`, `mixed`, and high-scoring `settling`. Skip `coupled`
   unless the coupling itself is the defect, for example a hand-edited
   registry every feature must touch. Skip `likely-fast-moving` and
   `insufficient-signal` unless their diffs say otherwise. For each system:
   - Read 3 to 6 of its recent fix PRs with `pr.ts --pr N --file <top file>`.
   - Read the current version of its top files.
   - Decide fragile or fast-moving using `references/rubric.md`.

   Fan out one read-only sub-agent per system when that is available. Give
   it the system's `analysis.md` section and the rubric. Ask for the
   mechanism, the PR numbers, and a verdict.
6. **Cluster and plan**: one plan per root problem. A plan may span several
   systems. Scaffold it with
   `new-plan.ts --slug <kebab> --title "<line>" --systems a,b --area <Framework|Slides|Design|...>`.
   Then fill every `TODO(agent)` marker, `summary`, and `confidence` per
   `references/plan-guide.md`. Keep slugs stable across nights. The
   fingerprint is derived from the systems and the slug, and it is what
   dedup keys on.
7. **Record decisions**: for every hot system you did not plan or sight,
   add a one-line reason to `.tmp/fragile-systems/<run>/decisions.json`,
   for example `{"<system>": "fast-moving: Clips recorder launch, fixes follow #6992"}`.
8. **File**: `jira-upsert.ts --plan <file>` (a dry run), then add `--apply`.
   The script handles every case:
   - No ticket exists: it creates one in ENG as a Task, with Pod Agent
     Native, label `refactor-findings`, the plan attached, and the run
     link.
   - The ticket is open: it records a sighting, and comments at most once
     per cooldown.
   - The ticket was fixed: it opens a linked recurrence ticket.
   - The ticket was declined: it records the sighting only.

   If you judge a plan to duplicate a ticket under a different fingerprint,
   pass `--duplicate-of KEY`.
9. **Summarize**: `summarize.ts` writes the plans folder's `README.md`.
   Exit 1 means some hot system is still undecided, so go back to step 7.

## Outputs

- Raw data goes to `.tmp/fragile-systems/<run>/` (gitignored, disposable).
- Plans and the summary go to `.builder/plans/fragile-systems/<run>/`, which
  is gitignored. The durable copy is the plan attached to the Jira ticket.

## Final report

Write 3 to 6 lines covering:
- tickets created and sighted, with links;
- plans held back by the cap;
- any check that could not run.

Then the status block. Use 🟢 when the summary has no undecided systems and
every applied upsert succeeded. Use 🟡 when something was held back or a
check exited 2, and name it in the status line.

## Tuning

Thresholds, ignore lists, and system depth live in `config.json`. Change
them there, then re-run `analyze.ts` on an existing run to compare. It
re-classifies commit subjects every time, so you don't need to re-collect.
