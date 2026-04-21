---
title: "Enterprise Workspace"
description: "Host many agent-native apps in one monorepo with shared auth, RBAC, skills, instructions, components, and credentials."
---

# Enterprise Workspace

When vibe-coding an internal tool takes an afternoon, you don't stop at one. A team ends up with a CRM, a support inbox, a dashboard, a recruiting tracker, an ops console — ten small apps, each scaffolded independently. That's great until you need to change something in all of them.

At that point every app has its own `AGENTS.md`, its own auth plugin, its own copy-pasted layout component, its own hard-coded Slack token, its own idea of what an "organization" is. A compliance rule change means ten PRs. Rotating an API key means ten redeployments. A brand refresh means ten different headers drifting out of sync. The thing that made it easy to build them is now making it hard to manage them.

The **enterprise workspace** pattern is how agent-native solves this. You host all your apps in one monorepo alongside a private **workspace core** package. The core owns everything cross-cutting — auth, RBAC, agent skills, `AGENTS.md`, React components, design tokens, shared credentials, shared actions. Each app shrinks down to the handful of screens that make it unique. Change the core once; every app inherits the change on the next dev reload.

## What gets shared {#what-gets-shared}

Anything every app in your org should agree on lives in the workspace core:

| Shared thing                  | Where it lives in the core                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Auth (login, session, social) | `src/server/auth-plugin.ts`                                                  |
| Org / RBAC rules              | Better Auth organizations, optionally wrapped in `src/server/auth-plugin.ts` |
| Agent chat system prompt      | `src/server/agent-chat-plugin.ts`                                            |
| Enterprise agent instructions | `AGENTS.md`                                                                  |
| Agent skills                  | `skills/<skill-name>/SKILL.md`                                               |
| Shared agent actions          | `actions/*.ts`                                                               |
| Shared React components       | `src/client/*.tsx` (e.g. `AuthenticatedLayout`)                              |
| Design tokens / brand         | `styles/tokens.css`                                                          |
| Shared API credentials        | `src/credentials.ts` → `resolveCompanyCredential()`                          |

Each individual app becomes _just a set of screens_ — routes, dashboards, views, domain-specific actions. Everything else is inherited. If you're building ten tools for the same org, nine of them are 80% the same package, and the workspace core is where that 80% lives.

## Getting started {#getting-started}

Workspace is the default shape of an agent-native project. Scaffold one with:

```bash
pnpm dlx @agent-native/core create my-company-platform
```

The CLI shows a multi-select picker of every first-party template. Pick as many as you want — Mail + Calendar + Forms, for example — and they all get scaffolded into the same workspace sharing auth, brand, and agent config.

You get a pnpm monorepo with the private core package, a root `package.json` that wires up workspace discovery, a shared `.env`, and one sub-directory per app you picked:

```text
my-company-platform/
├── package.json                 # declares agent-native.workspaceCore
├── pnpm-workspace.yaml          # packages: ["packages/*", "apps/*"]
├── .env.example                 # shared ANTHROPIC_API_KEY, BUILDER_PRIVATE_KEY,
│                                # A2A_SECRET, DATABASE_URL, ...
├── packages/
│   └── core-module/             # @my-company-platform/core-module
│       ├── src/
│       │   ├── server/          # auth / agent-chat plugin overrides
│       │   ├── client/          # shared React components
│       │   └── credentials.ts   # resolveCompanyCredential()
│       ├── actions/             # shared agent-callable actions
│       ├── skills/              # shared agent skills
│       ├── AGENTS.md            # enterprise-wide instructions
│       └── styles/tokens.css    # brand tokens (Tailwind v4 @theme + CSS vars)
└── apps/
    ├── mail/
    ├── calendar/
    └── forms/
```

Then boot it:

```bash
cd my-company-platform
cp .env.example .env             # fill in ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, ...
pnpm install
pnpm dev                         # runs every app
```

