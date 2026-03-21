# Brand Asset Manager — Agent Guide

## Overview

This app manages brand assets and generates on-brand images using Gemini. The agent's role is to analyze brand references, build style profiles, and generate images that match the brand's visual style.

## Agent Skills

See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

---

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based API routes (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (file watcher, file sync, auth)
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

Startup logic (file watcher, file sync, auth) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

### Key Imports from `@agent-native/core`

| Import                                       | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)   |
| `createFileWatcher`                          | Watch data directory for changes                  |
| `createSSEHandler`                           | Create SSE endpoint for real-time updates         |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)          |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)      |
| `agentChat`                                  | Send messages to agent from scripts (server-side) |

### Build & Dev Commands

```bash
pnpm dev        # Vite dev server + Nitro plugin (single process)
pnpm build      # Single Vite build (client SPA + Nitro server)
pnpm start      # node .output/server/index.mjs (production)
pnpm typecheck  # TypeScript validation
```

---

### File Sync (Multi-User Collaboration)

File sync is **opt-in** — enabled when `FILE_SYNC_ENABLED=true` is set in `.env`.

**Environment variables:**

| Variable                         | Required      | Description                                          |
| -------------------------------- | ------------- | ---------------------------------------------------- |
| `FILE_SYNC_ENABLED`              | No            | Set to `"true"` to enable sync                       |
| `FILE_SYNC_BACKEND`              | When enabled  | `"firestore"`, `"supabase"`, or `"convex"`           |
| `SUPABASE_URL`                   | For Supabase  | Project URL                                          |
| `SUPABASE_PUBLISHABLE_KEY`       | For Supabase  | Publishable key (or legacy `SUPABASE_ANON_KEY`)      |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore | Path to service account JSON                         |
| `CONVEX_URL`                     | For Convex    | Deployment URL from `npx convex dev` (must be HTTPS) |

**How sync works:**

- `createFileSync()` factory reads env vars and initializes sync
- Files matching `sync-config.json` patterns are synced to/from the database
- Sync events flow through SSE (`source: "sync"`) alongside file change events
- Conflicts produce `.conflict` sidecar files and notify the agent

**Checking sync status:**

- Read `data/.sync-status.json` for current sync state
- Read `data/.sync-failures.json` for permanently failed sync operations

**Handling conflicts:**

- When `application-state/sync-conflict.json` appears, resolve the conflict
- Read the `.conflict` file alongside the original to understand both versions
- Edit the original file to resolve, then delete the `.conflict` file

**Scratch files (not synced):**

- Prefix temporary files with `_tmp-` to exclude from sync

## Architecture

Files are the database. All state lives in `data/`:

- `data/brand/config.json` — Brand identity (name, colors, fonts)
- `data/brand/style-profile.json` — Agent-generated style analysis
- `data/brand/logos/` — Uploaded logo files
- `data/brand/references/` — Style reference images
- `data/generations/{id}.json` — Generation records
- `data/generations/{id}_N.png` — Generated images
- `data/settings.json` — Default generation settings

## Scripts

Run scripts with `pnpm script <name>`:

### analyze-brand

Analyzes all reference images and generates a style profile.

```bash
pnpm script analyze-brand
```

### generate-images

Generates on-brand image variations from a prompt.

```bash
pnpm script generate-images --prompt "A team meeting" --variations 4 --model gemini-3-pro-image-preview
```

Optional: `--references file1.png,file2.png`

## Key Workflows

### When user uploads new reference images

1. Acknowledge the upload
2. Run `pnpm script analyze-brand` to update the style profile
3. Report the updated style analysis

### When user asks to generate images

1. Run `pnpm script generate-images` with the user's prompt and preferences
2. Report results and offer to adjust

### When user edits brand config

The UI handles config changes directly via API. No agent action needed unless the user asks for suggestions.

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Environment

- `GEMINI_API_KEY` — Required for style analysis and image generation
