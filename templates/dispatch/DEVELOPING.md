# {{APP_NAME}} — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework:** @agent-native/core + React Router v8 (framework mode)
- **Frontend:** React 19, Vite, TailwindCSS, shadcn/ui
- **Routing:** File-based via `flatRoutes()` — SSR shell + client rendering
- **Backend:** Nitro (via @agent-native/core) — file-based API routing, server plugins, deploy-anywhere presets
- **State:** SQL-backed (SSE for real-time updates)

## Commands

- **Dev:** `pnpm dev` (Vite dev server with both React Router + Nitro plugins)
- **Build:** `pnpm build` (React Router build — client + SSR + Nitro server)
- **Start:** `node .output/server/index.mjs` (production)

## Directory Structure

```
app/                   # React frontend
  root.tsx             # HTML shell + global providers
  entry.client.tsx     # Client hydration entry
  routes.ts            # Route config — flatRoutes()
  routes/              # File-based page routes (auto-discovered)
    _index.tsx         # / (home page)
  components/          # UI components
  hooks/               # React hooks
  lib/                 # Utilities (cn, etc)

server/                # Nitro API server
  routes/
    api/               # Route-only endpoints (uploads, webhooks, OAuth, streaming)
    [...page].get.ts   # SSR catch-all (delegates to React Router)
  plugins/             # Server plugins (startup logic)
  lib/                 # Shared server modules

shared/                # Isomorphic code (imported by both client & server)

actions/               # Shared app operations (defineAction; UI uses action hooks)
  run.ts               # Script dispatcher
  *.ts                 # Individual actions (pnpm action <name>)

data/                  # Local development database fallback

react-router.config.ts # React Router framework config
.agents/skills/        # Agent skills — detailed guidance for each rule
```

## Framework Basics

**SSR-first framework, CSR-by-default content:** This app uses React Router v8 framework mode with `ssr: true`. But virtually every route renders only an SSR shell (loading spinner + meta tags). Normal app data fetching happens on the client via action hooks. Server-side data fetching is the exception — only used for public pages that need SEO/OG tags.

## Adding a Page

Create a file in `app/routes/`. The filename determines the URL path:

```
app/routes/_index.tsx              → /
app/routes/settings.tsx            → /settings
app/routes/inbox.tsx               → /inbox
app/routes/inbox.$threadId.tsx     → /inbox/:threadId
app/routes/$id.tsx                 → /:id (dynamic param)
```

Each route file exports a default component, optional `meta()`, and optional `HydrateFallback()`:

```tsx
import MyPage from "@/pages/MyPage";

export function meta() {
  return [{ title: "My Page" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export default function MyPageRoute() {
  return <MyPage />;
}
```

## Adding a Dispatch Tab

Keep custom workspace management tools in local route files, and register their
sidebar tab in `app/dispatch-extensions.tsx`:

```tsx
import { IconChartBar } from "@tabler/icons-react";
import type { DispatchExtensionConfig } from "@agent-native/dispatch/components";

export const dispatchExtensions = {
  navItems: [
    {
      id: "reports",
      to: "/reports",
      label: "Reports",
      icon: IconChartBar,
      section: "operations",
    },
  ],
  queryKeys: ["list-reports"],
} satisfies DispatchExtensionConfig;
```

Then add `app/routes/reports.tsx` and render the page with
`DispatchShell` from `@agent-native/dispatch/components`. Dispatch continues
to inherit package updates because the package still owns the layout, sidebar,
header, and built-in routes.

**Do NOT fetch data server-side** in route loaders unless the page genuinely needs SEO/OG content. The standard pattern is: SSR renders the shell, client hydrates, and React reads/writes normal app data through actions with `useActionQuery` / `useActionMutation`.

## Adding App Data

Normal app data starts as an action, not a custom route. Add `actions/<verb>-<resource>.ts` with `defineAction`, mark reads with `http: { method: "GET" }`, and call reads/writes from React with `useActionQuery` / `useActionMutation` from `@agent-native/core/client`. This keeps the UI and agent on one contract and lets mutating actions refresh action-backed queries automatically.

## Adding a Route-Only Endpoint

Use `server/routes/api/` only for protocols that cannot be modeled as JSON actions: multipart uploads, streaming/SSE/WebSocket, webhooks, OAuth callbacks/redirects, public SEO/OG endpoints, or binary/static asset serving. Do not add `/api/*` routes for normal CRUD, data queries, or pass-through wrappers around actions; the action endpoint already exists at `/_agent-native/actions/:name`.

Each route-only endpoint still exports a default `defineEventHandler`, but keep shared app logic in actions or server libraries so agent and UI behavior do not fork.

## Adding a Server Plugin

Startup logic (auth, SSE, etc.) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

## Key Imports from `@agent-native/core`

| Import                                       | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)                            |
| `createDefaultSSEHandler`                    | Create SSE endpoint for DB change events (server)                          |
| `readAppState`, `writeAppState`              | Read/write application state (from `@agent-native/core/application-state`) |
| `readSetting`, `writeSetting`                | Read/write settings (from `@agent-native/core/settings`)                   |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)                                   |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)                               |
| `agentChat`                                  | Send messages to agent from scripts (server-side)                          |

## Adding an Action

Create `actions/<verb>-<resource>.ts` with `defineAction`. Run with `pnpm action <name> --id value`; React callers should use `useActionQuery` for GET actions and `useActionMutation` for mutating actions, not a matching `/api/*` wrapper.

**Sending to agent chat from UI:**

```ts
import { sendToAgentChat } from "@agent-native/core/client";
sendToAgentChat({
  message: "Generate something",
  context: "...",
  submit: true,
});
```

**Sending to agent chat from scripts:**

```ts
import { agentChat } from "@agent-native/core";
agentChat.submit("Generate something");
```

## Database & Environment Variables

Local development defaults to a SQLite file at `data/app.db`. That local file is for development; containers, previews, and serverless deploys can reset their filesystem. For production/cloud deployment, set `DATABASE_URL` to point to a persistent SQL database. Turso is optional, not required; common choices include Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments when available.

Real credential values belong only in local `.env` files, deployment configuration, or registered secrets/settings UI. Never commit, document, log, return, paste, or include real keys, tokens, webhook URLs, signing secrets, or private data in examples; use empty values or obvious placeholders.

| Variable              | Required                        | Description                                                                |
| --------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`        | Production yes, local dev no    | Persistent SQL connection string (local dev default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | Only when the provider needs it | Auth token for providers such as Turso/libSQL                              |

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
