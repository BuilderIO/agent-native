---
name: product-judgment
description: >-
  Five-step product and craft pre-flight for new Agent-Native apps and
  user-facing extensions. Inventories platform/toolkit primitives, records a
  6-Axis Judgment Card and 3-Option Decision Block in DESIGN.md, applies 5
  human-team review lenses, and enforces clear escalation boundaries.
scope: dev
metadata:
  internal: true
---

# Product Judgment

Run this five-step pre-flight before writing code for any new app, screen, or
user-facing extension. Good product judgment is visible in the running UI:
shared primitives reused, crisp state transitions, zero dead ends, and recorded
tradeoffs in `DESIGN.md`.

## Step 0: Inventory `packages/core` and `@agent-native/toolkit/craft`

Before designing or writing app-local helpers, grep the platform and toolkit so
you never rebuild solved workspace or craft behavior:

```bash
# Search core capabilities (actions, sharing, auth, manifest, hooks)
rg --files packages/core/src | head -n 60

# Search toolkit craft primitives and reusable kits
rg --files packages/toolkit/src/craft packages/toolkit/src/app/styles
```

Check these primitives first:

- `@agent-native/toolkit/craft`:
  - `ResourceStateBoundary` — mandatory `skeleton`, actionable `empty` CTA, and
    `error` retry path (eliminates bare `"Loading..."` and dead-end screens).
  - `useCommandRegistry` — portable `Mod` (`Cmd`/`Ctrl`), `j`/`k`, `Esc`, and
    `?` shortcut help that automatically ignores editable inputs.
  - `SafeDestructiveAction` — instant optimistic execution + undo affordance for
    reversible actions; accessible `AlertDialog` confirmation for irreversible
    actions (never `window.confirm`, `alert`, or `prompt`).
  - `useOptimisticAction` — synchronous optimistic snapshot/rollback wrapper
    with error callback and optional undo hook (`<100ms` ack budget).
- `@agent-native/toolkit/styles.css` (includes `craft-tokens.css`): semantic
  `--success`, `--warning`, `--info` pairs, `--surface-0`..`--surface-3`
  elevation ramp, `--density-compact|default|comfortable`, `tabular-nums`,
  motion tokens (`--dur-instant: 90ms`, `--dur-fast: 150ms`,
  `--dur-panel: 220ms`, `prefers-reduced-motion`), and `640px` chat-companion
  `@container` utilities.
- `agent-native-toolkit` kits for settings, sharing, onboarding, collaboration,
  chat history, data grid, and agent sidebar handoffs.

## Step 1: Write the 6-Axis Judgment Card in `DESIGN.md`

Every app or extension updates `DESIGN.md` before implementation. Choose the
mode that matches the task:

- **Extension mode** (modifying or extending an existing app/host): inherit the
  host's palette, typography, elevation, focus style, density, and keyboard
  idioms. Document which host surface you matched and where you deliberately
  extend it.
- **Greenfield mode** (new domain app or standalone surface): choose a concrete,
  domain-appropriate visual direction and palette in tokens (never default
  scaffold grey or unprompted purple/indigo/cyan AI gradients).

Fill all six axes concisely in `DESIGN.md`:

| Axis | Contract to record |
| --- | --- |
| 1. Primary Object & Verb | The single domain object that fills the first viewport and the one primary action users repeat. |
| 2. Visual Direction & Tokens | Named palette/typography direction, semantic light/dark tokens (`--primary`, `--success`, `--warning`, `--info`, `--surface-0..3`), zero raw color literals. |
| 3. Density & Hierarchy | Target density (`compact` / `default` / `comfortable`), tabular numbers for counts/metrics, and squint-test hierarchy (primary / secondary / tertiary). |
| 4. State Completeness | Populated fixture (12+ varied rows), layout-matched skeleton, actionable empty CTA, optimistic ack (`<100ms`), pending state (`<400ms`), error with retry, and offline/stale handling. |
| 5. Split-Pane & Mobile Layout | Behavior inside `<=640px` chat-companion `@container` split mode (`craft-split-stack`, `craft-split-hide`) and `390px` mobile without horizontal overflow or clipped headers. |
| 6. Keyboard, Undo & Safety | Portable `Mod` shortcuts, `j`/`k`/`Esc`/`?` map, and classification of every destructive verb as reversible (instant + undo) vs. irreversible (`AlertDialog`). |

## Step 2: Record a 3-Option Decision Block

For the primary UX or architectural fork, compare three concrete options in
`DESIGN.md` before coding:

1. **Option A — Minimal / Safe**: smallest change or generic pattern; note where
   it falls short on domain fit or user speed.
2. **Option B — Recommended Domain-Fit**: matches the user's real mental model
   and reuses `@agent-native/toolkit/craft` cleanly; state why it wins.
3. **Option C — Over-Scoped / Premature**: extra modes, wizards, or bespoke
   infrastructure; state why it is rejected now and what signal would warrant it.

Keep the decision block to 6–10 lines. Rejected options prevent future agents
from oscillating back to dead ends.

## Step 3: Run the 5 Human-Team Lenses

Before declaring work ready, audit the diff and running UI through five lenses:

1. **Product Designer**: Does the domain object own the first viewport? Delete
   redundant page titles, subtitles, eyebrows, and KPI strips. Verify the squint
   test and semantic token discipline.
2. **Design Engineer**: Do interactive controls acknowledge in `<100ms`, show
   pending states within `<400ms`, respect `prefers-reduced-motion`, preserve
   focus rings, keep `>=40px` desktop / `>=44px` touch targets, and hold `>=4.5:1`
   contrast in both light and dark modes?
3. **Staff Frontend Engineer**: Are all async surfaces wrapped in
   `ResourceStateBoundary`, mutations rolled back cleanly on error, components
   well-factored (no god components with `>25` `useState` calls), and static
   audit (`pnpm tsx scripts/guard-craft-slop.ts <dir>`) clean?
4. **Power User**: Do `Mod` shortcuts work on both macOS (`Cmd`) and
   Windows/Linux (`Ctrl`), stay silent inside text inputs, expose `?` help, and
   avoid confirmation dialogs on reversible actions?
5. **First-Time User**: Can a stranger tell what the app does in 3 seconds with
   believable sample data, clear empty-state CTAs, and recoverable errors?

## Step 4: Escalation Boundary

Decide and execute autonomously on routine UX, layout, state-handling, and
craft improvements. Stop and escalate with your 3-Option Decision Block when
encountering any of these boundaries:

- **Irreversible data or schema loss**: dropping tables/columns, destructive
  migrations, or bulk deletes without recovery.
- **Missing external credentials or billing**: required OAuth apps, API keys, or
  paid third-party connections not present in the environment (never fabricate
  secrets or bypass auth).
- **Security or access-control ambiguity**: unclear private vs. org vs. public
  visibility on sensitive user data.
- **Conflicting requirements**: user instructions directly contradict an
  existing product invariant or schema contract.

## Related

- `build-an-app`: end-to-end app creation workflow using this pre-flight.
- `app-quality-bar`: 12-row visual rubric (`visual-review.md`) and 60-second
  Playwright walkthrough.
- `skills/turn-into-app/references/review-loop.md`: screenshot capture script
  and multi-pass visual review loop.
- `agent-native-toolkit`: reusable workspace UI kits and customization ladder.
