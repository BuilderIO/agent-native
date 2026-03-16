# Agent-Native Framework

## What This Is

Agent-native is a framework for building apps where an AI agent and UI share state through files. Think Next.js, but the AI agent is a first-class citizen.

## The Five Rules

Every agent-native app follows these rules. Violating them breaks the architecture.

### 1. Files are the database

All app state lives in files (usually in `data/`). There is no traditional database. The UI reads files via API routes, the agent reads and writes files directly. This is what makes the architecture work — both sides operate on the same source of truth.

**Do:** Store state as JSON/markdown files in `data/`.
**Don't:** Add a database, use localStorage for app state, or store state only in memory.

### 2. All AI goes through the agent chat

The UI never calls an LLM directly. When the user wants AI to do something, the UI sends a message to the agent via the chat bridge (`sendToAgentChat()`). The agent does the work and writes results to files.

**Do:** Use `sendToAgentChat()` from the client, `agentChat.submit()` from scripts.
**Don't:** Import an AI SDK in client or server code. No `openai.chat()`, no `anthropic.messages()`, no inline LLM calls anywhere.

### 3. Scripts for agent operations

When the agent needs to do something — query data, call APIs, process information — it runs a script via `pnpm script <name>`. Scripts live in `scripts/` and export a default async function. **Everything the UI can do, the agent can do via scripts and data files.**

**Do:** Create focused scripts for discrete operations. Parse args with `parseArgs()`. Use scripts to list, search, create, and manage data — not just for background tasks.
**Don't:** Put complex logic inline in agent chat. Keep scripts small and composable. Don't say "I don't have access" — check the scripts and data files first.

### 4. SSE keeps the UI in sync

A file watcher (`createFileWatcher`) streams changes to the UI via Server-Sent Events. When the agent writes a file, the UI updates automatically. Use `useFileWatcher()` to invalidate React Query caches on changes.

### 5. The agent can modify code

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature. Design your app expecting this.

### 6. Application state as files

Ephemeral UI state lives in `application-state/` as JSON files. Both the agent and the UI can read and write these files. When the agent writes a file (e.g., `application-state/compose.json`), the UI reacts via SSE and updates accordingly. When the user interacts with the UI, changes are written back to the same file so the agent can read them.

**Do:** Use `application-state/` for UI state the agent needs to trigger or modify (compose windows, search state, wizard steps).
**Don't:** Use `application-state/` for persistent data — that belongs in `data/`. Don't store secrets or credentials here.

**Rules:**

- Always gitignored — this is per-instance runtime state, not persisted across clones
- Always in `.ignore` with negation (`!application-state/`) so agent tools (ripgrep, glob) can see the files
- JSON files, one per state concern (e.g., `compose.json`, `search.json`)
- File existence = state is active. Deleting the file = clearing the state.
- The SSE file watcher watches `application-state/` alongside `data/`

## Project Structure

```
client/          # React frontend (Vite SPA)
server/          # Express backend
shared/          # Isomorphic code (client + server)
scripts/         # Agent-callable scripts
data/            # App data files (watched by SSE)
```

## Scripts

Create `scripts/my-script.ts`:

```ts
import { parseArgs } from "@agent-native/core";
export default async function (args: string[]) {
  const { name } = parseArgs(args);
  // do work, write files to data/
}
```

Run with: `pnpm script my-script --name foo`

## TypeScript Everywhere

All code in this project — including standalone scripts in `scripts/` — must be TypeScript (`.ts`). Never use `.js` or `.mjs` files. Node 22+ runs `.ts` files natively via type stripping (`node scripts/foo.ts`), so no compilation step or `tsx` is needed for scripts.

## Prettier After Writing Files

After writing or modifying any source file (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.md`, `.yaml`, `.yml`, `.html`), always run Prettier on those specific files before committing:

```bash
npx prettier --write path/to/file1.ts path/to/file2.tsx
```

This keeps CI green — the `fmt:check` step in CI will reject unformatted code. Run Prettier on the specific files you changed, not the entire repo.

## Image Output

Never save screenshots, images, or other binary artifacts to the repository root or directly inside package directories. Save them to a temporary directory or use an ephemeral path.

## Skills

Agent skills in `.agents/skills/` provide detailed guidance for architectural rules and design patterns. Read the relevant skill before making changes.

| Skill                 | When to use                                          |
| --------------------- | ---------------------------------------------------- |
| `delegate-to-agent`   | Delegating AI work from UI or scripts to the agent   |
| `files-as-database`   | Storing or reading app state                         |
| `scripts`             | Creating or running agent scripts                    |
| `sse-file-watcher`    | Wiring up real-time UI sync                          |
| `self-modifying-code` | Editing app source, components, or styles            |
| `create-skill`        | Adding new skills for the agent                      |
| `capture-learnings`   | Recording corrections and patterns                   |
| `frontend-design`     | Building or styling any web UI, components, or pages |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) applies whenever the agent generates or modifies UI. It enforces distinctive, production-grade aesthetics — avoiding generic AI-generated design patterns like purple gradients, overused fonts, and cookie-cutter layouts.
