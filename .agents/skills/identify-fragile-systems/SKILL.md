---
name: identify-fragile-systems
description: >-
  Find fragile systems and file deduplicated refactor tickets. Two entry
  points: the nightly review of the last day's commits, and a bug report
  (GitHub issue, Jira ticket, or pasted text) to decide whether the bug is a
  one-off or a symptom of a pattern worth fixing at the root. Use for
  /identify-fragile-systems, or proactively when handed a bug report and asked
  whether something deeper is wrong.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Identify Fragile Systems

## Pick a mode

- **Nightly**: no bug report given. Follow [Steps](#steps). Built to run
  unattended once a day.
- **Bug report**: you were given a report, issue, ticket, or pasted
  message. Follow [Bug-report mode](#bug-report-mode). It reuses the same
  scripts, history, dedup, plans, and Jira lifecycle, scoped to the files the
  bug lives in.

Built to run unattended. Every data step is a script in `scripts/`.
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
- File a ticket only for `high` or `medium` confidence plans. A `low`
  confidence finding goes in decisions.json, so the next night can confirm
  it. `jira.maxNewTicketsPerRun` (6) is a runaway guard, not a quota.

## Steps

1. **Preflight**: `doctor.ts`. Stop on any nonzero exit and report which
   check failed. Exit 1 is a known bad state, such as a missing permission.
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
   re-plan it. The exceptions:
   - The ticket was resolved as fixed. `jira-sighting` refuses it, because
     a hot system after a fix is a recurrence. Write a plan and upsert it,
     which opens a linked recurrence ticket.
   - The diffs show a different root problem. Write a new plan with a new
     slug, and name the related ticket in it.
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
   - No ticket exists: it creates one in ENG as a Task, with the
     Agent-Native Pod, label `refactor-findings`, the plan attached, and
     the run link.
   - The ticket is open: it records a sighting, and comments at most once
     per cooldown.
   - The ticket was fixed: it opens a linked recurrence ticket.
   - The ticket was declined: it records the sighting, comments at most
     once every four cooldowns, and never re-files it.

   If you judge a plan to duplicate a ticket under a different fingerprint,
   pass `--duplicate-of KEY`.
9. **Summarize**: `summarize.ts` writes the plans folder's `README.md`.
   Exit 1 means some hot system is still undecided, so go back to step 7.

## Bug-report mode

The question is not "what is broken" but "is this bug a one-off, or one
instance of a pattern that will keep producing bugs". One run per report.

1. **Preflight**: `doctor.ts`, same rules as nightly.
2. **Intake**: `bug-intake.ts --issue <N|url> | --jira <KEY|url> | --file <path> | --text "<report>"`.
   It writes `bug.json` and prints the run id (`bug-gh-123`,
   `bug-eng-456`, or `bug-<date>-<hash>`). Pass that id as `--run` to every
   later step. `bug.json` is what puts the other scripts into bug mode.
3. **Split symptoms**: a report often lists several. Treat each as its own
   symptom with its own verdict. Name them with short labels.
4. **Locate**: for each symptom, find the code path from the working tree.
   Name the files the defect lives in and, if you can, the line. Reproducing
   is welcome but optional. Never change product code.
5. **Collect**: `collect.ts --run <id>`. In a bug run the lookback defaults
   to `bugLookbackDays` (60) and window PR metadata is skipped.
6. **Score the focus**: `analyze.ts --run <id> --focus <file,file> --keywords <word,word>`.
   `--focus` takes the files from step 4, across all symptoms. It scores
   the systems that contain them against the repo baseline and lists every
   lookback fix to each focus file. `--keywords` lists fixes anywhere
   whose subject matches, which is how you find the same bug class landing in
   another template. Re-run it as your focus sharpens.
7. **Dedup early**: `jira-findings.ts --run <id>`. If an existing ticket's
   mechanism covers a symptom, record
   `jira-sighting.ts --key <KEY> --system <system> --note "<how this bug is an instance>" --apply`.
   A bug-run sighting always comments once, because a real bug is new
   evidence. The symptom's verdict is `known`.
8. **Investigate** each remaining symptom:
   - Read the earlier fixes to the focus files with `pr.ts`. Did one of
     them fix the same mechanism? Did it regress here?
   - Search the working tree for the faulty construct elsewhere: the same
     helper misuse, the same unguarded call, the same parallel copy of a core
     primitive. Sibling sites carrying the bug today count as instances.
   - Decide using "Bug reports" in `references/rubric.md`.
9. **Plan if pattern**: `new-plan.ts --run <id> --slug ... --systems ...`
   as in nightly step 6. The scaffold adds a Trigger section for the bug.
   Prefer a slug the nightly run would also choose, so both converge on one
   fingerprint. Then `jira-upsert.ts --plan <file>`, then add `--apply`.
10. **Record a verdict per symptom**:
    `bug-verdict.ts --run <id> --symptom <label> --verdict one-off|pattern|known --root-cause "<file:line, what goes wrong>" --reason "<why>"`,
    plus `--fix "<local fix>"` for one-off, `--plan <file>` for pattern
    (with `--unfiled "<why>"` if it has no ticket), or `--ticket KEY` for known.
    Use `needs-info` with `--ask "<log, repro, or detail>"` when code and
    history cannot decide it, for example when a desktop log would tell
    which of two causes it is. Don't guess a verdict to finish the run.
11. **Summarize**: `summarize.ts --run <id>`. Exit 1 means no verdict yet.

Report, per symptom: the verdict, the root cause with file:line, and the
local fix or the ticket link. Lead with what the reporter needs to know.

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
