---
name: self-modifying-code
description: >-
  How the agent can modify the app's own source code. Use when the agent needs
  to edit components, routes, styles, or scripts, when designing UI for agent
  editability, or when deciding what the agent should and shouldn't modify.
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

| Tier          | What                  | Examples                                         | After modifying                   |
| ------------- | --------------------- | ------------------------------------------------ | --------------------------------- |
| 1: Data       | Files in `data/`      | JSON state, generated content, markdown          | Nothing — these are routine       |
| 2: Source     | App code              | Components, routes, styles, scripts              | Run `pnpm typecheck && pnpm lint` |
| 3: Config     | Project config        | `package.json`, `tsconfig.json`, `vite.config.*` | Ask for explicit approval first   |
| 4: Off limits | Secrets and framework | `.env`, `@agent-native/*` packages & overrides   | Never modify these                |

Tier 4 includes **all** of the following — not only editing package source:

- Files under `node_modules/@agent-native/*` (core, dispatch, scheduling, …)
- `pnpm.overrides`, `overrides`, `resolutions`, or `patchedDependencies` that
  target any `@agent-native/*` package
- Local patches, vendored copies, or invented "dispatch/core behavior"
  shims meant to paper over a version skew or failed upgrade

When an older branch needs current packages, use **`agent-native upgrade`**
(see the `upgrade-agent-native` skill). If upgrade or typecheck fails, fix
**app** code or stop and ask — do not patch the framework.

## Git Checkpoint Pattern

Before modifying source code (Tier 2+), create a rollback point:

1. Commit or stash current state
2. Make the edit
3. Run `pnpm typecheck && pnpm lint`
4. If verification fails → revert with `git checkout -- <file>`
5. If verification passes → continue

This ensures the agent can experiment without breaking the app.

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

**Keep localized copy in catalogs** — When editing visible UI copy, labels,
toasts, empty states, prompts, or formatting, read `internationalization` and
update `app/i18n/en-US.ts` plus existing locale catalogs instead of leaving new
inline strings in components.

## Don't

- Don't modify `.env` files or files containing secrets
- Don't modify `@agent-native/core`, `@agent-native/dispatch`, or other
  `@agent-native/*` package internals (including under `node_modules`)
- Don't add `pnpm.overrides` / `patchedDependencies` / `resolutions` for
  `@agent-native/*` to "make the app run" after a version bump
- Don't invent local dispatch/core behavior overrides when upgrade fails —
  run `npx @agent-native/core@latest upgrade`, then fix app-level errors only
- Don't modify `.agents/skills/` or `AGENTS.md` unless explicitly requested
- Don't skip the typecheck/lint step after editing source code
- Don't make source changes without a git checkpoint to roll back to

## Related Skills

- **upgrade-agent-native** — supported path to bring an older app/workspace current
- **storing-data** — Tier 1 modifications (data files) are the safest and most common
- **actions** — The agent can create or modify actions to add new capabilities
- **delegate-to-agent** — Self-modification requests come through the agent chat
- **real-time-sync** — Database writes trigger change events to update the UI
- **internationalization** — UI copy, language catalogs, locale switching, and RTL-safe edits
