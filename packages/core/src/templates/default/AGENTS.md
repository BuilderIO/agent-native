# {{APP_NAME}} — Agent-Native App

## Architecture

This is an **@agent-native/core** application — the AI agent and UI share state through files, not a traditional database.

### Core Principles

1. **Files as database** — All app state lives in files. Both UI and agent read/write the same files.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToAgentChat()` / `agentChat.submit()`.
3. **Scripts for agent operations** — `pnpm script <name>` dispatches to callable script files in `scripts/`.
4. **Bidirectional SSE events** — The file watcher keeps the UI in sync when the agent modifies files.
5. **Agent can update code** — The agent can modify this app's source code directly.

### Directory Structure

```
client/          # React frontend (Vite SPA)
  App.tsx        # Entry point
  components/    # UI components
  hooks/         # React hooks
  lib/           # Utilities (cn, etc)

server/          # Express backend
  index.ts       # createAppServer() — routes + middleware
  node-build.ts  # Production entry point

shared/          # Isomorphic code (imported by both client & server)

scripts/         # Agent-callable scripts
  run.ts         # Script dispatcher
  *.ts           # Individual scripts (pnpm script <name>)

data/            # App data files (watched by SSE)

.agents/skills/  # Agent skills — detailed guidance for each rule
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
| `files-as-database`   | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `scripts`             | Before creating or modifying scripts                           |
| `sse-file-watcher`    | Before wiring up real-time UI sync                             |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) enforces distinctive, production-grade aesthetics — committing to a clear visual direction and avoiding generic patterns like purple gradients, overused fonts, and cookie-cutter layouts.

### Key Patterns

**Adding an API route:**
Edit `server/index.ts`, add your route to `createAppServer()`.

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

### File Sync (Multi-User Collaboration)

File sync is **opt-in** — enabled when `FILE_SYNC_ENABLED=true` is set in `.env`.

**Environment variables:**

| Variable                         | Required            | Description                            |
| -------------------------------- | ------------------- | -------------------------------------- |
| `FILE_SYNC_ENABLED`              | No                  | Set to `"true"` to enable sync         |
| `FILE_SYNC_BACKEND`              | When enabled        | `"firestore"` or `"supabase"`          |
| `FILE_SYNC_SUPABASE_KEY_TYPE`    | For Supabase        | `"anon"` (default) or `"service_role"` |
| `SUPABASE_URL`                   | For Supabase        | Project URL                            |
| `SUPABASE_ANON_KEY`              | For Supabase (anon) | Anon key                               |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore       | Path to service account JSON           |

**How sync works:**

- `createFileSync()` factory in `server/index.ts` reads env vars and initializes sync
- Files matching `sync-config.json` patterns are synced to/from the remote database
- Sync events flow through SSE (`source: "sync"`) alongside file change events
- Conflicts produce `.conflict` sidecar files and notify the agent

**Checking sync status:**

- Read `data/.sync-status.json` for current sync state (connected, conflicts, retry queue)
- Read `data/.sync-failures.json` for permanently failed sync operations

**Handling conflicts:**

- When `application-state/sync-conflict.json` appears, a sync conflict needs resolution
- Read the `.conflict` file alongside the original to understand both versions
- Edit the original file to resolve, then delete the `.conflict` file

**Scratch files (not synced):**

- Prefix temporary files with `_tmp-` (e.g., `data/_tmp-scratch.json`) to exclude from sync

### Tech Stack

- **Framework:** @agent-native/core
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
- **Backend:** Express 5
- **State:** File-based (SSE for real-time updates)
- **Build:** `pnpm build` (client SPA + server bundle)
- **Dev:** `pnpm dev` (Vite dev server with Express middleware)
