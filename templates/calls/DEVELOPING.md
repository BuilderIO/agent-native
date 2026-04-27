# Calls — Development Guide

This guide is for development-mode agents editing the Calls template's source code. For app operations and tools, see `AGENTS.md`.

## Tech Stack

- **Framework:** `@agent-native/core` + React Router v7 (framework mode)
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui, Tabler Icons
- **Backend:** Nitro (via `@agent-native/core`) — file-based API routing, server plugins, deploy-anywhere presets
- **DB:** Drizzle ORM — dialect-agnostic (Neon Postgres in prod, SQLite for local dev)
- **Transcription:** Deepgram Nova-3 (diarization)
- **Meeting bots:** Recall.ai (optional)
- **Zoom cloud:** Zoom OAuth (optional)

## Commands

- **Install:** `pnpm install` (run once at the framework root, pnpm workspace installs deps for all templates)
- **Dev:** `pnpm dev` (Vite dev server with React Router + Nitro plugins)
- **Build:** `pnpm build`
- **Start:** `node .output/server/index.mjs`
- **Typecheck:** `pnpm typecheck`
- **Action:** `pnpm action <name> [args]` — invoke any action in `actions/` locally

`.env` is loaded automatically — do not manually export `DATABASE_URL`, `DEEPGRAM_API_KEY`, etc. when running from this template.

## Directory Structure

```
app/                         # React frontend
  root.tsx                   # HTML shell + global providers
  routes/                    # File-based pages (auto-discovered)
    _index.tsx               # /
    call.$id.tsx             # /call/:id
    snippet.$id.tsx          # /snippet/:id
    share.$id.tsx            # /share/:id (public call)
    share-snippet.$id.tsx    # /share-snippet/:id
    embed.$id.tsx            # /embed/:id
    embed-snippet.$id.tsx    # /embed-snippet/:id
    upload.tsx               # /upload
    trackers.tsx             # /trackers
    settings.tsx             # /settings
  components/                # UI components (shadcn/ui re-exports + custom)
  hooks/                     # React hooks (use-navigation-state, use-db-sync, etc.)
  lib/                       # Utilities

server/                      # Nitro API server
  db/
    schema.ts                # Drizzle schema (SOURCE OF TRUTH for tables)
    index.ts                 # DB client + registerShareableResource() calls
  lib/                       # Server-side helpers
    calls.ts                 # getCallOrThrow, computeTalkStats, nanoid, etc.
    transcription/           # Deepgram client + speaker labeling
    summary/                 # Prompt + parser for agent-generated summaries
    trackers/                # Keyword + smart tracker runners, seed defaults
    search/                  # FTS tokenizer + LIKE query builder
  plugins/                   # Server plugins (startup logic, seeding)
  routes/
    api/                     # Custom HTTP routes (uploads, media, webhooks, oauth)
    [...page].get.ts         # SSR catch-all (delegates to React Router)

actions/                     # Agent-callable + HTTP-auto-mounted operations
shared/
  api.ts                     # Isomorphic types: CallSummary, TranscriptSegment, etc.

data/                        # App data (SQLite DB file in local dev)

react-router.config.ts       # React Router framework config
.agents/skills/              # Agent skills — the source of truth for patterns
```

## Adding an Action

Actions are the single source of truth for app operations — the agent calls them as tools, the frontend calls them as HTTP endpoints at `/_agent-native/actions/:name`. Create a file in `actions/` exporting a `defineAction` default:

```ts
// actions/my-action.ts
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "What this action does (shown to the agent as tool description)",
  schema: z.object({
    id: z.string().describe("Call ID"),
    // ...
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.id, "editor");
    const db = getDb();
    // ...mutate...
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { ok: true };
  },
});
```

Run it from the CLI: `pnpm action my-action --id=cl_abc`.

Call it from the frontend:

```ts
import { useActionMutation } from "@agent-native/core/client";
const { mutate } = useActionMutation("my-action");
mutate({ id: "cl_abc" });
```

See the framework `actions` skill for more detail.

## Adding a Page

Drop a file in `app/routes/`. The filename maps to the URL path. SSR renders a loading shell, client hydrates, React Query fetches from `/_agent-native/actions/...` via `useActionQuery`:

```tsx
// app/routes/my-page.tsx
import { useActionQuery } from "@agent-native/core/client";

export function meta() {
  return [{ title: "My Page" }];
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center h-screen">Loading…</div>
  );
}

export default function MyPage() {
  const { data } = useActionQuery("list-calls", { view: "library" });
  return <div>{data?.calls.length} calls</div>;
}
```

