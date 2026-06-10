---
title: "Multi-App Workspaces"
description: "Host many agent-native apps in one monorepo with shared auth, RBAC, instructions, skills, components, and credentials."
---

# Multi-App Workspaces

> For what a workspace _is_ — the customization layer, `AGENTS.md`, `LEARNINGS.md`, personal memory, skills, and custom agents — see [Workspace](/docs/workspace). This page is about the **deployment shape**: hosting many agent-native apps in one monorepo with shared auth, components, and a unified deploy.

When vibe-coding an internal tool takes an afternoon, you don't stop at one. A team ends up with a CRM, a support inbox, a dashboard, an ops console — ten small apps, each scaffolded independently. That's great until you need to change something in all of them.

At that point every app has its own `AGENTS.md`, its own auth plugin, its own copy-pasted layout component, its own hard-coded Slack token, its own idea of what an "organization" is. A compliance rule change means ten PRs. Rotating an API key means ten redeployments. A brand refresh means ten different headers drifting out of sync. The thing that made it easy to build them is now making it hard to manage them.

The **multi-app workspace** pattern is how agent-native solves this. You host all your apps in one monorepo alongside a private `packages/shared` package. The framework owns the common defaults; `packages/shared` is only for the code, instructions, skills, components, or plugin overrides that are genuinely custom to your workspace. Each app shrinks down to the handful of screens and actions that make it unique.

## What gets shared {#what-gets-shared}

Anything every app in your org should agree on can live in `packages/shared`:

| Shared thing                  | Where it lives                                                                |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Auth / SSO override           | Export `authPlugin` from `src/server/index.ts`                                |
| Org / RBAC rules              | Better Auth organizations, optionally wrapped by that `authPlugin`            |
| Agent chat override           | Export `agentChatPlugin` from `src/server/index.ts`                           |
| Enterprise agent instructions | `AGENTS.md`                                                                   |
| Agent skills                  | `.agents/skills/<skill-name>/SKILL.md`                                        |
| Shared agent actions          | `actions/*.ts`                                                                |
| Shared React components       | Export from `src/client/index.ts`                                             |
| Design tokens / brand         | Add a shared CSS file and import it from each app                             |
| Shared API credentials        | Prefer framework scoped credentials; add helpers only if you need namespacing |

Each individual app becomes _just a set of screens_ — routes, dashboards, views, domain-specific actions. Framework defaults cover the rest until you add a real workspace customization.

That same boundary applies when your app wants to use another first-party app. A new workspace dashboard that needs email, calendar, analytics, and company-memory context should use the existing Mail, Calendar, Analytics, and Brain apps as connected neighbors over links or A2A. It should not clone those templates, create a wrapper app that nests them, or scaffold child apps inside itself just to get access to their data or agents. Fork or scaffold a copy only when you explicitly want to customize that app.

## Getting started {#getting-started}

Workspace is the default shape of an agent-native project. Scaffold one with:

```bash
npx @agent-native/core@latest create my-company-platform
```

The CLI shows a multi-select picker of every first-party template. Pick as many as you want — Mail + Calendar + Forms, for example — and they all get scaffolded into the same workspace sharing auth and database defaults.

You get a pnpm monorepo with the private shared package, a root `package.json` that wires up workspace discovery, a shared `.env`, and one sub-directory per app you picked:

```text
my-company-platform/
├── package.json                 # declares agent-native.workspaceCore
├── pnpm-workspace.yaml          # packages: ["packages/*", "apps/*"]
├── .env.example                 # shared ANTHROPIC_API_KEY, BUILDER_PRIVATE_KEY,
│                                # A2A_SECRET, DATABASE_URL, ...
├── packages/
│   └── shared/             # @my-company-platform/shared
│       ├── src/
│       │   ├── server/          # plugin overrides only when needed
│       │   └── client/          # shared React code only when needed
│       └── AGENTS.md            # workspace-wide instructions
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
pnpm dev                         # opens Dispatch; other apps start on first visit
```

Every app already knows how to log in, share the same database, and load the workspace `AGENTS.md`. You didn't wire any of that up — the framework auto-discovered the shared package via the `agent-native.workspaceCore` field in the root `package.json`:

```json
{
  "name": "my-company-platform",
  "agent-native": {
    "workspaceCore": "@my-company-platform/shared"
  }
}
```

## Adding another app {#adding-a-new-app}

From anywhere inside the workspace:

```bash
npx @agent-native/core@latest add-app
```

The CLI shows the template picker again with apps you've already installed filtered out. Pick one or more and they get scaffolded under `apps/`. Non-interactive variant:

```bash
npx @agent-native/core@latest add-app crm --template content
```

Any first-party template works as a workspace app — the CLI runs a small **workspacify** transform on the template that adds the shared package as a dep and resolves `workspace:*` references. No parallel "workspace-app" scaffold to maintain.

