# Agent-Native

Framework for **agent-native** application development — where an AI agent and UI share state through files.

Think Next.js, but for apps where the AI agent is a first-class citizen: it reads and writes the same files as the UI, communicates through a chat bridge, and can even modify the app's own code.

## Harnesses

Agent-native apps run inside a **harness** — a host environment that provides the AI agent and displays your app UI side by side.

| | Claude Code Harness | Builder Harness |
|---|---|---|
| **Deployment** | Local only | Local or cloud |
| **Agent** | Claude Code CLI (PTY) | Claude, Codex, etc |
| **Collaboration** | Solo | Real-time multiplayer |
| **Visual editing** | No | Yes |
| **Parallel agents** | No | Yes |
| **Best for** | Solo dev, local testing, OSS | Teams, production, visual collaboration |

Both harnesses support all core features: postMessage chat bridge, SSE file watcher, and script system. Your app code is identical regardless of harness. See the [full comparison in the docs](https://agent-native.dev/docs/harnesses).

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

See the [docs](https://agent-native.dev) for full API reference, usage examples, and guides.

## License

MIT
