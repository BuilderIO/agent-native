# {{APP_TITLE}} — Agent-Native Workspace

A monorepo hosting multiple agent-native apps that all inherit from a single
private **workspace core** package. The core module provides shared auth,
agent instructions, skills, components, and plugins; each app just ships its
own screens and template-specific actions.

## Layout

```
{{APP_NAME}}/
├── packages/
│   └── core-module/          # @{{APP_NAME}}/core-module — the shared mid-layer
│       ├── src/server/       # Auth / org / agent-chat plugin overrides
│       ├── src/client/       # Shared React components (org switcher, layouts…)
│       ├── actions/          # Shared agent-callable actions
│       ├── skills/           # Shared .agents skills baked into every app
│       └── AGENTS.md         # Enterprise-wide agent instructions
└── apps/
    └── example/              # Sample app demonstrating inheritance
```

## Three-layer inheritance

Every app in this workspace inherits cross-cutting behavior automatically:

1. **App local** (highest priority) — anything under `apps/<name>/server/plugins/`,
   `apps/<name>/actions/`, `apps/<name>/.agents/skills/`, `apps/<name>/AGENTS.md`.
2. **Workspace core** (middle) — `packages/core-module/src/server/`,
   `packages/core-module/actions/`, `packages/core-module/skills/`,
   `packages/core-module/AGENTS.md`.
3. **Framework** (lowest) — `@agent-native/core` defaults.

Apps don't need any configuration to opt in. Discovery happens via the
`agent-native.workspaceCore` field in this root `package.json`, which names
the workspace core package (`@{{APP_NAME}}/core-module`).

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY
pnpm dev               # starts the example app
```

## Adding a new app

```bash
cd apps
pnpm exec agent-native create crm
```

The CLI detects the workspace root and scaffolds a minimal app that already
depends on `@{{APP_NAME}}/core-module`. Edit only the routes you care about;
auth, org switching, skills, and instructions come from the core module.

## Editing shared behavior

Everything cross-cutting lives in `packages/core-module/`. A change to
`packages/core-module/src/server/auth-plugin.ts`, for example, is picked up
by every app in the workspace on the next dev reload — no need to touch any
individual app.
