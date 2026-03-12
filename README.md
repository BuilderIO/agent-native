# Agent-Native

Framework for **agent-native** application development — where an AI agent and UI share state through files.

Think Next.js, but for apps where the AI agent is a first-class citizen: it reads and writes the same files as the UI, communicates through a chat bridge, and can even modify the app's own code.

## Quick Start

```bash
npx @agent-native/core create my-app
cd my-app
pnpm install
pnpm dev
```

Your app is running at `http://localhost:8080`.

## What is an Agent-Native App?

An agent-native app follows five principles:

1. **Files as database** — All state lives in files. No traditional DB needed. UI and agent read/write the same files.
2. **All AI through the agent chat** — No inline LLM calls. The UI delegates to the AI via a chat bridge (`sendToAgentChat()`).
3. **Scripts for agent operations** — `pnpm script <name>` dispatches to callable scripts the agent can invoke.
4. **Bidirectional SSE events** — A file watcher streams changes to the UI in real-time, so agent edits appear instantly.
5. **Agent can update code** — The agent modifies the app itself. It's a feature, not a bug.

## What You Get

AgentNative extracts the shared foundation from production apps into two packages:

| Import | What it does |
|--------|-------------|
| `@agent-native/core` | `createServer()`, `createFileWatcher()`, `createSSEHandler()`, `createProductionServer()`, `runScript()`, `parseArgs()`, `loadEnv()`, `fail()`, path validators |
| `@agent-native/client` | `agentChat`, `sendToAgentChat()`, `useAgentChatGenerating()`, `useFileWatcher()`, `cn()` |
| `@agent-native/core/vite` | `defineConfig()` and `defineServerConfig()` — full Vite setup in 1 line |
| `@agent-native/core/tailwind` | Tailwind preset with HSL color system, shadcn/ui tokens, animations |
| `@agent-native/core/adapters/firestore` | Bidirectional file sync with three-way merge and conflict resolution |

## Usage

### Vite Config (client)

```ts
// vite.config.ts
import { defineConfig } from "@agent-native/core/vite";
export default defineConfig();
```

### Vite Config (server build)

```ts
// vite.config.server.ts
import { defineServerConfig } from "@agent-native/core/vite";
export default defineServerConfig();
```

### Server

```ts
// server/index.ts
import { createServer, createFileWatcher, createSSEHandler } from "@agent-native/core";

export function createAppServer() {
  const app = createServer();
  const watcher = createFileWatcher("./data");

  app.get("/api/items", listItems);
  app.post("/api/items", createItem);

  app.get("/api/events", createSSEHandler(watcher));
  return app;
}
```

### Production Server

```ts
// server/node-build.ts
import { createProductionServer } from "@agent-native/core";
import { createAppServer } from "./index.js";
createProductionServer(createAppServer());
```

### Client — Chat Bridge

```ts
import { sendToAgentChat } from "@agent-native/client";

sendToAgentChat({
  message: "Generate a summary of this document",
  context: documentContent,
  submit: true,
});
```

### Client — File Watcher Hook

```tsx
import { useFileWatcher } from "@agent-native/client";
import { useQueryClient } from "@tanstack/react-query";

function App() {
  const queryClient = useQueryClient();
  useFileWatcher({ queryClient, queryKeys: ["files", "projects"] });
  // ...
}
```

### Scripts

```ts
// scripts/run.ts
import { runScript } from "@agent-native/core";
runScript();
```

```ts
// scripts/my-task.ts
import { parseArgs, loadEnv } from "@agent-native/core";
import { agentChat } from "@agent-native/client";

export default async function myTask(args: string[]) {
  loadEnv();
  const { project } = parseArgs(args);
  // do work...
  agentChat.submit(`Finished processing ${project}`);
}
```

### Tailwind

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";
import preset from "@agent-native/core/tailwind";

export default {
  presets: [preset],
  content: ["./client/**/*.{ts,tsx}"],
} satisfies Config;
```

### TypeScript

```json
// tsconfig.json
{
  "extends": "@agent-native/core/tsconfig.base.json"
}
```

## Scaffolded App Structure

```
my-app/
  index.html
  package.json
  vite.config.ts
  vite.config.server.ts
  tsconfig.json
  tailwind.config.ts
  postcss.config.js
  components.json
  AGENTS.md
  client/
    App.tsx
    global.css
    lib/utils.ts
  server/
    index.ts
    node-build.ts
  shared/
    api.ts
  scripts/
    run.ts
    hello.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server (Express mounted as middleware) |
| `pnpm build` | Build client SPA + server bundle |
| `pnpm start` | Run production server |
| `pnpm script <name>` | Run a script from `scripts/` |
| `pnpm typecheck` | TypeScript type checking |

## Firestore Sync (Optional)

For apps that need bidirectional file sync across instances:

```ts
import { FileSync } from "@agent-native/core/adapters/firestore";

const sync = new FileSync({
  appId: "my-app",
  ownerId: "owner-123",
  contentRoot: "./content",
  getFileCollection: () => db.collection("fusionAppFiles"),
});

await sync.initFileSync();
```

Features: startup sync, real-time Firestore listeners, chokidar file watchers, three-way merge with LCS-based conflict resolution, `.conflict` sidecar files for unresolvable conflicts.

## License

MIT
