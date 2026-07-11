# Plan 001: Decide restore-vs-rebuild for the one-click agent templates (issues, meeting-notes, recruiting)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f1c6e017bc..HEAD -- packages/shared-app-config/templates.ts templates/`
> If the template catalog or templates/ changed since this plan was written,
> compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (this spike; any restore/rebuild it recommends is L and out of scope)
- **Risk**: LOW — read-only investigation producing a report; no source changes
- **Depends on**: none (pairs with `advisor-plans/002-agent-inbox-review-queue-primitive.md`)
- **Category**: direction (design/spike)
- **Planned at**: commit `f1c6e017bc`, 2026-07-10

## Why this matters

The maintainer's active product direction (decided 2026-07-09) is a catalog of
small, plug-and-play "one-click agent" templates targeting the most popular
Zapier/n8n/Lindy use cases (lead enrichment, inbox triage, meeting notes → CRM
follow-up, support triage, recruiting screener, monitoring, dev alerts, NL
reports), differentiated by real UI: review queues, dashboards, and audit
trails. That direction assumed three existing template dirs — `recruiting`,
`meeting-notes`, `issues` — were dormant "early instances" ready to finish.

This audit found the assumption is false: those templates (plus `scheduling`,
`voice`, `videos`) were **deleted from git** in June–July 2026 as "unused."
Only untracked static "retired" placeholder pages remain on disk. Before
anyone builds toward the one-click direction, someone must decide, per
template, whether to restore-and-upgrade from git history or rebuild fresh —
and which of the target use cases map to restorable assets at all. Getting
this wrong means either resurrecting stale, core-incompatible code or
needlessly rebuilding something that was 90% done five weeks ago.

## Current state

The facts, verified at commit `f1c6e017bc`:

- `packages/shared-app-config/templates.ts` — the single source of truth for
  template metadata ("Adding a new first-party template? Add its entry here").
  Its `TEMPLATES` array lists 14 entries: calendar, content, plan, slides,
  clips, brain, analytics, mail, dispatch, forms, design, assets, chat, and
  `macros` (`hidden: true`, hint: "Internal template — not shown in pickers").
  `issues`, `meeting-notes`, `recruiting`, `videos`, `voice`, `scheduling` are
  absent.
- The six absent directories exist under `templates/` but are (almost) empty
  of tracked files. `git ls-files templates/issues templates/recruiting
templates/meeting-notes templates/scheduling templates/voice
templates/videos` returns only three files:
  `templates/videos/.agents/skills/upgrade-agent-native/SKILL.md`,
  `templates/videos/netlify.toml`, and
  `templates/voice/.agents/skills/upgrade-agent-native/SKILL.md`.
  Each dir contains an untracked `dist/index.html` titled e.g.
  `"Agent Native issues retired"` — a static page that "keeps legacy Netlify
  projects deployable while their dashboard settings or DNS entries are
  cleaned up."
- Deletion commits (all reachable in history):
  - `eb18c7a502` — "chore(templates): prune unused apps and add contracts"
    (2026-06-02): deleted issues, recruiting, meeting-notes, scheduling, voice.
  - `966838d36d` — "Fix release preflight and prune unused templates".
  - `622d5528be` — "Share editor controls and harden framework updates
    (#1884)" (2026-07-03): deleted `templates/videos`.
- Pre-deletion, these were substantial apps, not stubs:
  `git ls-tree -r eb18c7a502~1 --name-only -- templates/issues | wc -l` → 189
  files; `templates/scheduling` at that commit had 13 `.agents/skills/*`
  domains (availability, booker, bookings, event-types, routing-forms,
  slot-engine, team-scheduling, workflows, …) plus `ORG_MODEL.md`,
  `QA_SUMMARY.md`, `TEST_RESULTS.md`.
- Related stale artifact: `wrangler-calorie-tracker.toml` at repo root deploys
  `./templates/calorie-tracker/dist`, a path that no longer exists (that
  template was renamed to `macros`; no `wrangler-macros.toml` was created).
- Target use-case list for the direction (research-backed, from the 2026-07-09
  decision): 1) lead enrichment/AI SDR, 2) inbox triage + draft replies, 3) meeting notes → CRM follow-up, 4) support ticket triage/drafting, 5) RAG knowledge chat, 6) content repurposing, 7) invoice
  processing/chasing, 8) recruiting screener, 9) competitor/website
  monitoring, 10) dev alerts (GitHub/CI/Sentry → Slack), 11) messaging-bot
  glue, 12) NL SQL/reports. Existing live templates already cover some:
  `dispatch` (messaging routing/glue), `brain` (RAG chat), `mail` (inbox),
  `analytics` (NL reports).
- Repo conventions that constrain any future restore: additive-only schema
  changes; actions in `actions/` via `defineAction`; ownable tables need
  scoped reads (`accessFilter`/`resolveAccess`/`assertAccess`); provider
  integrations go through the shared provider-api substrate
  (`provider-api-catalog` / `provider-api-docs` / `provider-api-request` from
  `@agent-native/core/provider-api`), never hardcoded per-provider actions.

## Commands you will need

