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

## Modification Taxonomy

| Tier          | What                  | Examples                                         | After modifying                   |
| ------------- | --------------------- | ------------------------------------------------ | --------------------------------- |
| 1: Data       | Files in `data/`      | JSON state, generated content, markdown          | Nothing — these are routine       |
| 2: Source     | App code              | Components, routes, styles, scripts              | Run `pnpm typecheck && pnpm lint` |
| 3: Config     | Project config        | `package.json`, `tsconfig.json`, `vite.config.*` | Ask for explicit approval first   |
| 4: Off limits | Secrets and framework | `.env`, `@agent-native/core` internals           | Never modify these                |

## Don't

- Don't modify `.env` files or files containing secrets
- Don't modify `@agent-native/core` package internals
- Don't modify `.agents/skills/` or `AGENTS.md` unless explicitly requested
- Don't skip the typecheck/lint step after editing source code

## Related Skills

- **scripts** — The agent can create or modify scripts to add new capabilities
- **delegate-to-agent** — Self-modification requests come through the agent chat