```bash
pnpm install                     # at the workspace root
pnpm dev
```

That's it. The new app has the same login and workspace instructions as every other app. Add shared brand, actions, or credentials only when the workspace actually needs them.

## What you override where {#layering}

Agent-native apps inside a workspace resolve cross-cutting behavior from three places, in this order:

1. **App local** — files inside `apps/<name>/` (highest priority)
2. **Workspace shared** — files inside `packages/shared/` (the shared mid-layer)
3. **Framework default** — `@agent-native/core` (lowest)

The merge happens by file name. If an app provides a local file that also exists upstream, the local one wins. If it doesn't, the workspace shared version applies. If shared doesn't provide one either, the framework default kicks in. This applies to plugins, skills, actions, and `AGENTS.md`.

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

Everything cross-cutting you customize lives in `packages/shared/`. Export an `authPlugin` from `src/server/index.ts` and every app picks it up on the next dev reload. Add a skill under `.agents/skills/` and every app's agent sees it. Add an action to `actions/` and every app's agent can call it.

Because the shared package is a `workspace:*` dependency, pnpm symlinks it into each app's `node_modules/`. You never build or publish it — the apps bundle whatever they need from it at build time.

## Runtime global resources {#runtime-global-resources}

Use `packages/shared` for code-level defaults that should ship with the repo: plugins, shared actions, shared React code, filesystem `AGENTS.md`, and filesystem skills. Use Dispatch workspace resources for runtime-editable global context that admins want to manage without a code change.

