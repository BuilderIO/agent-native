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
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)                               |
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

**From scripts:**

```ts
import { agentChat } from "@agent-native/core";
agentChat.submit("Generate something");
```

## Database

By default, data is stored in SQLite at `data/app.db`. For production/cloud deployment, set `DATABASE_URL` to point to a remote database (Turso, Neon, Supabase, D1).

| Variable              | Required         | Description                                                |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`        | No (has default) | Database connection string (default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | For remote DBs   | Auth token for Turso or other remote databases             |

## Tech Stack

- **Framework:** @agent-native/core + React Router v7 (framework mode)
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
- **Routing:** File-based via `flatRoutes()` — SSR shell + client rendering
- **Backend:** Nitro (via @agent-native/core) — file-based API routing, server plugins, deploy-anywhere presets
- **State:** SQL-backed (SSE for real-time updates)
- **Build:** `pnpm build` (React Router build — client + SSR + Nitro server)
- **Dev:** `pnpm dev` (Vite dev server with both React Router + Nitro plugins)
- **Start:** `node .output/server/index.mjs` (production)
