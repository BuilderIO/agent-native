# Getting Started

Welcome to the Agent-Native documentation!

## Installation

Create a new project:

```bash
npx @agent-native/core create my-app
```

## Project Structure

Every agent-native app follows the same convention:

```
my-app/
  client/                # React frontend
    root.tsx             # HTML shell + global providers
    entry.client.tsx     # Client hydration entry
    routes.ts            # Route config — flatRoutes()
    routes/              # File-based page routes (auto-discovered)
      _index.tsx         # / (home page)
      settings.tsx       # /settings
    components/          # UI components
    lib/utils.ts         # cn() utility
  server/                # Nitro API server
    routes/
      api/               # File-based API routes (auto-discovered)
      [...page].get.ts   # SSR catch-all (delegates to React Router)
    plugins/             # Server plugins (startup logic)
    lib/                 # Shared server modules
  shared/                # Isomorphic code (client & server)
  scripts/               # Agent-callable scripts
    run.ts               # Script dispatcher
  data/                  # App data files (watched by SSE)
  react-router.config.ts # React Router framework config
```

## Vite Configuration

A single config file handles both client SPA and server build:

```ts
// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  reactRouter: true,
});
```

`defineConfig()` sets up React Router framework mode (SSR + file-based routing), path aliases (`@/` → `client/`, `@shared/` → `shared/`), fs restrictions, and the Nitro server plugin (file-based API routing, server plugins, deploy-anywhere presets). See the [Routing docs](./routing.md) for full details on adding pages.

### Nitro options

Pass Nitro configuration via the `nitro` option:

```ts
export default defineConfig({
  nitro: {
    preset: "vercel", // Deploy target (default: "node")
  },
});
```

## TypeScript & Tailwind

```json
// tsconfig.json
{ "extends": "@agent-native/core/tsconfig.base.json" }
```

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./client/**/*.{ts,tsx}"],
} satisfies Config;
```

## Subpath Exports

| Import                                  | Exports                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/core`                    | Server: `createServer`, `createFileWatcher`, `createSSEHandler`, `mountAuthMiddleware`, `createProductionAgentHandler` · Client: `sendToAgentChat`, `useAgentChatGenerating`, `useFileWatcher`, `useProductionAgent`, `ProductionAgentPanel`, `cn` · Scripts: `runScript`, `parseArgs`, `loadEnv`, `fail`, `agentChat` |
| `@agent-native/core/router`             | React Router re-exports: `Link`, `NavLink`, `Outlet`, `useNavigate`, `useParams`, `useLoaderData`, `redirect`, `Form`, `Links`, `Meta`, `Scripts`, `ScrollRestoration`                                                                                                                                                 |
| `@agent-native/core/vite`               | `defineConfig()`                                                                                                                                                                                                                                                                                                       |
| `@agent-native/core/tailwind`           | Tailwind preset (HSL colors, shadcn/ui tokens, animations)                                                                                                                                                                                                                                                             |
| `@agent-native/core/db`                 | `createDb()` — Drizzle ORM factory (SQLite via better-sqlite3)                                                                                                                                                                                                                                                         |
| `@agent-native/core/adapters/sync`      | `createFileSync`, `FileSync`, `FileSyncAdapter` interface, `FileRecord`, `FileChange` types                                                                                                                                                                                                                            |
| `@agent-native/core/adapters/firestore` | `FirestoreFileSyncAdapter`, `threeWayMerge`, `loadSyncConfig`                                                                                                                                                                                                                                                          |
| `@agent-native/core/adapters/supabase`  | `SupabaseFileSyncAdapter`, `threeWayMerge`, `loadSyncConfig`                                                                                                                                                                                                                                                           |
| `@agent-native/core/adapters/convex`    | `ConvexFileSyncAdapter`, `threeWayMerge`, `loadSyncConfig`                                                                                                                                                                                                                                                             |

## Architecture Principles

1. **Files as database** — All app state lives in files. Both UI and agent read/write the same files.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToAgentChat()`.
3. **Scripts for agent ops** — `pnpm script <name>` dispatches to callable script files.
4. **Bidirectional SSE events** — File watcher keeps UI in sync with agent changes in real-time.
5. **Agent can update code** — The agent modifies the app itself.
6. **Application state as files** — Ephemeral UI state lives in `application-state/` as JSON. Both agent and UI can read and write these files; the SSE watcher covers this directory too.
7. **Deploy anywhere** — Nitro presets let you deploy to Node.js, Vercel, Netlify, Cloudflare, AWS Lambda, Deno, and more with a single config change.
