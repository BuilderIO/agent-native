---
name: fragility-common
description: >-
  Shared library and file contracts for the fragility skills
  (system-history, bug-trace, refactor-plan, jira-refactor-findings,
  identify-fragile-systems, investigate-bug). Read when changing how those
  skills exchange data. Not a workflow on its own.
scope: dev
metadata:
  internal: true
---

# Fragility common

No workflow lives here. This folder holds code and contracts shared by the
fragility skills, so each skill can change on its own without breaking the
others.

## Library

- `lib/cli.ts`: argument parsing, `main()` with exit codes (0 ok, 1 failed,
  2 could not run), subprocesses with timeouts, JSON files, `runId()`, and
  `runDir()`.
- `lib/plan-format.ts`: the plan file format and `fingerprintFor()`.
- `lib/artifacts.ts`: types and paths for the files below.

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
| `targets.json` | system-history `analyze` | jira-refactor-findings |
| `jira-findings.json`, `jira-matches.json` | jira `jira-match` | the orchestrators |
| `jira-results.json` | jira `jira-upsert`, `jira-sighting` | the orchestrators |
| `decisions.json` | identify-fragile-systems (by hand) | its summarize |
| `verdict.json` | investigate-bug `bug-verdict` | its summarize |

## Plan file

Markdown with a flat frontmatter block, read and written only through
`plan-format.ts`. Fields: `fingerprint`, `title`, `area`, `systems`,
`paths`, `verdict`, `confidence`, `score`, `windowCommits`,
`lookbackFixes`, `runId`, `trigger` (`nightly` or `bug`), `source`,
`jira`, and `summary`.

The `fingerprint` (`fsys:<first system>:<slug>`) is what Jira dedup keys on.
Never change `fingerprintFor()` without migrating existing tickets.

## Checkout constraint

This checkout is usually a blobless partial clone. `git show`, `git diff`,
`git log -p`, `--stat`, `--numstat` and `git blame` fetch blobs one at a
time and stall. Only system-history's `collect.ts` reads history, using
tree-level data. Read PR diffs through its `pr.ts`.
