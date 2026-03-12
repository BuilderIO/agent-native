# {{APP_NAME}} — Agent-Native App

## Architecture

This is an **@agent-native/core** application — the AI agent and UI share state through files, not a traditional database.

### Core Principles

1. **Files as database** — All app state lives in files. Both UI and agent read/write the same files.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToFusionChat()` / `fusionChat.submit()`.
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
```

### Key Patterns

**Adding an API route:**
Edit `server/index.ts`, add your route to `createAppServer()`.

**Adding a script:**
Create `scripts/my-script.ts` exporting `default async function(args: string[])`.
Run with: `pnpm script my-script --arg value`

**Sending to Fusion chat from UI:**
```ts
import { sendToFusionChat } from "@agent-native/core/client";
sendToFusionChat({ message: "Generate something", context: "...", submit: true });
```

**Sending to Fusion chat from scripts:**
```ts
import { fusionChat } from "@agent-native/core/shared";
fusionChat.submit("Generate something");
```

### Tech Stack

- **Framework:** @agent-native/core
- **Frontend:** React 18, Vite, TailwindCSS, shadcn/ui
- **Backend:** Express 5
- **State:** File-based (SSE for real-time updates)
- **Build:** `pnpm build` (client SPA + server bundle)
- **Dev:** `pnpm dev` (Vite dev server with Express middleware)
