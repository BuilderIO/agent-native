# Mail — Development Guide

This guide is for development-mode agents editing this app's source code. For mail operations and tools, see AGENTS.md.

## Tech Stack

- **Framework**: `@agent-native/core`
- **Package manager**: `pnpm`
- **Frontend**: React 18, React Router 6, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **UI**: Radix UI + shadcn/ui
- **Icons**: `@tabler/icons-react` — use Tabler icons for all icons. Do not use Lucide or inline SVGs.
- **Themes**: next-themes (dark/light/system)
- **State**: SQL-backed via `@agent-native/core/settings` and `@agent-native/core/application-state`
- **Database**: SQLite (via Drizzle ORM), upgradeable to Turso/Neon/Supabase via `DATABASE_URL`

## Project Structure

```
app/
  components/
    layout/       # AppLayout, Sidebar, CommandPalette
    email/        # EmailList, EmailListItem, EmailThread, ComposeModal
    ui/           # shadcn/ui components
  hooks/          # use-emails.ts (React Query), use-keyboard-shortcuts.ts
  pages/          # InboxPage, NotFound
  lib/            # utils.ts
server/
  routes/         # File-based API routes (auto-discovered by Nitro)
  handlers/       # Route handler modules
  plugins/        # Server plugins (startup logic)
  lib/            # Shared server modules
shared/
  types.ts        # Shared TypeScript types
scripts/
  run.ts          # Script dispatcher
data/
  app.db          # SQLite database (all app data)
```

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based API routes (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (DB migrations, auth)
  lib/        # Shared server modules
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

Startup logic (DB migrations, auth) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

## Key Imports

### From `@agent-native/core`

| Import                                       | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)   |
| `createSSEHandler`                           | Create SSE endpoint for real-time updates         |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)          |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)      |
| `agentChat`                                  | Send messages to agent from scripts (server-side) |

### From `@agent-native/core/settings`

| Import                                   | Purpose                                     |
| ---------------------------------------- | ------------------------------------------- |
| `getSetting(key)` / `setSetting(key, v)` | Read/write settings from SQL settings store |

### From `@agent-native/core/application-state`

| Import                                        | Purpose                               |
| --------------------------------------------- | ------------------------------------- |
| `readAppState(key)` / `writeAppState(key, v)` | Read/write ephemeral app state in SQL |

## Build & Dev Commands

```bash
pnpm dev          # Vite dev server + Nitro plugin (single process)
pnpm build        # Single Vite build (client SPA + Nitro server)
pnpm start        # node .output/server/index.mjs (production)
pnpm typecheck    # TypeScript validation
pnpm script <name> [--args]  # Run a backend script
```

## Adding New Scripts

Create `scripts/my-script.ts` with:

```typescript
export default async function main(args: string[]): Promise<void> {
  // parse args, use readAppState/writeAppState or readSetting/writeSetting
}
```

Run with `pnpm script my-script` (auto-discovered, no registration needed).
