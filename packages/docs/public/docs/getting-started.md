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
  client/          # React frontend (Vite SPA)
    App.tsx        # Entry point
    components/    # UI components
    lib/utils.ts   # cn() utility
  server/          # Express backend
    index.ts       # createAppServer()
    node-build.ts  # Production entry point
  shared/          # Isomorphic code (client & server)
  scripts/         # Agent-callable scripts
    run.ts         # Script dispatcher
  data/            # App data files (watched by SSE)
```

## Vite Configuration

Two config files — client SPA and server build:

```ts
// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();
```

```ts
// vite.config.server.ts
import { defineServerConfig } from "@agent-native/core/vite";
export default defineServerConfig();
```

`defineConfig()` sets up React SWC, path aliases (`@/` -> `client/`, `@shared/` -> `shared/`), fs restrictions, and the Express dev plugin.

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

| Import | Exports |
|--------|---------|
| `@agent-native/core` | Server, client, scripts: createServer, createFileWatcher, createSSEHandler, createProductionServer, runScript, parseArgs, loadEnv, fail, agentChat, sendToAgentChat, useAgentChatGenerating, useFileWatcher, cn |
| `@agent-native/core/vite` | defineConfig(), defineServerConfig() |
| `@agent-native/core/tailwind` | Tailwind preset (HSL colors, shadcn/ui tokens, animations) |
| `@agent-native/core/adapters/sync` | FileSyncAdapter interface, FileRecord, FileChange types |
| `@agent-native/core/adapters/firestore` | FirestoreFileSyncAdapter, FileSync, threeWayMerge, loadSyncConfig |
| `@agent-native/core/adapters/supabase` | SupabaseFileSyncAdapter, FileSync, threeWayMerge, loadSyncConfig |
| `@agent-native/core/adapters/neon` | NeonFileSyncAdapter, FileSync, threeWayMerge, loadSyncConfig |

## Architecture Principles

1. **Files as database** — All app state lives in files. Both UI and agent read/write the same files.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToAgentChat()`.
3. **Scripts for agent ops** — `pnpm script <name>` dispatches to callable script files.
4. **Bidirectional SSE events** — File watcher keeps UI in sync with agent changes in real-time.
5. **Agent can update code** — The agent modifies the app itself.
