# Videos — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **PNPM**: Prefer pnpm
- **Frontend**: React 18 + React Router 6 (spa) + TypeScript + Vite + TailwindCSS 3
- **Backend**: Nitro (via @agent-native/core) — file-based API routing
- **Testing**: Vitest
- **UI**: Radix UI + TailwindCSS 3 + Lucide React icons
- **Video**: Remotion for programmatic video compositions

## Project Structure

```
app/                      # React SPA frontend
├── pages/                # Route components (Index.tsx = home)
├── components/ui/        # Pre-built UI component library
├── remotion/             # Remotion compositions, registry, helpers
│   ├── registry.ts       # Single source of truth for all compositions
│   ├── trackAnimation.ts # Pure helpers: trackProgress(), getPropValue(), findTrack()
│   ├── compositions/     # Individual Remotion composition components
│   └── hooks/            # Interactive composition helpers
├── root.tsx              # HTML shell + global providers setup
└── global.css            # TailwindCSS 3 theming and global styles

server/                   # Nitro API server
├── routes/               # File-based API routes (auto-discovered by Nitro)
├── plugins/              # Server plugins (startup logic)
└── lib/                  # Shared server modules

shared/                   # Types used by both client & server
└── api.ts                # Shared API interfaces
```

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based API routes (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (auth, SSE, etc.)
  lib/        # Shared server modules (watcher instance, helpers)
```

### Adding an API Route

Create a file in `server/routes/api/`. The filename determines the URL path and HTTP method:

```
server/routes/api/items/index.get.ts    → GET  /api/items
server/routes/api/items/index.post.ts   → POST /api/items
server/routes/api/items/[id].get.ts     → GET  /api/items/:id
server/routes/api/items/[id].patch.ts   → PATCH /api/items/:id
```

Each file exports a default `defineEventHandler`:

```ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return { ok: true };
});
```

### Server Plugins

Startup logic (auth, SSE, etc.) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

### Key Imports from `@agent-native/core`

| Import                                       | Purpose                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)                            |
| `createDefaultSSEHandler`                    | Create SSE endpoint for DB change events (server)                          |
| `readAppState`, `writeAppState`              | Read/write application state (from `@agent-native/core/application-state`) |
| `readSetting`, `writeSetting`                | Read/write settings (from `@agent-native/core/settings`)                   |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)                                   |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)                               |
| `agentChat`                                  | Send messages to agent from scripts (server-side)                          |

## Routing System

The routing system uses React Router v7 framework mode with file-based routing:

- Routes are auto-discovered from `app/routes/` via `flatRoutes()`.
- `app/routes/_index.tsx` is the home page (`/`).
- Create a file to add a route (e.g. `app/routes/settings.tsx` → `/settings`).
- Dynamic params use `$` prefix (e.g. `app/routes/c.$compositionId.tsx` → `/c/:compositionId`).

### Styling System

- **Primary**: TailwindCSS 3 utility classes
- **Theme and design tokens**: Configure in `app/global.css`
- **UI components**: Pre-built library in `app/components/ui/`
- **Utility**: `cn()` combines `clsx` + `tailwind-merge` for conditional classes

### Path Aliases

- `@shared/*` — Shared folder
- `@/*` — Client folder

### Database (Cloud Deployment)

By default, data is stored in SQLite at `data/app.db`. For production/cloud deployment, set `DATABASE_URL` to point to a remote database (Turso, Neon, Supabase, D1).

**Environment variables:**

| Variable              | Required         | Description                                                |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`        | No (has default) | Database connection string (default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | For remote DBs   | Auth token for Turso or other remote databases             |

## Build & Dev Commands

```bash
pnpm dev        # Start dev server (client + server)
pnpm build      # Production build
pnpm start      # Start production server
pnpm typecheck  # TypeScript validation
pnpm test       # Run Vitest tests
```

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
