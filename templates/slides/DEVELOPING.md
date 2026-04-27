# Deck Generator — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 18, React Router 6, TypeScript, Vite, TailwindCSS 3
- **Backend**: Nitro (via @agent-native/core) — file-based API routing
- **UI components**: Radix UI primitives + Lucide icons
- **Image generation**: Google Gemini via `@google/genai`
- **State**: SQL-backed via `/api/decks`, in-memory undo/redo, share tokens
- **Logo lookup**: Logo.dev API (free tier with token) or Google Image Search fallback
- **Path aliases**: `@/*` → app/, `@shared/*` → shared/

## Project Structure

```
app/                           # React SPA frontend
├── pages/                     # Route components
│   ├── DeckEditor.tsx         # Main editor page
│   ├── DeckList.tsx           # Deck listing / home
│   └── PresentView.tsx        # Presentation mode
├── components/
│   ├── editor/                # Editor UI components
│   │   ├── EditorToolbar.tsx  # Main toolbar (layout, bg, image, undo/redo)
│   │   ├── EditorSidebar.tsx  # Slide list with drag-and-drop
│   │   ├── SlideEditor.tsx    # Slide preview / code editor
│   │   ├── ImageGenPanel.tsx  # Image gen dialog (delegates to agent chat)
│   │   ├── HistoryPanel.tsx   # Undo/redo history popover
│   │   └── ShareDialog.tsx    # Share link dialog
│   ├── deck/
│   │   └── SlideRenderer.tsx  # Core 960x540 slide rendering
│   └── ui/                    # Reusable UI primitives (Radix-based)
├── data/                      # Shared data types and utilities
├── context/
│   └── DeckContext.tsx        # Central state: decks, slides, undo/redo (fetches from /api/decks)
├── lib/
│   └── utils.ts               # cn() utility
└── root.tsx               # HTML shell + global providers

server/                        # Nitro API server
├── routes/                    # File-based API routes (auto-discovered by Nitro)
├── handlers/                  # Route handler modules
│   ├── decks.ts               # GET/PUT/POST/DELETE /api/decks (file-based CRUD)
│   ├── image-gen.ts           # POST /api/image-gen/generate (Gemini)
│   ├── generate-slides.ts     # POST /api/generate-slides (Gemini)
│   └── share.ts               # POST /api/share, GET /api/share/:token
├── plugins/                   # Server plugins (startup logic)
└── lib/                       # Shared server modules

data/                          # App data (SQLite DB file)

shared/                        # Shared between client + server + scripts
└── api.ts                     # Types, interfaces, DEFAULT_STYLE_REFERENCE_URLS

actions/                       # Runnable via `pnpm action <name>`
├── run.ts                     # Script dispatcher
├── generate-image.ts          # Image generation with style references
├── image-gen-status.ts        # Check API key status
├── image-search.ts            # Google Image search
└── logo-lookup.ts             # Clearbit logo URL lookup
```

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

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

### Database (Cloud Deployment)

By default, data is stored in SQLite at `data/app.db`. For production/cloud deployment, set `DATABASE_URL` to point to a remote database (Turso, Neon, Supabase, D1).

**Environment variables:**

| Variable              | Required         | Description                                                |
| --------------------- | ---------------- | ---------------------------------------------------------- |
| `DATABASE_URL`        | No (has default) | Database connection string (default: `file:./data/app.db`) |
| `DATABASE_AUTH_TOKEN` | For remote DBs   | Auth token for Turso or other remote databases             |

## Build & Dev Commands

```bash
pnpm dev          # Start dev server (client + server on port 8080)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm action <name> [--args]  # Run a backend script
```

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Tools (Framework Feature)

The framework provides **Tools** — mini sandboxed Alpine.js apps that run inside iframes. Tools let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under a "Tools" section.

- **Creating tools**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/tools`
- **API calls**: Tools use `toolFetch()` which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Tools inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `tools` skill in `.agents/skills/tools/SKILL.md` for full implementation details.
