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

When the agent needs to do something complex (API calls, image generation, data processing), it runs a script via `pnpm script <name>`. Scripts live in `scripts/` and export a default async function.

**Do:** Create focused scripts for discrete operations. Parse args with `parseArgs()`.
**Don't:** Put complex logic inline in agent chat. Keep scripts small and composable.

### 4. SSE keeps the UI in sync

A file watcher (`createFileWatcher`) streams changes to the UI via Server-Sent Events. When the agent writes a file, the UI updates automatically. Use `useFileWatcher()` to invalidate React Query caches on changes.

### 5. The agent can modify code

The agent can edit the app's own source code — components, routes, styles, scripts. This is a feature. Design your app expecting this.

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

## Image Output

Never save screenshots, images, or other binary artifacts to the repository root or directly inside package directories. Save them to a temporary directory or use an ephemeral path.
