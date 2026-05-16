# {{APP_NAME}} — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework:** @agent-native/core + React Router v7 (framework mode)
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
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
    api/               # File-based API routes (auto-discovered)
    [...page].get.ts   # SSR catch-all (delegates to React Router)
  plugins/             # Server plugins (startup logic)
  lib/                 # Shared server modules

shared/                # Isomorphic code (imported by both client & server)

actions/               # Agent-callable scripts
  run.ts               # Script dispatcher
  *.ts                 # Individual scripts (pnpm action <name>)

data/                  # App data (SQLite DB file)

react-router.config.ts # React Router framework config
.agents/skills/        # Agent skills — detailed guidance for each rule
```

## Framework Basics

**SSR-first framework, CSR-by-default content:** This app uses React Router v7 framework mode with `ssr: true`. But virtually every route renders only an SSR shell (loading spinner + meta tags). All real data fetching and rendering happens on the client via React Query hooks. Server-side data fetching is the exception — only used for public pages that need SEO/og tags.

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

**Do NOT fetch data server-side** in route loaders unless the page genuinely needs SEO content or og tags based on dynamic data. The standard pattern is: SSR renders a loading spinner, client hydrates, React Query hooks fetch from `/api/*`.

## Adding an API Route

Create a file in `server/routes/api/`. The filename determines the URL path and HTTP method:

```
server/routes/api/items/index.get.ts    → GET  /api/items
server/routes/api/items/[id].get.ts     → GET  /api/items/:id
server/routes/api/items/[id].patch.ts   → PATCH /api/items/:id
```

Each file exports a default `defineEventHandler`.

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

## Adding a Script

Create `actions/my-script.ts` exporting `default async function(args: string[])`.
Run with: `pnpm action my-script --arg value`

**Sending to agent chat from UI:**

```ts
import { sendToAgentChat } from "@agent-native/core";
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

By default, data is stored in SQLite at `data/app.db`. For production/cloud deployment, set `DATABASE_URL` to point to a remote database (Turso, Neon, Supabase, D1).

| Variable              | Required         | Description                                                |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`        | No (has default) | Database connection string (default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | For remote DBs   | Auth token for Turso or other remote databases             |

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
