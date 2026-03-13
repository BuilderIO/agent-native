# Agent-Native

**Agentic applications you own.**

Agent-native is an open source framework for building apps where an AI agent, a full application UI, and a computer work together as one. Fork a template, launch in minutes, and let AI help you customize it to your exact needs.

Other products charge you for rigid software you can't change. Agent-native gives you the code — you own it, you customize it, you evolve it with AI.

## Templates

Start from a production-ready template. Each one replaces tools you're paying for — except you own everything and can customize it however you want.

| Template | Replaces | What it does |
|---|---|---|
| **Analytics** | Amplitude, Mixpanel | Connect any data source, prompt for any chart. Build reusable dashboards, not throwaway Q&A. |
| **Content** | Notion, Google Docs | Write and organize content with an agent that knows your brand and publishing workflow. |
| **Slides** | Google Slides, Pitch | Generate and edit React-based presentations via prompt or point-and-click. |
| **Video** | Manual editing | Create and edit Remotion video compositions with agent assistance. |

Every template is forkable, open source, and designed to be customized. Try them with example data before connecting your own sources.

## Quick Start

```bash
npx @agent-native/core create my-app
cd my-app
pnpm install
pnpm dev
```

Or **[launch a template in Builder](https://builder.io)** — no setup required.

## How It Works

Agent-native apps follow five rules:

- **Files as database** — All state lives in files. The agent and UI share the same source of truth.
- **AI through the agent** — No inline LLM calls. The UI delegates to the agent via a chat bridge. One AI, customizable with skills and instructions.
- **Agent updates code** — The agent can modify the app itself. Your tools get better over time.
- **Real-time sync** — File watcher streams changes via SSE. Agent edits appear instantly.
- **Agent + UI + Computer** — The powerful trio. Everything the UI can do, the agent can do — and vice versa.

## Harnesses

Agent-native apps run inside a **harness** — a host that provides the AI agent alongside your app UI.

| | Local / Open Source | Builder Cloud |
|---|---|---|
| **Run** | Claude Code CLI or any local harness | One-click launch from templates |
| **Collaboration** | Solo | Real-time multiplayer |
| **Features** | Full permissions, full control | Visual editing, roles & permissions |
| **Best for** | Solo dev, local testing, OSS | Teams, production |

Your app code is identical regardless of harness. Start local, go to cloud when you need teams.

## Docs

Full documentation at **[agent-native.com](https://agent-native.com)**.

## License

MIT
