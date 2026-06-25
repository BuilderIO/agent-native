# {{APP_NAME}} — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Framework Basics

**Client-side-first rendering:** This app uses React Router v8 framework mode with `ssr: true`, but all app content renders **client-side only**. The server renders only the HTML shell (meta tags, styles, scripts) plus a loading spinner. This is enforced by the `ClientOnly` wrapper in `root.tsx` — never remove it. Browser APIs (`window`, `localStorage`, `new Date()`) are safe to use anywhere in app code because components never run on the server.

**Do NOT fetch data server-side** in route loaders unless the page genuinely needs SEO/OG content. The standard pattern is: SSR renders the shell, client hydrates, and React reads/writes normal app data through actions with `useActionQuery` / `useActionMutation`.

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

Use `<Link to="/review">` and `navigate("/review")` inside this app. Do not prefix React Router paths with `/<app-id>` or the URL can double-prefix, e.g. `/<app-id>/<app-id>/review`. Use `appPath()` for raw `href`s/static assets, `agentNativePath()` for `/_agent-native/*`, and `appApiPath()` only for legitimate route-only `/api/*` endpoints.

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

## Adding App Data

Normal app data starts as an action, not a custom route. Add `actions/<verb>-<resource>.ts` with `defineAction`, mark reads with `http: { method: "GET" }`, and call reads/writes from React with `useActionQuery` / `useActionMutation` from `@agent-native/core/client`. This keeps the UI and agent on one contract and lets mutating actions refresh action-backed queries automatically.

## Adding a Route-Only Endpoint

Use `server/routes/api/` only for protocols that cannot be modeled as JSON actions: multipart uploads, streaming/SSE/WebSocket, webhooks, OAuth callbacks/redirects, public SEO/OG endpoints, or binary/static asset serving. Do not add `/api/*` routes for normal CRUD, data queries, or pass-through wrappers around actions; the action endpoint already exists at `/_agent-native/actions/:name`.

Each route-only endpoint still exports a default `defineEventHandler`, but keep shared app logic in actions or server libraries so agent and UI behavior do not fork.

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

## Adding an Action

Create `actions/<verb>-<resource>.ts` with `defineAction`. Run with `pnpm action <name> --id value`; React callers should use `useActionQuery` for GET actions and `useActionMutation` for mutating actions, not a matching `/api/*` wrapper.

## Sending to Agent Chat

**From UI:**

```ts
import { sendToAgentChat } from "@agent-native/core/client";
sendToAgentChat({
  message: "Generate something",
  context: "...",
  submit: true,
});
```

For most UI handoffs, pass hidden context directly with `sendToAgentChat()`. Use
`submit: false` when the user should review the draft first. Use
`newTab: true, background: true, openSidebar: false` when a button should start
a full agent run without opening or focusing the sidebar. Use
`useAgentChatContext`, `setAgentChatContextItem`, `listAgentChatContext`,
`removeAgentChatContextItem`, and `clearAgentChatContext` only for advanced UI
that needs to read, mirror, stage, remove, or clear staged context chips as local
interface state.

**From scripts:**

```ts
import { agentChat } from "@agent-native/core";
agentChat.submit("Generate something");
```

**Server-side one-shot text transforms:**

```ts
import { completeText } from "@agent-native/core/server";

const result = await completeText({
  systemPrompt: "Return exactly one category label.",
  input: body,
  maxOutputTokens: 16,
  temperature: 0,
});
```

Use this only for narrow transforms that intentionally need no tools, chat
history, or run state. For user-facing operations, call it inside an action so
the UI and agent share the same capability.

## Database

Local development defaults to a SQLite file at `data/app.db`. If you want local development to use the Postgres dialect without running a database server, install `@electric-sql/pglite` and set `DATABASE_URL=pglite:./data/pglite`. Both local SQLite and local PGlite are for development; containers, previews, and serverless deploys can reset their filesystem. For production/cloud deployment, set `DATABASE_URL` to point to a persistent SQL database. Turso is optional, not required; common choices include Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments when available.

Real credential values belong only in local `.env` files, deployment configuration, or registered secrets/settings UI. Never commit, document, log, return, paste, or include real keys, tokens, webhook URLs, signing secrets, or private data in examples; use empty values or obvious placeholders.

When adding app data, define tables with `@agent-native/core/db/schema` helpers and use Drizzle's query builder for reads/writes. Do not import dialect-specific schema helpers from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core`, and do not write raw SQL in normal actions or handlers when Drizzle can express the query. Raw SQL belongs in additive migrations, health checks, or carefully scoped maintenance.

| Variable              | Required                        | Description                                                                                                               |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Production yes, local dev no    | Persistent SQL connection string (local dev default: `file:./data/app.db`; local Postgres opt-in: `pglite:./data/pglite`) |
| `DATABASE_AUTH_TOKEN` | Only when the provider needs it | Auth token for providers such as Turso/libSQL                                                                             |

## Tech Stack

- **Framework:** @agent-native/core + React Router v8 (framework mode)
- **Frontend:** React 19, Vite, TailwindCSS, shadcn/ui
- **Routing:** File-based via `flatRoutes()` — SSR shell + client rendering
- **Backend:** Nitro (via @agent-native/core) — file-based API routing, server plugins, deploy-anywhere presets
- **State:** SQL-backed (SSE for real-time updates)
- **Build:** `pnpm build` (React Router build — client + SSR + Nitro server)
- **Dev:** `pnpm dev` (Vite dev server with both React Router + Nitro plugins)
- **Start:** `node .output/server/index.mjs` (production)
