---
name: system-history
description: >-
  Blobless-safe git and PR history for this repo. Collects first-parent
  commits, scores systems against the repo's own baseline to separate fragile
  from fast-moving, lists recent changes to specific files as regression
  candidates, and reads PR diffs through GitHub. Use when you need to know how
  an area has been changing, what recently touched a file, or what a PR did.
scope: dev
metadata:
  internal: true
---

# System history

Scripts run from the repo root:

```bash
H=.agents/skills/system-history/scripts
pnpm exec tsx $H/<script>.ts --run <id> [...]
```

Every script accepts `--help`. Exit codes: 0 ok, 1 failed, 2 could not run.
Output goes to the run directory described in `fragility-common`.

## Never read history with blob commands

This checkout is usually a blobless partial clone. `git show`, `git diff`,
`git log -p`, `--stat`, `--numstat` and `git blame` fetch blobs one at a
time and stall. Use these scripts instead. If one lacks a capability, extend
it.

## Scripts

- `doctor.ts`: the base branch is present, and `gh` is authenticated.
- `collect.ts`: writes `commits.json`, with first-parent commits on
  `origin/<baseBranch>` for `--lookback-days`, and the ones inside
  `--window-hours` marked. For window PRs it adds GitHub metadata, unless
  `--no-prs` is passed. It uses tree-level data only, and takes seconds.
- `analyze.ts`: writes `analysis.json`, `analysis.md`, and `targets.json`.
  - **Window mode** (the default): picks the systems the review window
    touched most. Each gets a percentile score against every active system,
    plus a triage verdict: `likely-fragile`, `settling`, `mixed`, `coupled`,
    `likely-fast-moving`, or `insufficient-signal`. Verdicts are leads, not
    conclusions.
  - **Focus mode** (`--focus <file,file>`): scores the systems that contain
    the given files, lists every lookback fix to each file, and lists
    **regression candidates**. Those are every commit of any kind that touched
    the files in `--regression-days` (default `regressionDays`). Use
    `--label "<title>" --label-url <url>` to name what the focus is for.
  - `--keywords <word,word>`: lists lookback fixes anywhere whose subject
    matches. Use it to find the same bug class in other systems.
  - It re-classifies commit subjects on every run, so after tuning
    `config.json`, re-run `analyze.ts` without collecting again.
- `pr.ts --pr N [--file <substring>] [--max-lines N] [--no-diff]`: a PR's
  description and diff from GitHub. Output is bounded, and truncation is
  always stated.

## Reading the scores

Counts can't tell you why a fix was needed. Before calling a system fragile,
read 3 to 6 of its fix PRs with `pr.ts`. The judgment rubric is in
`.agents/skills/refactor-plan/references/rubric.md`.

## Tuning

Thresholds, ignore lists, system depth, and the regression window live in
`config.json`.
