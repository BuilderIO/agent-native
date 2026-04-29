# Agent-Native

### Agentic applications you own.

Don't choose between structured user flows and autonomous agents. Every Agent-Native app is both.

## Agents and UIs — Fully Connected

The agent and the UI are equal citizens of the same system. Every action works both ways — click it or ask for it.

![Agents and UIs fully connected](https://cdn.builder.io/api/v1/file/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fadc1e9e9368e4a8cb1b4dbb5aae5aaa2)

- **Everything syncs** — Agent and UI share one database and one state. Changes from either side show up instantly on the other.
- **Context-aware** — The agent knows what you're looking at. Select text, hit Cmd+I, and tell it what to do.
- **Per-user workspace** — Skills, memory, instructions, sub-agents, and MCP servers — SQL-backed, customizable per user. Claude-Code-level flexibility, SaaS-grade economics.
- **Agents call agents** — Tag another agent from any app. They discover each other over A2A and take action across your stack.
- **Apps that improve themselves** — Your apps get better on their own. The agent can add features, fix bugs, and refine the UI over time.
- **Any database, any host** — Any SQL database Drizzle supports. Any hosting target Nitro supports. No lock-in.
- **Any AI agent** — Claude Code, Codex, Gemini CLI, OpenCode, or Builder.io. Use whichever agent you prefer.

## Cloneable SaaS Templates

Start from a complete, production-grade SaaS app. Each one replaces tools you're paying for — except you own everything and can customize it however you want. Not demos; products.

<table>
<tr>
<td width="50%" align="center" valign="top">

**Clips**

<a href="https://agent-native.com/templates/clips"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800" alt="Clips template" width="100%" /></a>

**Async screen recording for teams**

Record your screen with auto-transcripts, shareable links, and an agent that summarizes, captions, and edits clips on demand.

</td>
<td width="50%" align="center" valign="top">

**Design**

<a href="https://agent-native.com/templates/design"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800" alt="Design template" width="100%" /></a>

**AI-Native Figma, Canva**

Create and edit visual designs by prompt or by hand, with the agent as your co-designer.

</td>
</tr>
<tr>
<td width="50%" align="center" valign="top">

**Dispatch**

<a href="https://agent-native.com/templates/dispatch"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800" alt="Dispatch template" width="100%" /></a>

**Central agent router**

Talk to your agents from Slack or Telegram. Dispatch routes work, manages jobs, memory, approvals, and A2A delegation across every app.

</td>
<td width="50%" align="center" valign="top">

**Forms**

<a href="https://agent-native.com/templates/forms"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6f49a81c404d4242b33317491eac7575?format=webp&width=800" alt="Forms template" width="100%" /></a>

**AI-Native Typeform**

Generate forms from a prompt, branch logic with the agent, and own every response in your own database.

</td>
</tr>
</table>

Every template is cloneable SaaS — fork it, customize it with the agent, own it. Try them with example data before connecting your own sources.

## Quick Start

```bash
npx @agent-native/core create my-platform
cd my-platform
pnpm install
pnpm dev
```

The CLI shows a multi-select picker so you can include as many templates as you want in one workspace. Pick Clips + Forms + Dispatch and you get all three apps wired up and sharing auth in one go. Or browse the **[template gallery](https://agent-native.com/templates)** for live demos.

Want a single app, no monorepo? Use `--standalone`:

```bash
npx @agent-native/core create my-app --standalone --template clips
```

## Workspaces (Monorepo)

A workspace is the default shape of an agent-native project. Every app sits under `apps/`, and a shared `packages/core-module/` layers auth, agent-chat config, skills, and branding across every app — so cross-cutting concerns get wired up once, not per app.

```
my-platform/
├── package.json                   # declares `agent-native.workspaceCore`
├── pnpm-workspace.yaml
├── .env                           # shared secrets: ANTHROPIC_API_KEY, BUILDER_PRIVATE_KEY, A2A_SECRET, ...
├── packages/
│   └── core-module/               # shared auth, agent-chat plugin, skills, Tailwind v4 design tokens
└── apps/
    ├── clips/
    ├── dispatch/
    └── forms/
```

Add another app later:

```bash
agent-native add-app design-app --template design
```

Deploy every app behind one origin:

```bash
agent-native deploy
# https://your-agents.com/clips/*      → clips
# https://your-agents.com/dispatch/*   → dispatch
# https://your-agents.com/forms/*      → forms
```

Same-origin deploy means a **shared login session** across every app and **zero-config cross-app A2A** — tag `@dispatch` from the forms agent chat and it just works (no JWT signing, no CORS). Full details at **[agent-native.com/docs/multi-app-workspace](https://agent-native.com/docs/multi-app-workspace)**.

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
