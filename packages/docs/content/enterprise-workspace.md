# Enterprise Workspace

A **workspace core** lets one team host many agent-native apps in a single
monorepo and share everything cross-cutting from a private mid-layer package.
Instead of every app re-implementing auth, org switching, design tokens,
agent instructions, and shared actions, those things live in one place —
and every app in the workspace inherits them automatically.

This is the pattern for enterprises who want to "vibe code" lots of small
internal tools without creating a maintenance nightmare.

## When to use this

Use the workspace pattern when:

- You're building **more than one** agent-native app for the same organization
- Those apps should share auth, user identity, active org, and agent instructions
- You want to be able to rotate an API key in one place and have every app
  pick it up
- You want to upgrade the common "app shell" (brand, layout, chat chrome)
  without touching N separate apps
- Your AGENTS.md has enterprise-wide rules (compliance, data handling,
  approval flows) that every app's agent should follow

If you're building a single standalone app, keep using `agent-native create`
as usual — nothing changes.

## The three layers

Every agent-native app sees three layers of configuration and behavior. From
lowest to highest priority:

1. **Framework** — `@agent-native/core`. Auto-mounted default plugins,
   `/_agent-native/*` routes, Better Auth + organizations, SQL scoping via
   temp views, the framework system prompt that every agent gets.
2. **Workspace core** — your private `@<company>/core-module` package.
   Overrides framework defaults for any slot you want (auth, agent chat, org
   plugin), adds shared skills and actions, provides enterprise-wide
   AGENTS.md content and Tailwind brand tokens, and houses shared React
   components.
3. **App local** — the app's own `server/plugins/`, `actions/`,
   `.agents/skills/`, and `AGENTS.md`. Highest priority: an app can override
   anything the workspace core provides by dropping a local file of the same
   name.

The framework discovers your workspace core via a single field in the
monorepo root `package.json`:

```json
{
  "name": "my-company-platform",
  "private": true,
  "agent-native": {
    "workspaceCore": "@my-company/core-module"
  }
}
```

No per-app wiring — apps inside the workspace inherit the middle layer
automatically as soon as they're installed.

## Getting started

Scaffold a new workspace:

```bash
pnpm create agent-native-workspace my-company-platform
# or
pnpm dlx @agent-native/core create-workspace my-company-platform
```

The CLI creates:

```
my-company-platform/
├── package.json                        # has agent-native.workspaceCore
├── pnpm-workspace.yaml                 # packages: ["packages/*", "apps/*"]
├── .env.example                        # shared DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY
├── tsconfig.base.json
├── packages/
│   └── core-module/
│       ├── package.json
│       ├── src/
│       │   ├── server/
│       │   │   ├── index.ts            # exports authPlugin, agentChatPlugin
│       │   │   ├── auth-plugin.ts
│       │   │   └── agent-chat-plugin.ts
│       │   ├── client/
│       │   │   ├── index.ts
│       │   │   └── AuthenticatedLayout.tsx
│       │   └── credentials.ts          # resolveCompanyCredential()
│       ├── actions/
│       │   └── company-directory.ts    # shared agent-callable action
│       ├── skills/
│       │   └── company-policies/SKILL.md
│       ├── AGENTS.md                   # enterprise-wide instructions
│       └── tailwind.preset.ts          # brand tokens
└── apps/
    └── example/                        # minimal starter app
```

Then:

```bash
cd my-company-platform
cp .env.example .env
# fill in DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY
pnpm install
pnpm --filter example dev
```

Open `http://localhost:5173` — the example app boots, inherits the workspace
auth plugin, and the agent chat already sees the `company-policies` skill
and the workspace `AGENTS.md`.

## Adding a new app to the workspace

From anywhere inside the workspace:

```bash
pnpm exec agent-native create crm
```

The CLI detects it's inside a workspace (by walking up to the root
`package.json` with `agent-native.workspaceCore`) and scaffolds `apps/crm/`
as a minimal app that:

- Depends on `@<company>/core-module` via `workspace:*`
- Imports its Tailwind preset from the workspace core
- Has no local `AGENTS.md`, `.agents/skills/`, or auth plugin — inherited
- Ships a single `app/routes/_index.tsx` that wraps content in
  `<AuthenticatedLayout>` from the workspace core

Run the new app:

```bash
pnpm install            # at the workspace root
pnpm --filter crm dev
```

Done. Zero cross-cutting boilerplate copied per app.

## Overriding workspace defaults in a specific app

When one app needs something different, create a local version and the app
layer wins automatically. The framework merges on name:

| Thing to override            | File to create inside the app                       |
| ---------------------------- | --------------------------------------------------- |
| Auth plugin                  | `apps/<name>/server/plugins/auth.ts`                |
| Org plugin                   | `apps/<name>/server/plugins/org.ts`                 |
| Agent-chat plugin            | `apps/<name>/server/plugins/agent-chat.ts`          |
| A specific skill             | `apps/<name>/.agents/skills/<skill-name>/SKILL.md`  |
| A specific action            | `apps/<name>/actions/<action-name>.ts`              |
| Additional AGENTS.md content | `apps/<name>/AGENTS.md` (merges with workspace one) |

Template-local versions beat workspace-core versions, which beat framework
defaults. No config, no wiring — the merge is by file name.

## Editing shared behavior

Everything cross-cutting lives in `packages/core-module/`. A change to
`packages/core-module/src/server/auth-plugin.ts` is picked up by every app
in the workspace on the next request (dev) or the next build (prod). Same
with `AGENTS.md`, `skills/`, `actions/`, and shared React components —
edit in one place, every app sees it.

## Shared credentials

Rotate a third-party API key in one place and every app picks it up. Use
the helper in `@<company>/core-module/credentials`:

```ts
import { resolveCompanyCredential } from "@my-company/core-module/credentials";

const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN");
```

Under the hood this wraps `@agent-native/core`'s `resolveCredential()`,
which reads from `process.env` first and falls back to the shared
`settings` table. Because apps in the same workspace share `DATABASE_URL`
by default, storing a credential once makes it available to all of them.

## Deployment

Each app in the workspace is an independent deployable. The scaffold
doesn't prescribe a hosting model — each app can go to Cloudflare Pages,
Netlify, Vercel, Node, or stay local. The only thing they have to share
is `DATABASE_URL` if you want cross-app state sharing (same Better Auth
tables, same orgs, same shared settings). If each app has its own DB,
the workspace core still works — you just lose the cross-app state story.

The workspace core itself is never built or deployed standalone. It's a
`workspace:*` dep that pnpm symlinks into each app's `node_modules/`, so
the apps transparently bundle whatever they need from it at build time.

## Out of scope (for now)

- **Cross-domain SSO** — if `crm.company.com` and `dashboards.company.com`
  are separate domains, sharing a session cookie requires a shared cookie
  domain or a central auth app with OAuth redirects. The workspace pattern
  supports both, but neither is scaffolded out of the box.
- **Encrypted credential vault** — shared credentials are stored plain-text
  in the `settings` table today. Rotate responsibly.
- **Publishing the workspace core to a private npm registry** — v1 is
  `workspace:*` only. Multi-repo sharing via private npm is doable but
  left as an exercise.