Every app renders through `<AuthenticatedLayout>` from the core. Every agent chat already sees the shared `AGENTS.md` and skills. Every app already knows how to log in and can call shared actions. You didn't wire any of that up — the framework auto-discovered the core via the `agent-native.workspaceCore` field in the root `package.json`:

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/core-module"
  }
}
```

## Adding another app {#adding-a-new-app}

From anywhere inside the workspace:

```bash
agent-native add-app
```

The CLI shows the template picker again with apps you've already installed filtered out. Pick one or more and they get scaffolded under `apps/`. Non-interactive variant:

```bash
agent-native add-app crm --template content
```

Any first-party template works as a workspace app — the CLI runs a small **workspacify** transform on the template that adds the workspace core as a dep and resolves `workspace:*` references. No parallel "workspace-app" scaffold to maintain.

```bash
pnpm install                     # at the workspace root
pnpm --filter crm dev
```

That's it. The new app has the same login as every other app in the workspace, the same agent instructions, the same brand, the same actions, the same shared credentials. All you add is the domain-specific screens.

## What you override where {#layering}

Agent-native apps inside a workspace resolve cross-cutting behavior from three places, in this order:

1. **App local** — files inside `apps/<name>/` (highest priority)
2. **Workspace core** — files inside `packages/core-module/` (the shared mid-layer)
3. **Framework default** — `@agent-native/core` (lowest)

The merge happens by file name. If an app provides a local file that also exists upstream, the local one wins. If it doesn't, the workspace core's version applies. If the core doesn't provide one either, the framework default kicks in. This applies to plugins, skills, actions, and `AGENTS.md`.

When one app needs something different, drop a local file:

| Thing to override             | File to create inside the app                       |
| ----------------------------- | --------------------------------------------------- |
| Auth plugin                   | `apps/<name>/server/plugins/auth.ts`                |
| Agent-chat plugin             | `apps/<name>/server/plugins/agent-chat.ts`          |
| A specific skill              | `apps/<name>/.agents/skills/<skill-name>/SKILL.md`  |
| A specific action             | `apps/<name>/actions/<action-name>.ts`              |
| Additional agent instructions | `apps/<name>/AGENTS.md` (merges with workspace one) |

No wiring, no config. Create the file and it takes over.

## Editing shared behavior {#editing-shared-behavior}

Everything cross-cutting lives in `packages/core-module/`. Change `src/server/auth-plugin.ts` and every app in the workspace picks it up on the next dev reload. Add a new file to `skills/` and every app's agent instantly has access to the new skill. Add an action to `actions/` and every app's agent can call it.

Because the core is a `workspace:*` dependency, pnpm symlinks it into each app's `node_modules/`. You never build or publish it — the apps bundle whatever they need from it at build time.

## Authentication and RBAC {#auth-and-rbac}

Every agent-native app already ships with [Better Auth](/docs/authentication) and its organizations plugin — users, organizations, members, and the `owner` / `admin` / `member` roles are all first-class, shared across every template. In a workspace, you get that for free in every app, backed by the same database.

For enterprise-specific rules (allow-list domains, SSO enforcement, extra role checks), wrap the framework auth plugin in `src/server/auth-plugin.ts` and re-export it. Every app in the workspace now enforces those rules.

Active organization flows automatically: `session.orgId` → `AGENT_ORG_ID` → SQL row scoping, so data tagged with `org_id` is invisible to other orgs even to the agent. See [Security & Data Scoping](/docs/security) for the full model.

## Shared environment variables {#shared-env}

The workspace root `.env` is loaded into every app automatically. Put shared keys once at the root — `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `BUILDER_PRIVATE_KEY`, etc. — and every app picks them up. Per-app overrides go in `apps/<name>/.env` and win on conflict.

```text
my-company-platform/
├── .env                           # shared: ANTHROPIC_API_KEY=... , A2A_SECRET=... , ...
└── apps/
    └── mail/
        └── .env                   # optional overrides just for mail
```

A few onboarding flows are workspace-aware out of the box:

- **Builder `/cli-auth`**: clicking "Connect Builder" from any app writes `BUILDER_PRIVATE_KEY` and friends to the **workspace root** `.env`, so every app gains browser access at once.
- **Env-vars settings route** (`POST /_agent-native/env-vars`): when inside a workspace, defaults to writing the workspace root `.env`. Pass `scope: "app"` in the body to override one app.

## Shared MCP servers {#shared-mcp}

Drop an `mcp.config.json` at the workspace root and every app in the workspace connects to the same MCP servers — one place to configure `claude-in-chrome`, `@modelcontextprotocol/server-filesystem`, Playwright, or any internal MCP server. Individual apps can override with their own `mcp.config.json` (app-root wins over the workspace root for that one app).

