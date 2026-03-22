# Agent-Native

**Agentic applications you own.**

Agent-native is an open source framework for building full-featured apps with agentic capabilities integrated from the ground up.

SaaS products charge you for rigid software you can't change. Agent-native gives you the code — you own it, you customize it, you evolve it with AI.

## Agents and UIs — Fully Connected

The agent and the UI are equal citizens of the same system. Every action works both ways — click it or ask for it.

![Agents and UIs fully connected](https://cdn.builder.io/api/v1/file/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fadc1e9e9368e4a8cb1b4dbb5aae5aaa2)

- **The agent sees everything** — It can read and update any UI, any data, any state in the application.
- **The UI talks to the agent** — Buttons, forms, and workflows push structured content to the agent, giving you guided flows that all go through the agent — including skills, rules, and instructions.
- **The agent updates its own code** — It can modify the app itself to change features and functionality. Your tools get better over time.
- **Everything works both ways** — Every action available in the UI is also available to the agent. You can click to do something, or ask the agent to do it.

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

Or **[launch a template](https://agent-native.com/templates)** — no setup required.

## The Best of Both Worlds

|                      | SaaS Tools         | Raw AI Agents           | Internal Tools   | Agent-Native            |
| -------------------- | ------------------ | ----------------------- | ---------------- | ----------------------- |
| **UI**               | Polished but rigid | None                    | Months to build  | Full UI, fork & go      |
| **AI**               | Bolted on          | Powerful, no guardrails | Disconnected     | Agent-first, integrated |
| **Customization**    | Can't              | Prompt-only             | Full but slow    | Agent modifies the app  |
| **Ownership**        | Rented             | N/A                     | Yours but costly | You own the code        |
| **Non-dev friendly** | Yes                | No                      | Rarely           | Guided UI + agent       |

## Architecture

Agent-native is designed to be agnostic at every layer — use the defaults or swap in your own.

| Layer        | Default                                                           | Swappable?                                                                    |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Server**   | [Nitro](https://nitro.build) (H3)                                 | Deploy anywhere Nitro supports (Node, Cloudflare, Vercel, Netlify, Deno, Bun) |
| **Auth**     | Token-based (zero-config)                                         | Plug in Auth.js, Clerk, Lucia, or any auth system via `getSession()` contract |
| **Database** | Files (`data/` directory)                                         | Add Drizzle, Prisma, or any ORM when you need a real DB                       |
| **Frontend** | React + React Router + Tailwind                                   | Modify or replace — it's your code                                            |
| **Agent**    | Works with any CLI-based agent (Claude Code, Codex, Cursor, etc.) | Agent-agnostic by design                                                      |
| **Hosting**  | Any (Netlify, Vercel, Cloudflare, self-hosted)                    | Nitro's preset system handles deployment targets                              |

### Auth: Zero to Production

Auth is invisible in development and automatic in production. No code changes required.

```bash
# Development — no auth, no config
pnpm dev

# Production — set one env var, auth activates
ACCESS_TOKEN=your-secret pnpm start
```

See [docs/auth.md](docs/auth.md) for the full auth guide, including multi-token team access and bring-your-own-auth.

## Community

Join the **[Discord](https://discord.gg/qm82StQ2NC)** to ask questions, share what you're building, and get help.

## Docs

Full documentation at **[agent-native.com](https://agent-native.com)**.

## License

MIT
