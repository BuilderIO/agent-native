# {{APP_TITLE}} Workspace Instructions

These instructions apply to every app in the {{APP_TITLE}} workspace. Keep
only rules that should be shared across all apps here. App-specific behavior
belongs in that app's own `AGENTS.md` or `.agents/skills/` directory.

## Shared Context

Add company, product, compliance, or support-context notes that every app
agent should know.

## Shared Conventions

- Put shared code in `packages/shared` only when multiple apps need it.
- Keep app-specific screens, actions, state, and skills inside `apps/<app>`.
- Store shared runtime configuration in the workspace root `.env`; use
  `apps/<app>/.env` only for app-specific overrides.
- Prefer framework defaults until the workspace has a real custom rule,
  component, plugin, action, or skill to share.

## Adding Apps

Run `pnpm exec agent-native create <app-name> --template=starter` from the
workspace root. The workspace dev gateway (`pnpm dev`) detects new
`apps/<app-name>` directories automatically.
