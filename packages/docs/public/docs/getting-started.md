# Getting Started

The fastest way to get started is to pick a template and customize it. Templates are complete, production-ready apps — not starter kits. You get a working app in under a minute and start making it yours.

## Create Your App

```bash
npx @agent-native/core create my-app
```

The CLI walks you through picking a template — Mail, Calendar, Content, Slides, Video, Analytics, and more — or starting blank. Then run it:

```bash
cd my-app
pnpm install
pnpm dev
```

That's it — you have a full app running locally with an AI agent built in. Open the agent panel, ask it to do something, and watch it work.

From here, use your AI coding tool (Claude Code, Cursor, Windsurf, etc.) to customize it. The agent instructions in `AGENTS.md` are already set up so any tool understands the codebase.

Browse the [template gallery](https://agent-native.com/templates) for live demos and detailed feature lists.

## Project Structure

Every agent-native app — whether from a template or from scratch — follows the same structure:

```
my-app/
  app/             # React frontend (routes, components, hooks)
  server/          # Nitro API server (routes, plugins)
  actions/         # Agent-callable actions
  .agents/         # Agent instructions and skills
```

Templates add domain-specific code on top of this: database schemas in `server/db/`, API routes in `server/routes/api/`, and actions in `actions/`.

## Configuration

Templates come pre-configured. If you're starting from scratch, here are the config files:

```ts
// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();
```

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
  content: ["./app/**/*.{ts,tsx}"],
} satisfies Config;
```

## Subpath Exports

| Import                                  | Exports                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-native/core`                    | Server: `createServer`, `createSSEHandler`, `mountAuthMiddleware`, `createProductionAgentHandler` · Client: `sendToAgentChat`, `useAgentChatGenerating`, `useDbSync`, `useProductionAgent`, `ProductionAgentPanel`, `cn` · Scripts: `runScript`, `parseArgs`, `loadEnv`, `fail`, `agentChat` |
| `@agent-native/core/router`             | React Router re-exports: `Link`, `NavLink`, `Outlet`, `useNavigate`, `useParams`, `useLoaderData`, `redirect`, `Form`, `Links`, `Meta`, `Scripts`, `ScrollRestoration`                                                                                                                       |
| `@agent-native/core/vite`               | `defineConfig()`                                                                                                                                                                                                                                                                             |
| `@agent-native/core/tailwind`           | Tailwind preset (HSL colors, shadcn/ui tokens, animations)                                                                                                                                                                                                                                   |
| `@agent-native/core/db`                 | `getDb()` — Drizzle ORM factory (SQLite via @libsql/client, local or cloud via `DATABASE_URL`)                                                                                                                                                                                               |
| `@agent-native/core/adapters/sync`      | `createFileSync`, `FileSync`, `FileSyncAdapter` interface, `FileRecord`, `FileChange` types                                                                                                                                                                                                  |
| `@agent-native/core/adapters/firestore` | `FirestoreFileSyncAdapter`, `threeWayMerge`, `loadSyncConfig`                                                                                                                                                                                                                                |
| `@agent-native/core/adapters/supabase`  | `SupabaseFileSyncAdapter`, `threeWayMerge`, `loadSyncConfig`                                                                                                                                                                                                                                 |
| `@agent-native/core/adapters/convex`    | `ConvexFileSyncAdapter`, `threeWayMerge`, `loadSyncConfig`                                                                                                                                                                                                                                   |

## Architecture Principles

These principles apply to all agent-native apps. Understanding them helps you customize templates or build from scratch:

1. **Data lives in SQL** — All app state lives in a SQL database via Drizzle ORM. The agent and UI read/write the same tables.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToAgentChat()`.
3. **Actions for agent ops** — Agent-callable actions in `actions/` let the agent do anything the UI can do.
4. **Real-time sync** — Database changes sync to the UI via polling. When the agent writes data, the UI updates automatically.
5. **Agent can update code** — The agent modifies the app itself — components, routes, styles, actions.
6. **Deploy anywhere** — Nitro presets let you deploy to Node.js, Vercel, Netlify, Cloudflare, AWS Lambda, Deno, and more with a single config change.
