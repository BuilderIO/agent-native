# {{APP_NAME}} — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Framework Basics

**Client-side-first rendering:** This app uses React Router v7 framework mode with `ssr: true`, but all app content renders **client-side only**. The server renders only the HTML shell (meta tags, styles, scripts) plus a loading spinner. This is enforced by the `ClientOnly` wrapper in `root.tsx` — never remove it. Browser APIs (`window`, `localStorage`, `new Date()`) are safe to use anywhere in app code because components never run on the server.

**Do NOT fetch data server-side** in route loaders. The standard pattern is: server renders a spinner, client hydrates, React Query hooks fetch from `/api/*`.

## Adding a Page

Create a file in `app/routes/`. The filename determines the URL path:

```
app/routes/_index.tsx              → /
app/routes/settings.tsx            → /settings
app/routes/inbox.tsx               → /inbox
app/routes/inbox.$threadId.tsx     → /inbox/:threadId
app/routes/$id.tsx                 → /:id (dynamic param)
```

## Mounted Workspace Routing

In a workspace, this app can be mounted under `/<app-id>`. React Router already receives `APP_BASE_PATH`/`VITE_APP_BASE_PATH` through `appBasePath()`, so route code stays app-local:

| Route file              | App-internal route | Mounted browser URL |
| ----------------------- | ------------------ | ------------------- |
| `app/routes/_index.tsx` | `/`                | `/<app-id>`         |
| `app/routes/review.tsx` | `/review`          | `/<app-id>/review`  |
| `app/routes/$id.tsx`    | `/:id`             | `/<app-id>/:id`     |

Use `<Link to="/review">` and `navigate("/review")` inside this app. Do not prefix React Router paths with `/<app-id>` or the URL can double-prefix, e.g. `/<app-id>/<app-id>/review`. Use `appPath()` for raw `href`s/static assets, `appApiPath()` for `/api/*`, and `agentNativePath()` for `/_agent-native/*`.

Each route file exports a default component and optional `meta()`:

```tsx
import MyPage from "@/pages/MyPage";

export function meta() {
  return [{ title: "My Page" }];
}

export default function MyPageRoute() {
  return <MyPage />;
}
```

## Adding an API Route

Create a file in `server/routes/api/`. The filename determines the URL path and HTTP method:

```
server/routes/api/items/index.get.ts    → GET  /api/items
server/routes/api/items/[id].get.ts     → GET  /api/items/:id
server/routes/api/items/[id].patch.ts   → PATCH /api/items/:id
```

Each file exports a default `defineEventHandler`.

## Server Plugins

Startup logic (auth, SSE, etc.) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

## Key Imports

| Import                                       | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)                            |
| `createDefaultSSEHandler`                    | Create SSE endpoint for DB change events (server)                          |
| `readAppState`, `writeAppState`              | Read/write application state (from `@agent-native/core/application-state`) |
| `readSetting`, `writeSetting`                | Read/write settings (from `@agent-native/core/settings`)                   |
| `readResource`, `writeResource`              | Read/write resources (from `@agent-native/core/resources`)                 |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)                                   |
| `sendToAgentChat`                            | Send or prefill messages in the agent chat from UI (client-side)           |
| Agent chat context state helpers             | Optional advanced helpers for two-way sync with staged context chips       |
| `agentChat`                                  | Send messages to agent from scripts (server-side)                          |

## Adding a Script

Create `actions/my-script.ts` exporting `default async function(args: string[])`.
Run with: `pnpm action my-script --arg value`

## Sending to Agent Chat

**From UI:**

```ts
import { sendToAgentChat } from "@agent-native/core";
sendToAgentChat({
  message: "Generate something",
  context: "...",
  submit: true,
});
```

For most UI handoffs, pass hidden context directly with `sendToAgentChat()`. Use
`submit: false` when the user should review the draft first. Use
`useAgentChatContext`, `setAgentChatContextItem`, `listAgentChatContext`,
`removeAgentChatContextItem`, and `clearAgentChatContext` only for advanced UI
that needs to read, mirror, stage, remove, or clear staged context chips as local
interface state.

**From scripts:**

```ts
import { agentChat } from "@agent-native/core";
agentChat.submit("Generate something");
```

## Database

Local development defaults to a SQLite file at `data/app.db`. That local file is for development; containers, previews, and serverless deploys can reset their filesystem. For production/cloud deployment, set `DATABASE_URL` to point to a persistent SQL database. Turso is optional, not required; common choices include Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments when available.

When adding app data, define tables with `@agent-native/core/db/schema` helpers and use Drizzle's query builder for reads/writes. Do not import dialect-specific schema helpers from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core`, and do not write raw SQL in normal actions or handlers when Drizzle can express the query. Raw SQL belongs in additive migrations, health checks, or carefully scoped maintenance.

| Variable              | Required                        | Description                                                                |
| --------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`        | Production yes, local dev no    | Persistent SQL connection string (local dev default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | Only when the provider needs it | Auth token for providers such as Turso/libSQL                              |

## Tech Stack

- **Framework:** @agent-native/core + React Router v7 (framework mode)
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
- **Routing:** File-based via `flatRoutes()` — SSR shell + client rendering
- **Backend:** Nitro (via @agent-native/core) — file-based API routing, server plugins, deploy-anywhere presets
- **State:** SQL-backed (SSE for real-time updates)
- **Build:** `pnpm build` (React Router build — client + SSR + Nitro server)
- **Dev:** `pnpm dev` (Vite dev server with both React Router + Nitro plugins)
- **Start:** `node .output/server/index.mjs` (production)
