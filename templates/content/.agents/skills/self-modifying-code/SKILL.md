---
name: self-modifying-code
description: >-
  Tiers, checkpoints, and off-limits paths for an agent editing the app's own
  source. Use when designing UI for agent editability, deciding whether a file
  is safe for the agent to change, or when tempted to patch config, `.env`, or
  an `@agent-native/*` package. Do not load it for ordinary source edits.
scope: dev
metadata:
  internal: true
---

# Self-Modifying Code

## Rule

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature, not a bug. Design your app expecting this.

## Why

An agent-native app isn't just an app the agent can _use_ — it's an app the agent can _change_. The agent can fix bugs, add features, adjust styles, and restructure code. This makes the agent a true collaborator, not just an operator.

## Modification Taxonomy

Not all modifications are equal. Use this to decide what level of care is needed:

| Tier          | What                  | Examples                                         | After modifying                                      |
| ------------- | --------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| 1: Data       | Files in `data/`      | JSON state, generated content, markdown          | Nothing — these are routine                          |
| 2: Source     | App code              | Components, routes, styles, scripts              | Verify **once per batch** (see Verification below) |
| 3: Config     | Project config        | `package.json`, `tsconfig.json`, `vite.config.*` | Ask for explicit approval first                        |
| 4: Off limits | Secrets and framework | `.env`, `@agent-native/*` packages & overrides   | Never modify these                                   |

Tier 4 includes **all** of the following — not only editing package source:

- Files under `node_modules/@agent-native/*` (core, dispatch, scheduling, …)
- `pnpm.overrides`, `overrides`, `resolutions`, or `patchedDependencies` that
  target any `@agent-native/*` package
- `pnpm patch`, `pnpm patch-commit`, or local package patch artifacts for any
  dependency
- Invented "dispatch/core behavior" shims meant to paper over a version skew
  or failed upgrade

This does not prohibit intentional app-owned UI customization. When public
props and composition are insufficient, the `customizing-agent-native` skill
uses `agent-native eject` to transfer the smallest supported unit from the
installed package into the app. The ejected unit must keep public runtime
contracts and must not replace Core auth, DB, actions, agent execution, or
transport behavior. Manual copying is only the fallback described by an unknown
third-party package's add-style blueprint.

When an older branch needs current packages, use **`agent-native upgrade`**
(see the `upgrade-agent-native` skill). If upgrade or typecheck fails, fix
**app** code or stop and ask — do not patch the framework.

## Git Checkpoint Pattern

Before modifying source code (Tier 2+), create a rollback point:

1. Commit or stash current state
2. Make the full batch of related edits
3. Verify once (see Verification)
4. If verification fails → revert with `git checkout -- <file>`
5. If verification passes → continue

This ensures the agent can experiment without breaking the app.

## Verification

Run checks **once at the end of a batch of related edits**, not after every
file, action, or small UI tweak. Dev already runs route/action typegen while
`pnpm dev` is up — do not treat that as a reason to also run full typecheck
after each write.

| Change shape | Verify with |
| ------------- | ----------- |
| UI / copy / layout only | Formatter if the app has one; preview or `DevServerLogs` if something looks wrong. Skip full typecheck unless the edit touched types or imports. |
| New/changed actions, schema, server, or shared types | One `pnpm typecheck` (and lint if the app has it) after the batch. |
| New DB-backed CRUD | One smoke path only (e.g. create + list via `pnpm action …` or a single HTTP call). Do **not** CLI-test every action method. |

Do not re-run typecheck to "confirm" after a clean pass. If typecheck fails on
unrelated pre-existing errors, fix or note them — do not thrash with repeated
full runs and greps.

## Designing for Agent Editability

Make your app easy for the agent to understand and modify:

**Expose UI state via `data-*` attributes** so the agent knows what's selected:

```ts
const el = document.documentElement;
el.dataset.currentView = view;
el.dataset.selectedId = selectedItem?.id || "";
```

**Expose richer context via `window.__appState`** for complex state:

```ts
(window as any).__appState = {
  selectedId: id,
  currentLayout: layout,
  itemCount: items.length,
};
```

**Use configuration-driven rendering** — Extract visual decisions (colors, layouts, sizes) into JSON config files in `data/`. The agent can modify the config (Tier 1) instead of the component source (Tier 2).

**Keep UI copy English-first** — If the app has no `app/i18n/` catalogs, edit
visible labels, toasts, empty states, and prompts as plain strings in
components. Do **not** introduce i18n catalogs, `useT()`, or a LanguagePicker
unless the user explicitly asks for localization. If catalogs already exist,
update the English source catalog and locales listed in `translations.locales`.
If the user asks for i18n, read the `internationalization` skill.

## Don't

- Don't modify `.env` files or files containing secrets
- Don't modify `@agent-native/core`, `@agent-native/dispatch`, or other
  `@agent-native/*` package internals (including under `node_modules`)
- Don't confuse readable package source with app-owned code: use
  `customizing-agent-native` and `agent-native eject` for supported ownership
  transfer
- Don't use `pnpm patch` / `pnpm patch-commit`, commit `patches/` artifacts, or
  add `pnpm.patchedDependencies` to "make the app run" after a version bump
- Don't add `pnpm.overrides` / `patchedDependencies` / `resolutions` for
  `@agent-native/*` to paper over a broken upgrade
- Don't invent local dispatch/core behavior overrides when upgrade fails —
  run `npx @agent-native/core@latest upgrade`, then fix app-level errors only
- Don't modify `.agents/skills/` or `AGENTS.md` unless explicitly requested
- Don't skip end-of-batch verification for Tier 2 changes that touch types,
  actions, schema, or server code
- Don't run `pnpm typecheck` or smoke-test every action after each file write
- Don't make source changes without a git checkpoint to roll back to

## Related Skills

- **upgrade-agent-native** — supported path to bring an older app/workspace current
- **customizing-agent-native** — configure, compose, or eject installed features safely
- **storing-data** — Tier 1 modifications (data files) are the safest and most common
- **actions** — The agent can create or modify actions to add new capabilities
- **delegate-to-agent** — Self-modification requests come through the agent chat
- **real-time-sync** — Database writes trigger change events to update the UI
- **internationalization** — UI copy, language catalogs, locale switching, and RTL-safe edits
