# Agent-Native

### Open-source framework for agentic applications you own.

Don't choose between rich user interfaces and autonomous agents. Every Agent-Native app is both.

## Agents and UIs — Fully Connected

The agent and the UI are equal citizens of the same system. Every action works both ways — click it or ask for it.

![Agents and UIs fully connected](https://cdn.builder.io/api/v1/file/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fadc1e9e9368e4a8cb1b4dbb5aae5aaa2)

- **Everything syncs** — Agent and UI share one database and one state. Changes from either side show up instantly on the other.
- **Real-time multiplayer** — Humans and agents collaborate in the same document simultaneously: CRDT merging, live presence (cursors, selection rings, who's on which slide), and the agent as a first-class peer editor. Works on any SQL database and any host, including serverless.
- **Context-aware** — The agent knows what you're looking at. Select text, hit Cmd+I, and tell it what to do.
- **Per-user workspace** — Skills, memory, instructions, sub-agents, and MCP servers — SQL-backed, customizable per user. Claude-Code-level flexibility, SaaS-grade economics.
- **Agents call agents** — Tag another agent from any app. They discover each other over A2A and take action across your stack.
- **Reusable integrations** — Connect a provider once in Dispatch, keep secret values in the vault, then grant apps like Brain, Analytics, Mail, and Dispatch access to the shared account metadata and credential refs.
- **Three shapes** — Build the same agent as a headless API, a rich chat experience, or a full application where agent and UI stay in sync.
- **Apps that improve themselves** — Your apps get better on their own. The agent can add features, fix bugs, and refine the UI over time.
- **Any database, any host** — Any SQL database Drizzle supports. Any hosting target Nitro supports. No lock-in.
- **Bring the agent surface you need** — MCP-compatible hosts can call your apps, coding agents can install skills, native chat renders reusable app outputs, and BYO agent runtimes can stream into the Agent-Native chat shell.

## The framework for agent-native apps

Agent-Native is an open-source framework for building robust agents that can act inside real apps, not just chat next to them.

It gives you primitives for product-grade agentic software: shared actions, SQL-backed state, identity, tools, skills, jobs, observability, and UI surfaces that all work together.

Backend agnostic: bring your own database, hosting provider, model stack, and app code.

```ts
// One action powers UI, agent, HTTP, MCP, A2A, and CLI.
export default defineAction({
  schema: z.object({
    emailId: z.string(),
    body: z.string(),
  }),
  run: async ({ emailId, body }) => {
    await db.insert(replies).values({ emailId, body });
  },
});
```

- **Actions** — Define work once. Use it from UI, agent, API, MCP, A2A, and CLI.
- **Agent runtime** — Chat, tools, skills, memory, jobs, observability, and handoffs ship together.
- **Backend agnostic** — Plug in any Drizzle-supported SQL database and Nitro-compatible host.

## One agent, three product shapes

Agent-Native primitives let you choose how much UI to put around an agent without rebuilding the agent contract:

| Shape         | What you ship                                                                                             | Same primitives underneath                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Headless**  | Call the agent and actions from code, CLI, HTTP, MCP, or A2A.                                             | `defineAction`, auth, skills, memory, jobs, observability                   |
| **Rich chat** | A standalone or embedded chat with native tables, charts, approvals, setup flows, and tool results.       | Shared chat runtime, BYO runtime adapters, action-declared native renderers |
| **Whole app** | A full SaaS/product UI where chat can start central, move to the sidebar, and stay synced with app state. | SQL state, actions, context awareness, deep links, live sync                |

Protocols come with the framework instead of becoming separate integrations per feature. Today that means A2A, MCP, MCP Apps, standard remote MCP OAuth, MCP clients, HTTP/CLI action calls, native chat widgets, `AgentChatRuntime` adapters, and deep links all hang off the same action surface. AG-UI is a natural future adapter path for bring-your-own agent runtimes; ACP is best understood as the coding-agent/editor interoperability protocol, not the general BYO app-chat runtime.

For the full decision guide — headless, rich chat on the built-in agent, rich chat on your own agent, embedded sidecar, or full app — see [Agent Surfaces](https://agent-native.com/docs/agent-surfaces).

To connect Claude, ChatGPT, Codex, Cursor, OpenCode, GitHub Copilot / VS Code, or another MCP host to your hosted app, see the [External Agents guide](https://agent-native.com/docs/external-agents).

## Try it with a skill

Don't want to scaffold a whole app yet? Add visual planning and PR recaps to Claude Code, Codex, Cursor, Pi, OpenCode, GitHub Copilot / VS Code, and similar agents with one command:

```bash
npx @agent-native/core@latest skills add visual-plan
```

You get two slash commands that upgrade how your agent plans and reports its work:

- **`/visual-plan`** — before the agent writes code, it opens a structured, reviewable plan document instead of a wall of text: inline diagrams, UI wireframes and prototypes, file-by-file implementation maps, and annotations you can comment on and approve.
- **`/visual-recap`** — after changes land, it turns a PR or git diff into a high-altitude visual recap: schema, API, and file changes rendered as grounded before/after blocks with a shareable review link, instead of scrolling a raw diff.

See the **[Skills Guide](https://agent-native.com/docs/skills-guide#app-backed-skills)** for more skills and local installs.

## Templates

Start with a full featured template. Each one is a complete, 100% free and open-source SaaS app — cloneable, not scaffolded — except you own the code and can customize everything.

<table>
<tr>
<td width="33%" align="center" valign="top">

**Calendar**

<a href="https://agent-native.com/templates/calendar"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Ffb6c3b483ca24ab3b6c3a758aeceef4c?format=webp&width=800" alt="Calendar template" width="100%" /></a>

**Agent-Native Google Calendar, Calendly**

Manage events, sync with Google Calendar, and share a public booking page with AI scheduling.

</td>
<td width="33%" align="center" valign="top">

**Content**

<a href="https://agent-native.com/templates/content"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800" alt="Content template" width="100%" /></a>

**Open-source Obsidian for MDX**

Edit local Markdown/MDX files, generate rich interactive custom blocks, and draft, rewrite, or publish with an agent.

</td>
<td width="33%" align="center" valign="top">

**Plans**

<a href="https://agent-native.com/templates/plan"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb6f4213ac7cc42eeb10c12e8ccda8936?format=webp&width=800" alt="Plans template" width="100%" /></a>

**Visual plan mode for coding agents**

Install `/visual-plan` and `/visual-recap` so your coding agent can plan before it builds and recap changes after they land — high-level code reviews with diagrams, wireframes, annotations, and review links.

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Slides**

<a href="https://agent-native.com/templates/slides"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800" alt="Slides template" width="100%" /></a>

**Agent-Native Google Slides, Pitch**

Generate and edit React-based presentations via prompt or point-and-click.

</td>
<td width="33%" align="center" valign="top">

**Analytics**

<a href="https://agent-native.com/templates/analytics"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800" alt="Analytics template" width="100%" /></a>

**Agent-Native Amplitude, Mixpanel**

Connect analytics data sources, prompt for real charts, and build reusable dashboards. Shared workspace connections can provide provider credentials, while Analytics still owns metrics, source-of-truth choices, and saved analyses.

</td>
<td width="33%" align="center" valign="top">

**Clips**

<a href="https://agent-native.com/templates/clips"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F678be5a501a14ab8a508e5f7bc92c468?format=webp&width=800" alt="Clips template" width="100%" /></a>

**Agent-Native Loom**

Record your screen with auto-transcripts, shareable links, and an agent that summarizes, captions, and edits clips on demand.

</td>
</tr>
</table>

Every template is a complete cloneable SaaS — fork it, customize it with the agent, own it. Try them with example data before connecting your own sources.

View the full template gallery at **[agent-native.com/templates](https://agent-native.com/templates)**.

## Quick Start

One command to fork a template and start building locally.

```bash
npx @agent-native/core@latest create my-platform
cd my-platform
pnpm install
pnpm dev
```

The CLI shows a multi-select picker so you can include as many templates as you want in one workspace. Pick Mail + Calendar + Forms and you get all three apps wired up and sharing auth in one go. Or browse the **[template gallery](https://agent-native.com/templates)** for live demos.

Want a single app, no monorepo? Use `--standalone`:

```bash
npx @agent-native/core@latest create my-app --standalone --template mail
```

## Workspaces (Monorepo)

A workspace is the default shape of an agent-native project. Every app sits under `apps/`, and `packages/shared/` is available for the small amount of code, instructions, skills, or branding that should truly apply to every app.

```
my-platform/
├── package.json                   # declares `agent-native.workspaceCore`
├── pnpm-workspace.yaml
├── .env                           # shared secrets: ANTHROPIC_API_KEY, BUILDER_PRIVATE_KEY, A2A_SECRET, ...
├── packages/
│   └── shared/                    # optional shared custom code
└── apps/
    ├── mail/
    ├── calendar/
    └── forms/
```

Add another app later:

```bash
npx @agent-native/core@latest add-app notes --template content
```

Deploy every app behind one origin:

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → mail
# https://your-agents.com/calendar/*   → calendar
# https://your-agents.com/forms/*      → forms
```

Same-origin deploy means a **shared login session** across every app and **zero-config cross-app A2A** — tag `@mail` from the calendar's agent chat and it just works (no JWT signing, no CORS). Full details at **[agent-native.com/docs/multi-app-workspace](https://agent-native.com/docs/multi-app-workspace)**.

## The Best of Both Worlds

|                   | SaaS Tools         | Raw AI Agents           | Internal Tools             | Agent-Native            |
| ----------------- | ------------------ | ----------------------- | -------------------------- | ----------------------- |
| **UI**            | Polished but rigid | None                    | Mixed quality              | Full UI, fork & go      |
| **AI**            | Bolted on          | Powerful                | Shallowly connected        | Agent-first, integrated |
| **Customization** | Can't              | Instructions and skills | Full, but high maintenance | Agent modifies the app  |
| **Ownership**     | Rented             | Somewhat yours          | You own the code           | You own the code        |

## Community

Join the **[Discord](https://discord.gg/qm82StQ2NC)** to ask questions, share what you're building, and get help.

## Docs

Full documentation at **[agent-native.com](https://agent-native.com)**.

## License

MIT
