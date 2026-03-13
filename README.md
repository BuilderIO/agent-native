# Agent-Native

**Agentic applications you own.**

Agent-native is an open source framework for building apps where an AI agent, a full application UI, and a computer work together as one. Fork a template, launch in minutes, and let AI help you customize it to your exact needs.

Other products charge you for rigid software you can't change. Agent-native gives you the code — you own it, you customize it, you evolve it with AI.

## Templates

Start from a production-ready template. Each one replaces tools you're paying for — except you own everything and can customize it however you want.

<table>
<tr>
<td width="25%" align="center" valign="top">

**Analytics**

<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800" alt="Analytics template" width="100%" />

**AI-Native Amplitude, Mixpanel**

Connect any data source, prompt for any chart. Build reusable dashboards, not throwaway Q&A.

<a href="https://agent-native.com/templates/analytics"><img src=".github/assets/launch-button.svg" alt="Launch Analytics" height="36" /></a>

</td>
<td width="25%" align="center" valign="top">

**Content**

<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800" alt="Content template" width="100%" />

**AI-Native Notion, Google Docs**

Write and organize content with an agent that knows your brand and publishing workflow.

<a href="https://agent-native.com/templates/content"><img src=".github/assets/launch-button.svg" alt="Launch Content" height="36" /></a>

</td>
<td width="25%" align="center" valign="top">

**Slides**

<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800" alt="Slides template" width="100%" />

**AI-Native Google Slides, Pitch**

Generate and edit React-based presentations via prompt or point-and-click.

<a href="https://agent-native.com/templates/slides"><img src=".github/assets/launch-button.svg" alt="Launch Slides" height="36" /></a>

</td>
<td width="25%" align="center" valign="top">

**Video**

<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b8bfcc18a1d4c47a491da3b2d4148a4?format=webp&width=800" alt="Video template" width="100%" />

**AI-Native video editing**

Create and edit Remotion video compositions with agent assistance.

<a href="https://agent-native.com/templates/video"><img src=".github/assets/launch-button.svg" alt="Launch Video" height="36" /></a>

</td>
</tr>
</table>

Every template is forkable, open source, and designed to be customized. Try them with example data before connecting your own sources.

## Quick Start

```bash
npx @agent-native/core create my-app
cd my-app
pnpm install
pnpm dev
```

Or **[launch a template](https://agent-native.com/templates)** — no setup required.

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