For remote HTTP MCP servers (Zapier, Composio, internal tools), users can add them from the settings UI at **Personal** or **Team (org)** scope — no file edits, hot-reloaded into the running agent. And if you run the dispatch template, it can act as an **MCP hub** that every other app in the workspace pulls org-scope servers from, so you configure each URL + bearer token exactly once.

See [MCP Clients](/docs/mcp-clients) for the config schema, precedence rules, remote-UI scopes, and hub setup.

## Shared credentials {#shared-credentials}

Rotate a third-party API key in one place and every app picks it up:

```ts
import { resolveCompanyCredential } from "@my-company-platform/core-module/credentials";

const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN");
```

Under the hood this wraps `@agent-native/core`'s `resolveCredential()`, which checks `process.env` first and then falls back to the shared `settings` table. Apps in the same workspace point at the same `DATABASE_URL` by default, so storing a credential in settings once makes it available to every app — no per-app config.

## Shared design tokens {#design-tokens}

The framework is on Tailwind v4. The core ships a shared CSS file with the standard `@theme` tokens — each app imports it from its `app/global.css`:

```css
@import "tailwindcss";
@import "@my-company-platform/core-module/styles/tokens.css";
@source "./**/*.{ts,tsx}";

:root {
  --background: 0 0% 100%; /* ...brand tokens... */
}
.dark {
  --background: 220 6% 6%; /* ... */
}
```

Brand colors, typography, spacing scales, and any shared component classes live in that one CSS file. Update it in the core and every app rebrands on the next build. Shared React components in `src/client/` pick up the same tokens automatically.

## Deployment {#deployment}

You have two options: **unified deploy** (the default for workspaces) or per-app independent deploy.

### Unified deploy (recommended)

One command builds every app in the workspace and ships them behind a single origin, one path per app:

```bash
agent-native deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Each app is built with `APP_BASE_PATH=/<name>` and emitted into `dist/<name>/`. A dispatcher worker at `dist/_worker.js` routes each path to the matching app, and a `_routes.json` manifest tells Cloudflare Pages which paths to treat as dynamic.

Being on the **same origin** is where the real payoff lives:

- **Shared login session.** Better Auth sets its cookie on the apex domain, so logging into any app logs you into every app. No cross-domain SSO dance.
- **Zero-config cross-app A2A.** `@mail` tagging `@calendar` becomes a same-origin fetch — no CORS, no JWT signing between siblings. External A2A still uses JWT as today.
- **One DNS record, one cert, one CDN cache.**

Publish the `dist/` output:

```bash
wrangler pages deploy dist
```

### Per-app independent deploy

Prefer each app on its own domain (`mail.company.com`, `calendar.company.com`)? Every app in the workspace is still an independent deployable — `cd apps/mail && agent-native build` behaves exactly like a standalone scaffold. Cross-app A2A then goes through the standard JWT-signed path with a shared `A2A_SECRET`.

### Shared database, shared credentials

Whatever you pick, point every app at the same `DATABASE_URL` for cross-app state out of the box: one set of user accounts, one set of organizations, one set of shared settings. If each app has its own database, the workspace pattern still works — you just lose that shared-state story.

The workspace core itself is never built or deployed standalone. It's a `workspace:*` dep that pnpm symlinks into each app's `node_modules/`, so every app transparently bundles whatever it needs from the core at build time.

## Out of scope (for now) {#out-of-scope}

The workspace pattern is intentionally narrow. A few things it deliberately doesn't handle yet:

- **Cross-domain SSO.** The unified `agent-native deploy` flow solves the common case (one origin, many apps at `/mail`, `/calendar`, …). If you need `mail.company.com` and `calendar.company.com` on _different_ domains to share a session, that requires a shared cookie domain or a central auth app with OAuth redirects — both supported by the underlying stack but neither scaffolded out of the box.
- **Encrypted credential vault.** Shared credentials live in the `settings` table as plain text today. Rotate responsibly.
- **Publishing the core to private npm.** The core is `workspace:*` only; multi-repo sharing via a private registry is doable but not scaffolded.
- **Opinionated component library.** The core is where _you_ put shared components. The framework doesn't force shadcn/ui or any other system into that slot.
