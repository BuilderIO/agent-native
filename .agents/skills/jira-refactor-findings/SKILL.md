---
name: jira-refactor-findings
description: >-
  File and track refactor findings in Jira without duplicates: match a run
  against existing refactor-findings tickets, create tickets from plan files
  (Pod, label, attached plan, run link), record sightings on known tickets,
  and open linked recurrence tickets when a fixed area breaks again. Use
  whenever a fragility plan or bug finding needs to reach Jira.
scope: dev
metadata:
  internal: true
---

# Jira refactor findings

Every Jira action for refactor findings goes through these scripts. Don't
hand-roll Jira calls.

```bash
J=.agents/skills/jira-refactor-findings/scripts
pnpm exec tsx $J/<script>.ts [...]
```

Settings live in `config.json`: project, issue type, label
`refactor-findings`, the Pod field and its option id, cooldowns, the
per-run ticket cap, and the env var holding the token. Exit code 2 means
Jira could not be reached or rejected the credentials. Never treat it as
a pass.

## Inputs

The skill knows nothing about git or bug reports. It reads:

- **plan files**, through `fragility-common/lib/plan-format.ts`;
- **`targets.json`** in the run directory, written by system-history;
- **flags**, for bug context (`--source`, `--note`).

## Scripts

- `doctor.ts`: checks credentials, the five project permissions, that the
  Pod option is on the Task create screen, and the run link. A `run-link`
  warning means set `FRAGILITY_RUN_URL` or pass `--run-url` to the upsert.
- `jira-match.ts --run <id> [--systems a,b --files x,y]`: fetches every
  `refactor-findings` ticket into `jira-findings.json`. Then it matches them
  against `targets.json`, or the given systems and files, by fingerprint,
  system, nesting, and shared files, into `jira-matches.json`. Run it before
  investigating, so you don't re-plan ticketed work.
- `jira-upsert.ts`: the only script that writes findings to Jira. It takes
  one of two inputs and records every sighting the same way:
  - `--plan <file>`: a finished plan. It matches by exact fingerprint, then
    by overlap (fingerprint anchor, same or nested system, shared files). An
    overlap is never merged silently: pass `--key KEY` when the plan is that
    ticket's root problem, or `--distinct-from KEY,...` when it is a
    different one. No match creates a ticket with the Pod, the label, the
    plan attached, and the run link. A ticket resolved as fixed gets a new
    recurrence ticket linked to the old one; a declined ticket is never
    re-filed.
  - `--run <id> --key KEY --system <system>`: a hot system already covered by
    an open or declined ticket, without a plan. With
    `--source <url> --source-title "<title>" --note "<how>"` it records a bug
    traced to the ticket. It refuses tickets resolved as fixed: that is a
    recurrence, so upsert a plan instead.

  A sighting always updates the ticket's property. It comments at most once
  per cooldown since the last comment (four cooldowns for a declined ticket),
  and always once per run for a bug source. It is a dry run without
  `--apply`, and re-runs finish what a partial failure skipped: a run's
  comment is never repeated, a missing plan attachment or recurrence link is
  added, and a ticket the run created is completed rather than sighted. It
  refuses unfinished plans (`TODO(agent)` markers, missing confidence),
  `low`-confidence creates, and creates past `maxNewTicketsPerRun` unless
  `--over-cap`.

Each applied action appends to the run's `jira-results.json`, and the
upsert writes the ticket key back into the plan.
