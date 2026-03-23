---
name: self-modifying-code
description: >-
  How the agent can modify the app's own source code. Use when the agent needs
  to edit components, routes, styles, or scripts, when designing UI for agent
  editability, or when deciding what the agent should and shouldn't modify.
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
| 4: Off limits | Secrets and framework | `.env`, `@agent-native/core` internals           | Never modify these                |

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

## Don't

- Don't modify `.env` files or files containing secrets
- Don't modify `@agent-native/core` package internals
- Don't modify `.agents/skills/` or `AGENTS.md` unless explicitly requested
- Don't skip the typecheck/lint step after editing source code
- Don't make source changes without a git checkpoint to roll back to

## Related Skills

- **sql-as-database** — Tier 1 modifications (database writes) are the safest and most common
- **scripts** — The agent can create or modify scripts to add new capabilities
- **delegate-to-agent** — Self-modification requests come through the agent chat
- **sse-db-sync** — Source edits and database writes trigger SSE events to update the UI
