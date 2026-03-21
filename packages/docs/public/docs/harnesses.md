# Harnesses

Agent-native apps run inside a **harness** — a host environment that provides the AI agent and displays the app UI side by side.

## CLI Harness (Local)

- Open source, ships with `@agent-native/harness-cli`
- Runs locally — xterm.js terminal on the left, your app iframe on the right
- Supports multiple AI coding CLIs — switch between them from the settings panel
- Auto-installs missing CLIs on first use
- Per-CLI launch flags and settings, persisted to localStorage
- Auto-detects when the agent finishes generating and notifies the app
- Best for: solo development, local testing, open-source projects

Quick start:

```bash
# In your agent-native monorepo
pnpm dev:harness
```

### Supported CLIs

| CLI         | Command    | Key Flags                                                 |
| ----------- | ---------- | --------------------------------------------------------- |
| Claude Code | `claude`   | `--dangerously-skip-permissions`, `--resume`, `--verbose` |
| Codex       | `codex`    | `--full-auto`, `--quiet`                                  |
| Gemini CLI  | `gemini`   | `--sandbox`                                               |
| OpenCode    | `opencode` | —                                                         |

Switch between CLIs at any time from the settings panel. The harness restarts the terminal with the selected CLI and loads its saved launch options.

## Builder Harness (Cloud)

- Provided by Builder.io — available at builder.io
- Runs locally or in the cloud
- Real-time collaboration — multiple users can watch/interact simultaneously
- Visual editing capabilities alongside the AI agent
- Parallel agent execution for faster iteration
- Best for: teams, production deployments, visual editing, real-time collaboration

## Production Mode (Embedded Agent)

For deployed apps that don't run inside a harness, agent-native ships an embedded agent mode. When `ACCESS_TOKEN` is set, the server exposes an authenticated `/api/agent-chat` SSE endpoint backed by Claude, and the client renders a mobile-friendly tab UI with a built-in chat panel.

### How It Works

1. **Session auth** — `mountAuthMiddleware` gates all routes with an HttpOnly session cookie. Unauthenticated browser requests get a login page; API requests get a 401.
2. **Production agent handler** — `createProductionAgentHandler` creates an H3 SSE endpoint that runs an agentic tool loop. Each script's `run()` export is a tool the agent can invoke.
3. **`ProductionAgentPanel`** — React component that renders a bottom tab bar (app | agent) and a full-screen streaming chat view in the agent tab.
4. **`useProductionAgent`** — React hook that streams text deltas and tool-call events from `/api/agent-chat`.

### Setup

In `server/node-build.ts`:

```ts
import {
  createProductionServer,
  createProductionAgentHandler,
} from "@agent-native/core";
import { createAppServer } from "./index.js";
import { scripts } from "./scripts/registry.js";
import { readFileSync } from "fs";

const agent = createProductionAgentHandler({
  scripts,
  systemPrompt: readFileSync("agents/system-prompt.md", "utf-8"),
});

createAppServer().then((app) =>
  createProductionServer(app, {
    agent,
    accessToken: process.env.ACCESS_TOKEN,
  }),
);
```

In `client/App.tsx`:

```tsx
import { ProductionAgentPanel } from "@agent-native/core";

export default function App() {
  return (
    <ProductionAgentPanel appLabel="Mail">
      <MailApp />
    </ProductionAgentPanel>
  );
}
```

`ProductionAgentPanel` is a no-op in dev mode — it passes children straight through without rendering the tab bar.

### Running in Production

```bash
cd templates/mail
pnpm build
ACCESS_TOKEN=mytoken ANTHROPIC_API_KEY=sk-... node dist/server/node-build.mjs
# Open http://localhost:3000 — login page appears
# Enter the access token — app loads
# Tap "Agent" tab — streaming chat
```

Set `ACCESS_TOKEN` to a strong random secret. If omitted, the `/api/agent-chat` endpoint is unprotected.

## Feature Comparison

| Feature                 | CLI Harness  | Builder Harness |
| ----------------------- | ------------ | --------------- |
| Local development       | Yes          | Yes             |
| Cloud/remote            | No           | Yes             |
| Multi-CLI support       | Yes (4 CLIs) | Yes             |
| Real-time collaboration | No           | Yes             |
| Visual editing          | No           | Yes             |
| Parallel agents         | No           | Yes             |
| Agent chat bridge       | Yes          | Yes             |
| File watcher (SSE)      | Yes          | Yes             |
| Script system           | Yes          | Yes             |
| Production mode         | No           | Yes (embedded)  |
| Open source             | Yes          | No              |

## How It Works

Both harnesses support the same core agent-native protocol:

1. **Agent chat** — use `sendToAgentChat()` to send messages to the agent
2. **Generation state** — use `useAgentChatGenerating()` to track when the agent is running
3. **File watching** — SSE endpoint keeps UI in sync when the agent modifies files
4. **Script system** — `pnpm script <name>` dispatches to callable scripts

Your app code is identical regardless of which harness or CLI you use.
