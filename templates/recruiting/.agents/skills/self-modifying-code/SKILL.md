---
name: self-modifying-code
description: >-
  How the agent can modify the app's own source code. Use when the agent needs
  to edit components, routes, styles, or scripts.
---

# Self-Modifying Code

## Rule

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature, not a bug.

## Modification Taxonomy

| Tier          | What                  | After modifying                   |
| ------------- | --------------------- | --------------------------------- |
| 1: Data       | Files in `data/`      | Nothing — these are routine       |
| 2: Source     | App code              | Run `pnpm typecheck && pnpm lint` |
| 3: Config     | Project config        | Ask for explicit approval first   |
| 4: Off limits | Secrets and framework | Never modify these                |

## Don't

- Don't modify `.env` files or files containing secrets
- Don't modify `@agent-native/core` package internals
- Don't skip the typecheck/lint step after editing source code

## Related Skills

- **scripts** — The agent can create or modify scripts
- **delegate-to-agent** — Self-modification requests come through the agent chat