| Purpose                             | Command                                                           | Expected on success       |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------- |
| Inspect pruning diff (per template) | `git show --stat eb18c7a502 -- templates/issues \| head -50`      | file list of the deletion |
| Read a deleted file                 | `git show eb18c7a502~1:templates/issues/package.json`             | file contents print       |
| List a deleted tree                 | `git ls-tree -r eb18c7a502~1 --name-only -- templates/recruiting` | path list                 |
| Current core version                | `node -p "require('./packages/core/package.json').version"`       | a semver string           |
| Confirm no source changes           | `git status --porcelain -- . ':!advisor-plans'`                   | empty output              |

## Scope

**In scope** (the only files you may create or modify):

- `advisor-plans/reports/001-restore-vs-rebuild.md` (create — the deliverable)
- `advisor-plans/README.md` (status row update only)

**Out of scope** (do NOT touch):

- Everything else. This is a read-only investigation. Do NOT restore any
  deleted template, do NOT edit `packages/shared-app-config/templates.ts`,
  do NOT delete `wrangler-calorie-tracker.toml` (report it; a human decides).

## Git workflow

- Stay on the current branch. This repo explicitly prohibits creating,
  switching, or otherwise moving branches unless the operator asks for that
  exact operation.
- Do NOT commit or push unless the operator instructed it. Never add
  `Co-Authored-By` or agent attribution to any commit.

## Steps

### Step 1: Extract why each template was pruned

Read the commit messages and any PR references for `eb18c7a502`,
`966838d36d`, and `622d5528be` (`git show -s <sha>` and
`git log --oneline <sha>~2..<sha>`). Record, per template (issues,
meeting-notes, recruiting, scheduling, voice, videos), any stated reason for
removal. If no reason is stated beyond "unused", record that explicitly.

**Verify**: your report draft has a "Why pruned" section with one row per
template, each row citing a commit SHA.

### Step 2: Inventory each pruned template at its last-good commit

For issues, meeting-notes, and recruiting (the three named by the direction),
plus scheduling (largest asset), extract from `eb18c7a502~1`:

- `package.json` — the pinned `@agent-native/core` version and dependencies.
- The `actions/` file list and 3 representative action files.
- `AGENTS.md` / top-level skill list.
- Approximate size (`git ls-tree -r <sha> --name-only -- templates/<name> | wc -l`).

**Verify**: report has an "Inventory" section with per-template file counts,
core version pinned at deletion, and action-surface summaries.

### Step 3: Assess API drift against current core

Compare each template's usage patterns at `eb18c7a502~1` against current
conventions. Concretely check, for each of the four templates, whether its
code at deletion time:

- called `defineAction` with the same shape used by a current template (use
  `templates/mail/actions/bulk-archive.ts` as the live exemplar);
- used `ownableColumns()` + `accessFilter`/`resolveAccess`/`assertAccess`
  scoping (current requirement);
- hardcoded provider-specific actions that would now need to go through the
  provider-api substrate;
- depended on core APIs that no longer exist (spot-check its top 5 core
  imports against `packages/core/src` today).

**Verify**: report has a "Drift assessment" section with a per-template list
of concrete incompatibilities found (or "none found" per check).

### Step 4: Map templates to the 12 target use cases and score restore-vs-rebuild

Build a decision matrix: rows = the 12 use cases in "Current state"; columns =
covered-by-live-template / restorable-from-history (which one, drift score) /
needs-fresh-build. Then, for issues, meeting-notes, recruiting, and
scheduling, give a restore-vs-rebuild recommendation with 2–4 sentences of
rationale grounded in Steps 1–3. Include the wrangler-calorie-tracker.toml
staleness as a flagged cleanup item (do not perform it).

**Verify**: report has "Use-case matrix" and "Recommendations" sections; every
recommendation cites at least one fact from Steps 1–3.

### Step 5: Finalize the report

Write the full report to `advisor-plans/reports/001-restore-vs-rebuild.md`
with exactly these top-level sections: `## Why pruned`, `## Inventory`,
`## Drift assessment`, `## Use-case matrix`, `## Recommendations`,
`## Open questions for the maintainer`.

**Verify**: `grep -c '^## ' advisor-plans/reports/001-restore-vs-rebuild.md`
→ `6`

## Test plan

No code tests — this plan produces a report, not code. The verification gates
above (section greps, empty `git status` outside `advisor-plans/`) are the
test surface.

## Done criteria

- [ ] `advisor-plans/reports/001-restore-vs-rebuild.md` exists with the six
      required sections (`grep -c '^## ' …` → 6)
- [ ] Every restore-vs-rebuild recommendation cites at least one commit SHA or
      file path as evidence
- [ ] `git status --porcelain -- . ':!advisor-plans'` → empty (no source
      modifications)
- [ ] `advisor-plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `git show eb18c7a502~1:templates/issues/package.json` fails (shallow clone
  or rewritten history) — the investigation depends on reachable history.
- You find the templates were restored or the catalog re-lists any of the six
  names (the direction may have advanced since this plan was written).
- You are tempted to restore template code into the working tree "to test it"
  — that is out of scope; describe what a restore would involve instead.

## Maintenance notes

- The follow-up work (an actual restore or fresh build of the first one-click
  template) should be planned only after this report lands and the maintainer
  picks a lane; it will interact with plan 002 (the review-queue primitive
  each one-click template is meant to sit on).
- Reviewers should scrutinize the drift assessment hardest — it decides
  whether weeks of old work is reusable, and a shallow check that misses a
  core API break would send the next executor down the wrong lane.
- Deferred deliberately: deleting `wrangler-calorie-tracker.toml` (trivial,
  but touching deploy config belongs to a human with Cloudflare dashboard
  visibility).
