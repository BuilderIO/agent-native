---
name: refactor-plan
description: >-
  Judge whether a system is fragile or just fast-moving, and write a
  ticket-ready refactor plan for one root problem, with measured evidence and
  a stable fingerprint. Use after system history (or a bug trace) points at a
  systemic problem worth fixing at the root.
scope: dev
metadata:
  internal: true
---

# Refactor plan

## Judge first

`references/rubric.md` separates fragile from fast-moving from coupled, and
sets confidence. The counts from system-history are leads. A plan needs
a named repeated mechanism, taken from diffs you read.

## Scaffold

```bash
pnpm exec tsx .agents/skills/refactor-plan/scripts/new-plan.ts --run <id> \
  --slug <kebab> --title "<imperative line>" --systems a,b \
  --area <Framework|Slides|Design|Clips|Content|Dispatch|General> [--force]
```

It reads the run's `analysis.json`. Every system must be one analyze
scored. When the run has a `bug.json`, the plan becomes a bug plan:

- it adds a Trigger section, and quotes the report when it has no link;
- its paths are the focus files only;
- its frontmatter gets `trigger: bug` and the report as `source`.

Plans go to `<plansDir>/<run>/<slug>.md` (see `config.json`).

## Fill it

Replace every `TODO(agent)` marker, `summary`, and `confidence`, following
`references/plan-guide.md`. Keep slugs stable across runs. The
fingerprint comes from the systems and the slug, and Jira dedup keys on it.

A plan is finished when `jira-refactor-findings`' `jira-upsert.ts` accepts
it.
