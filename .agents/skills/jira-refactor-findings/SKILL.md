---
name: jira-refactor-findings
description: >-
  The Jira tracker for refactor findings: ENG tickets labeled
  refactor-findings with the Pod field, the plan attached, and a run link.
  Read when fragility-common/config.json sets tracker to jira and you need to
  know how findings map onto tickets, or when changing that mapping.
scope: dev
metadata:
  internal: true
---

# Jira refactor findings

Don't call these scripts directly. Use fragility-common's `findings-doctor`,
`findings-match`, and `findings-upsert`. They load this skill when
`fragility-common/config.json` sets `"tracker": "jira"`. Don't hand-roll
Jira calls for findings either.

Settings live in `config.json`: project, issue type, label
`refactor-findings`, the Pod field and its option id, cooldowns, the
per-run ticket cap, and the env var holding the token. Exit code 2 means
Jira could not be reached or rejected the credentials. Never treat it as
a pass.

## How a finding maps onto a ticket

- **Ticket**: a Task with the label and the Pod option set. `--key` takes
  `ENG-123` or the browse URL.
- **Plan**: attached as `<plan>-<run>.md`. A sighting with a new plan
  attaches another version.
- **State**: fingerprint, systems, paths, and sightings go in the issue
  property named by `propertyKey`.
- **Fixed**: done with a non-declined resolution. A new plan for it opens a
  recurrence ticket linked with "Relates".
- **Declined**: a resolution or status like Won't Do, Duplicate, or Obsolete.
  It is never re-filed.
- **Sightings**: comments.

`findings-doctor` checks credentials, the five project permissions
(create, attach, comment, edit, link), and that the Pod option is on the
Task create screen.

bug-trace's `bug-intake --jira` also reads tickets through `scripts/jira.ts`.
