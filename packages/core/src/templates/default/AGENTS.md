# {{APP_NAME}} — Agent-Native App

## Architecture

This is an **@agent-native/core** application — the AI agent and UI share state through a SQL database, with SSE for real-time sync.

### Core Principles

1. **Shared SQL database** — All app state lives in SQL (SQLite locally, cloud DB via `DATABASE_URL` in production). Core stores: `application_state`, `settings`, `oauth_tokens`, `sessions`.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToAgentChat()` / `agentChat.submit()`.
3. **Scripts for agent operations** — `pnpm script <name>` dispatches to callable script files in `scripts/`.
4. **SSE for real-time sync** — Database writes emit events that keep the UI in sync automatically.
5. **Agent can update code** — The agent can modify this app's source code directly.

### Authentication

Auth is automatic and environment-driven. The `server/plugins/auth.ts` plugin calls `autoMountAuth(app)` at startup.

- **Dev mode**: Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`. Zero friction.
- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts. Login page for unauthenticated visitors.
- **Production** (no token, no `AUTH_DISABLED=true`): Server refuses to start.

Use `getSession(event)` server-side and `useSession()` client-side. See [docs/auth.md](docs/auth.md).

### Directory Structure

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

scripts/               # Agent-callable scripts
  run.ts               # Script dispatcher
  *.ts                 # Individual scripts (pnpm script <name>)

data/                  # App data (SQLite DB file)

react-router.config.ts # React Router framework config
.agents/skills/        # Agent skills — detailed guidance for each rule
```

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

---

Skills in `.agents/skills/` provide detailed guidance for each architectural rule. Read them before making changes.

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `scripts`             | Before creating or modifying scripts                           |
| `real-time-sync`      | Before wiring up real-time UI sync                             |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) enforces distinctive, production-grade aesthetics — committing to a clear visual direction and avoiding generic patterns like purple gradients, overused fonts, and cookie-cutter layouts.

### Framework Basics

**Client-side-first rendering:** This app uses React Router v7 framework mode with `ssr: true`, but all app content renders **client-side only**. The server renders only the HTML shell (meta tags, styles, scripts) plus a loading spinner. This is enforced by the `ClientOnly` wrapper in `root.tsx` — never remove it. Browser APIs (`window`, `localStorage`, `new Date()`) are safe to use anywhere in app code because components never run on the server.

**Do NOT fetch data server-side** in route loaders. The standard pattern is: server renders a spinner, client hydrates, React Query hooks fetch from `/api/*`.

**Adding a page:**
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

### Key Patterns

**Adding an API route:**
Create a file in `server/routes/api/`. The filename determines the URL path and HTTP method:

```
server/routes/api/items/index.get.ts    → GET  /api/items
server/routes/api/items/[id].get.ts     → GET  /api/items/:id
server/routes/api/items/[id].patch.ts   → PATCH /api/items/:id
```

Each file exports a default `defineEventHandler`.

**Adding a server plugin:**
Startup logic (auth, SSE, etc.) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

**Key imports from `@agent-native/core`:**

| Import                                       | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)                            |
| `createDefaultSSEHandler`                    | Create SSE endpoint for DB change events (server)                          |
| `readAppState`, `writeAppState`              | Read/write application state (from `@agent-native/core/application-state`) |
| `readSetting`, `writeSetting`                | Read/write settings (from `@agent-native/core/settings`)                   |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)                                   |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)                               |
| `agentChat`                                  | Send messages to agent from scripts (server-side)                          |

**Adding a script:**
Create `scripts/my-script.ts` exporting `default async function(args: string[])`.
Run with: `pnpm script my-script --arg value`

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

### Database (Cloud Deployment)

By default, data is stored in SQLite at `data/app.db`. For production/cloud deployment, set `DATABASE_URL` to point to a remote database (Turso, Neon, Supabase, D1).

**Environment variables:**

| Variable              | Required         | Description                                                |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`        | No (has default) | Database connection string (default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | For remote DBs   | Auth token for Turso or other remote databases             |

### Tech Stack

- **Framework:** @agent-native/core + React Router v7 (framework mode)
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
- **Routing:** File-based via `flatRoutes()` — SSR shell + client rendering
- **Backend:** Nitro (via @agent-native/core) — file-based API routing, server plugins, deploy-anywhere presets
- **State:** SQL-backed (SSE for real-time updates)
- **Build:** `pnpm build` (React Router build — client + SSR + Nitro server)
- **Dev:** `pnpm dev` (Vite dev server with both React Router + Nitro plugins)
- **Start:** `node .output/server/index.mjs` (production)