Dispatch resources are scoped **All apps** (every app inherits them at runtime, no copy or sync step) or **Selected apps** (granted per app for app-specific context). See [Workspace](/docs/workspace#global-resources) for the full resource-model table, path conventions, and the recommended starter pack.

## Authentication and RBAC {#auth-and-rbac}

Every agent-native app already ships with [Better Auth](/docs/authentication) plus the framework's built-in organization system. In a workspace, you get that for free in every app, backed by the same database. For the full multi-tenancy model — organizations, roles, data isolation — see [Multi-Tenancy](/docs/multi-tenancy).

For enterprise-specific rules (allow-list domains, SSO enforcement, extra role checks), export an `authPlugin` from `packages/shared/src/server/index.ts`. Every app in the workspace now enforces those rules.

Active organization flows automatically: `session.orgId` → `AGENT_ORG_ID` → SQL row scoping, so data tagged with `org_id` is invisible to other orgs even to the agent. See [Security & Data Scoping](/docs/security) for the full model.

## Shared MCP servers {#shared-mcp}

The recommended options for sharing MCP servers across workspace apps, in order of preference:

1. **Dispatch workspace MCP resources** — add `mcp-servers/<name>.json` resources in Dispatch at **All apps** scope. Every app in the workspace inherits the MCP server at runtime with no file edits or redeploy. Grant to selected apps only when the server is app-specific. Tokens live in the Dispatch vault; reference them from the resource JSON with `${keys.NAME}`.

2. **Root `mcp.config.json`** — drop a file at the workspace root and every app in the workspace connects to the same MCP servers. Individual apps can override with their own `mcp.config.json` (app-root wins). Use this for local/filesystem MCP servers (`@modelcontextprotocol/server-filesystem`, `claude-in-chrome`, Playwright) that don't need per-user vault credentials.

3. **Settings UI (personal/org scope)** — for remote HTTP MCP servers, users can add them from the settings UI at Personal or Team (org) scope — no file edits, hot-reloaded into the running agent.

See [MCP Clients](/docs/mcp-clients) for the config schema, precedence rules, and hub setup.

## Shared environment variables {#shared-env}

The workspace root `.env` is loaded into every app automatically. Put shared keys once at the root — `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET`, `DATABASE_URL`, `BUILDER_PRIVATE_KEY`, etc. — and every app picks them up. Per-app overrides go in `apps/<name>/.env` and win on conflict.

For runtime app credentials, prefer the Dispatch vault over hand-editing `.env` files. The vault defaults to all-apps access, so every saved vault key is available to every workspace app and can be pushed with `sync-vault-to-app`. Switch the vault to manual mode only when apps need explicit per-key grants.

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

## Shared credentials {#shared-credentials}

Apps in the same workspace point at the same `DATABASE_URL` by default, so framework credential storage can make a credential available to every app without per-app config. Use `@agent-native/core/credentials` directly, or add a thin helper in `packages/shared` if your workspace wants a stricter naming convention.

## Shared design tokens {#design-tokens}

The framework is on Tailwind v4. Add a shared CSS file to `packages/shared` only when the workspace has real brand tokens to share, then import it from each app's `app/global.css`:

```css
@import "tailwindcss";
@import "@my-company-platform/shared/styles/tokens.css";
@source "./**/*.{ts,tsx}";

:root {
  --background: 0 0% 100%; /* ...brand tokens... */
}
.dark {
  --background: 220 6% 6%; /* ... */
}
```

Brand colors, typography, spacing scales, and any shared component classes can live in that one CSS file. Update it in `packages/shared` and every app rebrands on the next build.

## Deployment {#deployment}

You have two options: **unified deploy** (the default for workspaces) or per-app independent deploy.

### Unified deploy (recommended)

One command builds every app in the workspace and ships them behind a single origin, one path per app:

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Each app is built with `APP_BASE_PATH=/<name>` and `VITE_APP_BASE_PATH=/<name>` and emitted through the selected Nitro preset. Cloudflare Pages is the default preset and uses a dispatcher worker at `dist/_worker.js` plus `_routes.json`. Netlify is supported with `npx @agent-native/core@latest deploy --preset netlify`; it emits app functions under `.netlify/functions-internal/<app>-server` and generated redirects that leave static assets unforced so the CDN serves files first. Vercel is supported with `npx @agent-native/core@latest deploy --preset vercel`; it writes a root `.vercel/output` bundle using Vercel's Build Output API.

Being on the **same origin** is where the real payoff lives:

- **Shared login session.** Better Auth sets its cookie on the apex domain, so logging into any app logs you into every app. No cross-domain SSO dance.
- **Zero-config cross-app A2A.** `@mail` tagging `@calendar` becomes a same-origin fetch — no CORS, no JWT signing between siblings. External A2A still uses JWT as today.
- **One DNS record, one cert, one CDN cache.**

Publish the `dist/` output:

```bash
wrangler pages deploy dist
```

For Netlify:

```bash
npx @agent-native/core@latest deploy --preset netlify --build-only
```

For Vercel Git deployments, set the build command to:

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

### Public app routes

Workspace apps are internal by default. For a public site with login-only admin pages, set a public audience and protect the admin prefix in that app's `package.json`:

```json
{
  "agent-native": {
    "workspaceApp": {
      "audience": "public",
      "protectedPaths": ["/admin"]
    }
  }
}
```

For mostly internal apps with a few public pages, leave the audience internal and list page prefixes:

```json
{
  "agent-native": {
    "workspaceApp": {
      "publicPaths": ["/", "/share"]
    }
  }
}
```

These settings only affect read-only page navigation. Framework tools, agent chat, A2A, vault access, and arbitrary APIs stay authenticated unless the app explicitly declares public prefixes with `createAuthPlugin({ publicPaths: [...] })`.

### Per-app independent deploy

Prefer each app on its own domain (`mail.company.com`, `calendar.company.com`)? Every app in the workspace is still an independent deployable — `cd apps/mail && npx @agent-native/core@latest build` behaves exactly like a standalone scaffold. Cross-app A2A then goes through the standard JWT-signed path with a shared `A2A_SECRET`. Cross-domain SSO between separately-deployed apps is handled by identity federation with Dispatch as the hub — see [Cross-App SSO](/docs/cross-app-sso); the unified single-origin deploy avoids needing it.

### Shared database, shared credentials

Whatever you pick, point every app at the same `DATABASE_URL` for cross-app state out of the box: one set of user accounts, one set of organizations, one set of shared settings. If each app has its own database, the workspace pattern still works — you just lose that shared-state story.

The shared package itself is never deployed standalone. It's a `workspace:*` dep that pnpm symlinks into each app's `node_modules/`, so every app transparently bundles whatever it needs at build time.

## Out of scope (for now) {#out-of-scope}

The workspace pattern is intentionally narrow. A few things it deliberately doesn't handle yet:

- **Encrypted credential vault.** Prefer the Dispatch vault for runtime app credentials (see [Shared environment variables](#shared-env)). The non-vault fallback path — shared credentials written directly to the framework `settings` table — stores them as plain text today, so rotate responsibly when you rely on it.
- **Publishing shared code to private npm.** The shared package is `workspace:*` only; multi-repo sharing via a private registry is doable but not scaffolded.
- **Opinionated component library.** `packages/shared` is where _you_ put shared components. The framework doesn't force shadcn/ui or any other system into that slot.

## See also {#see-also}

- [Workspace](/docs/workspace) — the customization layer (`AGENTS.md`, `LEARNINGS.md`, personal memory, skills, custom agents) every app in the workspace shares.
- [Workspace Governance](/docs/workspace-management) — branching, CODEOWNERS, PR review across many apps in one repo.
- [Multi-Tenancy](/docs/multi-tenancy) — organizations, roles, and per-org data isolation.
- [Cross-App SSO](/docs/cross-app-sso) — identity federation for separate-domain deploys.
- [Dispatch](/docs/dispatch) — the runtime control plane that typically lives inside a multi-app workspace as the secrets vault, integration catalog, and approvals hub.
