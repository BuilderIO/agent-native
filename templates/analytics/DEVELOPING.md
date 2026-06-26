# Analytics — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Frontend**: React 19 + React Router 8 (SPA) + TypeScript + Vite + TailwindCSS 3
- **Backend**: Nitro (via @agent-native/core) — file-based API routing
- **Database**: Drizzle ORM over portable SQL (`DATABASE_URL`; local dev defaults to SQLite)
- **Testing**: Vitest
- **UI Components**: Radix UI + TailwindCSS 3 + Lucide React icons
- **Package Manager**: pnpm

## Project Structure

```
app/                      # React SPA frontend
├── pages/                # Route components
├── components/ui/        # Pre-built UI component library
├── lib/                  # Client utilities (auth, query helpers)
├── root.tsx              # HTML shell + global providers
└── global.css            # TailwindCSS 3 theming and global styles

server/                   # Nitro API server
├── routes/               # File-based route-only endpoints (auto-discovered by Nitro)
├── handlers/             # Route handler modules (BigQuery, HubSpot, etc.)
├── plugins/              # Server plugins (startup logic)
├── db/                   # Drizzle schema + DB connection
└── lib/                  # Shared server libraries

actions/                  # Shared app operations (defineAction; UI uses action hooks)
├── run.ts                # Universal script runner
├── helpers.ts            # Shared arg parsing & output utilities
└── *.ts                  # Individual actions (auto-discovered by filename)

shared/                   # Types shared between client & server
└── api.ts                # Shared API interfaces

docs/                     # Documentation and accumulated knowledge
└── learnings.md          # Cross-cutting patterns, customer data, user prefs

.agents/skills/           # Agent guidance for app patterns and integrations
└── <skill>/SKILL.md      # Connection, functions, scripts, gotchas
```

Path aliases: `@/*` → `app/`, `@shared/*` → `shared/`

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based route-only endpoints (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (SSE, auth)
  lib/        # Shared server modules (helpers)
```

### Adding App Data

Normal app data starts as an action, not a custom route. Add `actions/<verb>-<resource>.ts` with `defineAction`, mark reads with `http: { method: "GET" }`, and call reads/writes from React with `useActionQuery` / `useActionMutation` from `@agent-native/core/client`. This keeps the UI and agent on one contract and lets mutating actions refresh action-backed queries automatically.

### Adding a Route-Only Endpoint

Use `server/routes/api/` only for protocols that cannot be modeled as JSON actions: multipart uploads, streaming/SSE/WebSocket, webhooks, OAuth callbacks/redirects, public SEO/OG endpoints, or binary/static asset serving. Do not add `/api/*` routes for normal CRUD, data queries, or pass-through wrappers around actions; the action endpoint already exists at `/_agent-native/actions/:name`.

Each route-only endpoint still exports a default `defineEventHandler`, but keep shared app logic in actions or server libraries so agent and UI behavior do not fork.

### Server Plugins

Startup logic (SSE, auth) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

### Key Imports from `@agent-native/core`

| Import                                       | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)   |
| `createSSEHandler`                           | Create SSE endpoint for real-time updates         |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)          |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)      |
| `agentChat`                                  | Send messages to agent from scripts (server-side) |

| Import (settings)             | Purpose                              |
| ----------------------------- | ------------------------------------ |
| `getSetting` / `putSetting`   | Read/write app settings in SQL       |
| `getAppState` / `putAppState` | Read/write ephemeral UI state in SQL |

## Routing

Routes are file-based in `app/routes/` via `flatRoutes()`. Create a file to add a route (e.g. `app/routes/settings.tsx` → `/settings`).

- `app/routes/_index.tsx` — home/overview page (`/`)
- `app/routes/adhoc.$id.tsx` — dashboard router (`/adhoc/:id`)
- `app/pages/adhoc/` — dashboard page components, registered in `registry.ts`

### Tools vs Dashboards

The sidebar has two sections: **Dashboards** and **Tools**. Use the right one:

- **Dashboards** — data visualizations, charts, metrics, time-series. Things people look at to understand trends. Add to `dashboards` array in `registry.ts` and `dashboardComponents` map.
- **Tools** — functional utilities with inputs/actions (e.g. look up a customer, search Stripe, run a query). Things people _use_ to get specific answers. Add to the `defaultTools` array in `app/components/layout/Sidebar.tsx`.

When a user asks for a **new feature, lookup tool, or interactive utility** → add it to **Tools**.
When a user asks for a **chart, metrics view, or data breakdown** → add it to **Dashboards**.

### Adding a Dashboard

**IMPORTANT**: When creating a new dashboard, YOU (the creator) must provide your name or email as the author. Do NOT pull this from git logs or other sources.

1. Create component in `app/pages/adhoc/my-dashboard/index.tsx` (these are regular components, not route files)
2. Use `<DashboardHeader />` component at the top to display metadata
3. Add entry to `dashboards` array in `app/pages/adhoc/registry.ts` with **REQUIRED fields**:
   - `id`: kebab-case identifier
   - `name`: Display name
   - `author`: **YOUR name or email** - the person creating this dashboard
   - `lastUpdated`: Today's date in YYYY-MM-DD format
4. Add lazy import to `dashboardComponents` in the same file

### Adding a Tool

**IMPORTANT**: When creating a new tool, YOU (the creator) must provide your name or email as the author.

1. Create component in `app/pages/adhoc/my-tool/index.tsx` (these are regular components, not route files)
2. Use `<DashboardHeader />` component at the top to display metadata
3. Add entry to `dashboards` array in `app/pages/adhoc/registry.ts` (for routing) with **REQUIRED fields**:
   - `author`: **YOUR name or email** - the person creating this tool
   - `lastUpdated`: Today's date in YYYY-MM-DD format
4. Add lazy import to `dashboardComponents` in the same file (for routing)
5. Add entry to `defaultTools` array in `app/components/layout/Sidebar.tsx` (for sidebar placement)

## Styling

- **TailwindCSS 3** utility classes for all styling
- **Theme tokens** in `app/global.css`
- **`cn()`** utility combines `clsx` + `tailwind-merge` for conditional classes

## Build & Dev Commands

```bash
pnpm dev        # Start dev server with local SQLite (frontend + backend, port 8080)
pnpm build      # Production build
pnpm typecheck  # TypeScript validation
pnpm test       # Run Vitest tests
```

`pnpm dev` pins `DATABASE_URL` to `file:./data/app.db` so local work does not
accidentally touch a production database from `.env`. To intentionally test
against another local database, set `ANALYTICS_DATABASE_URL` for that command:

```bash
ANALYTICS_DATABASE_URL=postgres://localhost/analytics_dev pnpm dev
```

## Creating Scripts

```typescript
#!/usr/bin/env tsx
import { parseArgs, output, fatal } from "./helpers";

const args = parseArgs();
if (!args.myArg) fatal("--myArg is required");

const result = await doSomething(args.myArg);
output(result);
```

Conventions:

- Import `parseArgs`, `output`, `fatal` from `./helpers`
- Import server libs directly (e.g., `../server/lib/bigquery`)
- Output JSON via `output()` for automatic `--grep`/`--fields` support
- Use `fatal()` for required arg validation
- `helpers.ts` loads `dotenv/config` so env vars are available

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Code Comments Policy

- Do not add unnecessary comments. Only comment complex logic that isn't self-evident.
- Never delete existing comments. Update them if your change makes them inaccurate.

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