## Adding a Custom API Route

Only add a custom route for things actions can't do well — binary uploads, media streaming, webhooks. Drop a file in `server/routes/api/`:

```
server/routes/api/my-endpoint.post.ts  → POST /api/my-endpoint
server/routes/api/items/[id].get.ts    → GET  /api/items/:id
```

See the framework `server-plugins` skill for the full routing rules and why actions should be the first choice.

## Adding a Component

Standard UI components live in `app/components/`. Prefer shadcn/ui primitives from `app/components/ui/` — only build custom components for Calls-specific patterns (transcript viewer, waveform, snippet clipper, etc.). Tabler Icons only; no emoji icons.

## Testing End-to-End

1. `pnpm dev` — boots the server at `http://localhost:3000`.
2. Run an action: `pnpm action create-call --title="Test"` — returns `{ id, uploadChunkUrl, ... }`.
3. Use the UI at `/upload` to drag a file; chunks upload to `/api/uploads/:callId/chunk` and finalize automatically.
4. Watch the status transition `uploading` → `processing` → `transcribing` → `analyzing` → `ready` in the library.
5. Open the call page; the transcript, participants, trackers, and summary populate as the agent pipeline completes.
6. Check the agent sidebar for any pending delegations (`ai-delegation-*` keys in application state).

## Environment Variables

| Variable                   | Required          | Description                                                                        |
| -------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`             | No (has default)  | DB connection string. Default: `file:./data/app.db` (SQLite). Prod: Neon Postgres. |
| `DATABASE_AUTH_TOKEN`      | For remote DBs    | Turso / LibSQL auth token when using a remote SQLite.                              |
| `DEEPGRAM_API_KEY`         | For transcription | Deepgram API key (Nova-3 model). Without it, `request-transcript` fails.           |
| `RECALL_AI_API_KEY`        | Optional          | Enables `schedule-recall-bot` / meeting-bot capture.                               |
| `ZOOM_OAUTH_CLIENT_ID`     | Optional          | Zoom OAuth app client id for cloud-recording import.                               |
| `ZOOM_OAUTH_CLIENT_SECRET` | Optional          | Zoom OAuth app secret.                                                             |
| `ZOOM_OAUTH_REDIRECT_URI`  | Optional          | Must match the URI registered in your Zoom OAuth app.                              |
| `ACCESS_TOKEN`             | Production only   | Presence enables auth middleware. Absent in dev.                                   |
| `AUTH_SECRET`              | Production only   | Signs the session cookie.                                                          |
| `NITRO_PUBLIC_URL`         | Recommended       | Public base URL (used for webhook registration with Recall.ai / Zoom / Deepgram).  |

## Default Trackers

The first time a workspace is created, `server/lib/trackers/seed-defaults.ts` inserts a starter set of trackers: **Pricing** (keyword), **Competitors** (smart), **Objections** (smart), **Next Steps** (smart), **Budget** (smart), **Timing** (smart), **Filler words** (keyword). These are created with `isDefault=true`; users can edit, disable, or delete them from the Trackers page.

## Skills to Read

| Skill            | When                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `call-capture`   | Upload / browser recorder / bot / Zoom cloud changes                    |
| `transcription`  | Deepgram pipeline, webhook handler, segment shape                       |
| `call-summary`   | AI summary prompt + parse                                               |
| `trackers`       | Keyword + smart tracker kinds                                           |
| `snippets`       | Snippet creation and pointer-only playback                              |
| `call-sharing`   | Share dialog, password / expiry, public resolver, embed URLs            |
| `talk-analytics` | Participant materialization, talk-time / interruption / question counts |
| `call-search`    | FTS tokenizer and query building                                        |

Framework-wide skills (`actions`, `storing-data`, `real-time-sync`, `delegate-to-agent`, `sharing`, `portability`, `server-plugins`, `authentication`, `security`, `frontend-design`) are symlinked into `.agents/skills/` via `agent-native setup-agents`.


## Tools (Framework Feature)

The framework provides **Tools** — mini sandboxed Alpine.js apps that run inside iframes. Tools let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under a "Tools" section.

- **Creating tools**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/tools`
- **API calls**: Tools use `toolFetch()` which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Tools inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `tools` skill in `.agents/skills/tools/SKILL.md` for full implementation details.
