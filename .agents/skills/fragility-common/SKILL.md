---
name: fragility-common
description: >-
  Shared library and file contracts for the fragility skills
  (system-history, bug-trace, refactor-plan, identify-fragile-systems,
  investigate-bug) and the findings scripts that file plans to the configured
  tracker (Jira or GitHub issues). Read when changing how those skills
  exchange data, or before running findings-doctor, findings-match, or
  findings-upsert.
scope: dev
metadata:
  internal: true
---

# Fragility common

This folder holds code and contracts shared by the fragility skills, so each
skill can change on its own without breaking the others. It also owns the
one way findings reach a tracker.

## Findings tracker

`config.json`'s `tracker` picks where findings are filed: `"github"` (issues
in `repo`, see `github-refactor-findings`) or `"jira"` (see
`jira-refactor-findings`). The scripts below are the same for both, and load
the tracker's `scripts/tracker.ts`:

```bash
F=.agents/skills/fragility-common/scripts
pnpm exec tsx $F/<script>.ts [...]
```

- `findings-doctor.ts`: the tracker's credential and permission checks, plus
  the run link. A `run-link` warning means set `FRAGILITY_RUN_URL` or pass
  `--run-url` to the upsert.
- `findings-match.ts --run <id> [--systems a,b --files x,y]`: fetches every
  `refactor-findings` ticket into `findings.json`, then matches them against
  `targets.json` (or the given systems and files) by fingerprint, system,
  nesting, and shared files, into `finding-matches.json`. Run it before
  investigating, so you don't re-plan ticketed work.
- `findings-upsert.ts`: the only script that writes findings. It takes one of
  two inputs and records every sighting the same way:
  - `--plan <file>`: a finished plan. It matches by exact fingerprint, then
    by overlap. An overlap is never merged silently: pass `--key KEY` when
    the plan is that ticket's root problem, or `--distinct-from KEY,...` when
    it is a different one. No match creates a ticket with the label, the
    plan, and the run link. A ticket resolved as fixed gets a new recurrence
    ticket linked to the old one; a declined ticket is never re-filed.
  - `--run <id> --key KEY --system <system>`: a hot system already covered by
    an open or declined ticket, without a plan. With
    `--source <url> --source-title "<title>" --note "<how>"` it records a bug
    traced to the ticket. It refuses tickets resolved as fixed: that is a
    recurrence, so upsert a plan instead.

  KEY is `ENG-123` for Jira, or `#123` (or the issue URL) for GitHub. A
  sighting always updates the ticket's state. It comments at most once per
  cooldown since the last comment (four cooldowns for a declined ticket),
  and always once per run for a bug source. It is a dry run without
  `--apply`, and re-runs finish what a partial failure skipped. It refuses
  unfinished plans (`TODO(agent)` markers, missing confidence),
  `low`-confidence creates, and creates past the tracker's
  `maxNewTicketsPerRun` unless `--over-cap`. Each applied action appends to
  the run's `finding-results.json`, and the upsert writes the ticket key
  into the plan's `ticket` field.

Exit code 2 means the tracker could not be reached or rejected the
credentials. Never treat it as a pass.

## Library

- `lib/cli.ts`: argument parsing, `main()` with exit codes (0 ok, 1 failed,
  2 could not run), subprocesses with timeouts, JSON files, `runId()`, and
  `runDir()`.
- `lib/plan-format.ts`: the plan file format and `fingerprintFor()`.
- `lib/artifacts.ts`: types and paths for the files below.
- `lib/findings.ts`: the tracker-neutral finding model, the matching and
  cooldown rules, and the `Tracker` interface a tracker skill implements.

Skills import these with relative paths, for example
`../../fragility-common/lib/cli.ts`.

## Run directory

Each run has one directory, `<dataDir>/<run>/` (see `config.json`,
gitignored). A skill writes only its own files:

| File | Written by | Read by |
|---|---|---|
| `bug.json` | bug-trace `bug-intake` | refactor-plan, investigate-bug |
| `commits.json` | system-history `collect` | system-history `analyze` |
| `analysis.json`, `analysis.md` | system-history `analyze` | refactor-plan, the orchestrators |
| `targets.json` | system-history `analyze` | findings-match, findings-upsert |
| `findings.json`, `finding-matches.json` | `findings-match` | the orchestrators |
| `finding-results.json` | `findings-upsert` | the orchestrators |
| `decisions.json` | identify-fragile-systems (by hand) | its summarize |
| `verdict.json` | investigate-bug `bug-verdict` | its summarize |

## Plan file

Markdown with a flat frontmatter block, read and written only through
`plan-format.ts`. Fields: `fingerprint`, `title`, `area`, `systems`,
`paths`, `verdict`, `confidence`, `score`, `windowCommits`,
`lookbackFixes`, `runId`, `trigger` (`nightly` or `bug`), `source`,
`ticket`, and `summary`.

The `fingerprint` (`fsys:<first system>:<slug>`) is what ticket dedup keys on.
Never change `fingerprintFor()` without migrating existing tickets.

## Checkout constraint

This checkout is usually a blobless partial clone. `git show`, `git diff`,
`git log -p`, `--stat`, `--numstat` and `git blame` fetch blobs one at a
time and stall. Only system-history's `collect.ts` reads history, using
tree-level data. Read PR diffs through its `pr.ts`.
