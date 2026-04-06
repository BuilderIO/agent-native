# Agent-Native

**Agentic applications you own.**

Agent-native is an open source framework for building apps where an AI agent, a full application UI, and a computer work together as one. Fork a template, launch in minutes, and let AI help you customize it to your exact needs.

Other products charge you for rigid software you can't change. Agent-native gives you the code — you own it, you customize it, you evolve it with AI.

## Templates

Start from a production-ready template. Each one replaces tools you're paying for — except you own everything and can customize it however you want.

<table>
<tr>
<td width="33%" align="center" valign="top">

**Mail**

<a href="https://agent-native.com/templates/mail"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800" alt="Mail template" width="100%" /></a>

**AI-Native Mail, Superhuman**

Superhuman-style email client with keyboard shortcuts, AI triage, and a fully customizable inbox you own.

</td>
<td width="33%" align="center" valign="top">

**Calendar**

<a href="https://agent-native.com/templates/calendar"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffb6c3b483ca24ab3b6c3a758aeceef4c?format=webp&width=800" alt="Calendar template" width="100%" /></a>

**AI-Native Google Calendar, Calendly**

Manage events, sync with Google Calendar, and share a public booking page with AI scheduling.

</td>
<td width="33%" align="center" valign="top">

**Content**

<a href="https://agent-native.com/templates/content"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800" alt="Content template" width="100%" /></a>

**AI-Native Notion, Google Docs**

Write and organize content with an agent that knows your brand and publishing workflow.

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Slides**

<a href="https://agent-native.com/templates/slides"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800" alt="Slides template" width="100%" /></a>

**AI-Native Google Slides, Pitch**

Generate and edit React-based presentations via prompt or point-and-click.

</td>
<td width="33%" align="center" valign="top">

**Video**

<a href="https://agent-native.com/templates/video"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b8bfcc18a1d4c47a491da3b2d4148a4?format=webp&width=800" alt="Video template" width="100%" /></a>

**AI-Native video editing**

Create and edit Remotion video compositions with agent assistance.

</td>
<td width="33%" align="center" valign="top">

**Analytics**

<a href="https://agent-native.com/templates/analytics"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800" alt="Analytics template" width="100%" /></a>

**AI-Native Amplitude, Mixpanel**

Connect any data source, prompt for any chart. Build reusable dashboards, not throwaway Q&A.

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

The CLI walks you through picking a template interactively. Or **[launch a template](https://agent-native.com/templates)** — no setup required.

## How It Works

Agent-native apps follow these rules:

- **Data lives in SQL** — All state lives in a SQL database (SQLite locally, cloud DB in production via `DATABASE_URL`). The agent and UI share the same database.
- **AI through the agent** — No inline LLM calls. The UI delegates to the agent via a chat bridge. One AI, customizable with skills and instructions.
- **Agent updates code** — The agent can modify the app itself. Your tools get better over time.
- **Real-time sync** — SSE streams database changes to the UI. Agent writes appear instantly.
- **Production ready** — Built-in auth, OAuth, cloud databases, and deployment presets. Same code runs locally and in production.
- **Agent + UI + Computer** — The powerful trio. Everything the UI can do, the agent can do — and vice versa.

## Run Anywhere

Every agent-native app includes an embedded agent panel with chat and optional CLI terminal.

| | Local | Builder Cloud |
|---|---|---|
| **Run** | `pnpm dev` — agent panel embedded in app | One-click launch from templates |
| **Database** | Local SQLite or cloud DB via `DATABASE_URL` | Managed cloud database |
| **Auth** | Built-in (ACCESS_TOKEN) or bring your own | Managed auth + roles |
| **Best for** | Development, self-hosted production, OSS | Teams, managed production |

Your app code is identical regardless of environment. Start local, go to cloud when you need teams.

## Docs

Full documentation at **[agent-native.com](https://agent-native.com)**.

## License

MIT
