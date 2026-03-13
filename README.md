# Agent-Native

**Software you own, powered by AI.**

Agent-native apps give you the power of SaaS with the control of custom software. Fork a template, launch in minutes, and let AI help you customize it to your exact needs.

SaaS tools are rigid and bolting AI on as an afterthought. Raw AI agents are powerful but have no UI. Agent-native is a new category — the agent and the UI are one, and you own the code.

## Templates

Start from a production-ready template and make it yours:

| Template | Replaces | What it does |
|---|---|---|
| **Analytics** | Amplitude, Mixpanel | Prompt for any chart, connect any data source. No SQL required. |
| **Content** | Notion, Google Docs | Write and organize content with an agent that knows your brand. |
| **Slides** | Google Slides, Pitch | Generate and edit React-based presentations via prompt or UI. |
| **Video** | — | Create and edit Remotion video compositions with agent assistance. |

Every template is forkable, open source, and designed to be customized. Connect your own data sources, change the UI, add features — just ask.

## Quick Start

```bash
npx @agent-native/core create my-app
cd my-app
pnpm install
pnpm dev
```

Your app runs at `http://localhost:8080`. Open it in a [harness](#harnesses) to get the agent + UI side by side.

## Why Agent-Native?

Agent-native apps follow a simple architecture that makes AI a first-class citizen:

- **Files as database** — All state lives in files. Agents are great at reading, writing, and navigating file trees.
- **AI through chat** — The UI delegates to the agent via a chat bridge. No inline LLM calls.
- **Agent updates code** — The agent can modify the app itself. Fork and evolve — your tools get better over time.
- **Real-time sync** — File watcher streams changes to the UI instantly. Agent edits appear in real-time.

This is the same shift we saw with mobile-native. Legacy systems are trying to bolt AI onto architectures that weren't designed for it. Agent-native means every feature is built to work with AI from day one.

## Harnesses

Agent-native apps run inside a **harness** — a host that provides the AI agent alongside your app UI.

| | Claude Code Harness | Builder Harness |
|---|---|---|
| **Deployment** | Local only | Local or cloud |
| **Agent** | Claude Code CLI | Claude, Codex, etc |
| **Collaboration** | Solo | Real-time multiplayer |
| **Visual editing** | No | Yes |
| **Best for** | Solo dev, local testing, OSS | Teams, production |

Your app code is identical regardless of harness.

## Docs

Full documentation, API reference, and guides at **[agent-native.com](https://agent-native.com)**.

## License

MIT
