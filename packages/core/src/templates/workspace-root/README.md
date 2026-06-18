# {{APP_TITLE}} — Agent-Native Workspace

A monorepo hosting multiple agent-native apps that all inherit from a single
private **shared** package. The framework provides the defaults; this package
is only for code, instructions, and policies that are genuinely shared by more
than one app.

## Layout

```
{{APP_NAME}}/
├── packages/
│   └── shared/               # @{{APP_NAME}}/shared — optional shared code
│       ├── src/server/       # Add plugin overrides only when needed
│       ├── src/client/       # Add shared React code only when needed
│       └── AGENTS.md         # Workspace-wide agent instructions
└── apps/
    └── example/              # App-specific routes, actions, and state
```

## Three-layer inheritance

Every app in this workspace inherits cross-cutting behavior automatically:

1. **App local** (highest priority) — anything under `apps/<name>/server/plugins/`,
   `apps/<name>/actions/`, `apps/<name>/.agents/skills/`, `apps/<name>/AGENTS.md`.
2. **Workspace shared** (middle) — `packages/shared/src/server/`,
   `packages/shared/src/client/`, `packages/shared/actions/`,
   `packages/shared/.agents/skills/`, `packages/shared/AGENTS.md`.
3. **Framework** (lowest) — `@agent-native/core` defaults.

Apps don't need any configuration to opt in. Discovery happens via the
`agent-native.workspaceCore` field in this root `package.json`, which names
the shared package (`@{{APP_NAME}}/shared`).

The workspace root also links `.agents/skills` to the shared package so coding
agents launched from the root can discover the same workspace-wide skills.

Runtime-editable global resources live in Dispatch, not in `packages/shared`.
Use Dispatch **Resources** for company context and guardrails that admins should
change without a code deploy:

- `AGENTS.md` or `instructions/<slug>.md` for instructions every app agent loads
- `skills/<slug>/SKILL.md` for workspace skills
- `context/<slug>.md` for personas, positioning, messaging, company facts, and brand guidelines
- `agents/<slug>.md` for reusable custom agent profiles

Set those resources to **All apps** when every workspace app should receive
them; use selected-app grants for app-specific packs.

Starter global resources:

```text
context/company.md              # company overview, ICP, products, canonical links
context/brand.md                # brand voice, visual identity, spelling, terms to avoid
context/messaging.md            # positioning, value props, proof points, objections
instructions/guardrails.md      # compliance, escalation, and approval rules
skills/company-voice/SKILL.md   # copywriting/review guidance for customer-facing work
```

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, BETTER_AUTH_SECRET, and an LLM provider key
pnpm repair:workspace-org -- --name "Example Co" --domain example.com --owner-email owner@example.com
pnpm dev               # starts the workspace gateway; opens Dispatch when present
```

The dev gateway serves Dispatch at `/dispatch` when you keep the recommended
Dispatch app selected, and every app at its own path such as `/chat`. It
watches `apps/`, so newly-created apps are detected without restarting
`pnpm dev`. App servers start lazily the first time you visit their path. App
links should stay relative, such as `/chat` or `/<app-id>`; do not hardcode
localhost or dev ports because the active gateway origin owns the port.

Dispatch vault keys are workspace-wide by default: every saved vault key is
available to every workspace app and can be synced from Dispatch. Switch the
Vault page to manual access only when you need explicit per-app key grants.
Dispatch resources are inherited rather than synced: All-app resources live
once at workspace scope and every app agent reads them at runtime. Use selected
resource grants only for genuinely app-specific context.

## Workspace org identity

Set these root `.env` values before production deploys or when repairing
cross-app trust:

- `WORKSPACE_ORG_NAME` — the organization name users should see.
- `WORKSPACE_ORG_DOMAIN` — the bare email/domain claim used for org matching.
- `WORKSPACE_OWNER_EMAIL` — the owner/admin email to use for bootstrap or
  integration fallback.
- `A2A_SECRET` — shared signing secret for cross-app A2A calls.

Run `pnpm repair:workspace-org -- --name "<org>" --domain example.com --owner-email owner@example.com`
to fill or validate those values without committing secrets. Existing
organization rows should still be repaired through the app's org settings UI or
authenticated org routes whenever possible.

## Adding a new app

```bash
pnpm exec agent-native create crm --template=chat
```

The CLI detects the workspace root and scaffolds a minimal chat app that already
depends on `@{{APP_NAME}}/shared`. Edit only the routes you care about;
auth, org switching, skills, and instructions come from the shared package.
Chat is only the source scaffold: the finished app should use its own name,
home screen, navigation, package metadata, and manifest rather than leaving
chat or new-app UI in place.
If the request starts from Dispatch in production, Dispatch sends it to Builder
branch creation; that branch should still add a new `apps/<app-id>` workspace
app rather than adding files to `apps/chat`.
Dispatch discovers ready apps from `apps/<app-id>/package.json`; there is no
separate workspace app registry to edit. React Router apps must preserve
`APP_BASE_PATH` / `VITE_APP_BASE_PATH` in `app/entry.client.tsx` via
`appBasePath()` so `/<app-id>` hydrates correctly.
For requests phrased as creating an "agent", classify the scope first: simple
recurring Dispatch behavior can stay in Dispatch, while a robust app-like
teammate should become a real workspace app listed with the rest of the apps.
First-party apps such as Mail, Calendar, Analytics, Brain, Assets, and Dispatch should be
treated as existing hosted or connected neighbors. If a new app needs access to
their data or agents, link/delegate to those apps through the workspace/A2A
path rather than creating wrapper apps, child apps, or cloned template copies
inside the new app. Only fork one of those apps when the user explicitly asks
for a customized copy.

## Editing shared behavior

Put cross-cutting code in `packages/shared/` when more than one app needs it.
For example, exporting an `authPlugin` from `packages/shared/src/server/index.ts`
lets every app use the same auth customization on the next dev reload.
