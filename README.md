# Agent-Native

## The framework for agent-native apps

Agent-Native is an open-source framework for building robust agents that act inside real apps, not just chat next to them. It gives you primitives for product-grade agentic software: shared actions, SQL-backed state, identity, tools, skills, jobs, observability, and UI surfaces that all work together. Bring your own database, hosting provider, model stack, and app code.

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

- **Actions**: Define work once. Use it from UI, agent, API, MCP, A2A, and CLI.
- **Agent runtime**: Chat, tools, skills, memory, jobs, observability, and handoffs ship together.
- **Backend agnostic**: Plug in any Drizzle-supported SQL database and Nitro-compatible host.

## Templates

Start with a full featured template. Each one is a complete, 100% free and open-source SaaS app: cloneable, not scaffolded, except you own the code and can customize everything.

<table>
<tr>
<td width="33%" align="center" valign="top">

**Clips**

<a href="https://agent-native.com/templates/clips"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F189ebd9b2f2b4f0ead3b33138d4e4c10?format=webp&width=800" alt="Clips template" width="100%" /></a>

**Agent-Native Loom + Jam**

Record your screen with auto-transcripts and captured browser debug logs, share a link, and let an agent read the transcript, see timestamped frames, and fix the bug.

</td>
<td width="33%" align="center" valign="top">

**Plans**

<a href="https://agent-native.com/templates/plan"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb6f4213ac7cc42eeb10c12e8ccda8936?format=webp&width=800" alt="Plans template" width="100%" /></a>

**Visual plan mode for coding agents**

Install `/visual-plan` and `/visual-recap` so your coding agent can plan before it builds and recap changes after they land. High-level code reviews with diagrams, wireframes, annotations, and review links.

</td>
<td width="33%" align="center" valign="top">

**Design**

<a href="https://agent-native.com/templates/design"><img src="https://cdn.builder.io/api/v1/image/assets%2F348da13fcd8b414c87de9066196f7266%2F961bedb713a94463b834c1f2f4643bcf?format=webp&width=800" alt="Design template" width="100%" /></a>

**Agent-Native design prototyping**

Generate interactive HTML prototypes, compare variants, refine controls, and export the result.

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Content**

<a href="https://agent-native.com/templates/content"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800" alt="Content template" width="100%" /></a>

**Open-source Obsidian for MDX**

Edit local Markdown/MDX files, generate rich interactive custom blocks, and draft, rewrite, or publish with an agent.

</td>
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

Connect analytics data sources, prompt for real charts, and build reusable dashboards.

</td>
</tr>
</table>

View the full template gallery at **[agent-native.com/templates](https://agent-native.com/templates)**.

## Agents and UIs, Fully Connected

The agent and the UI are equal citizens of one system. Every action works both ways: click it or ask for it.

![Agents and UIs fully connected](https://cdn.builder.io/api/v1/file/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fadc1e9e9368e4a8cb1b4dbb5aae5aaa2)

- **Everything syncs**: One database, one state. Changes from either side show up instantly on the other.
- **Real-time multiplayer**: Humans and agents edit the same document together, with the agent as a first-class peer.
- **Context-aware**: The agent knows what you're looking at. Select text, hit Cmd+I, and tell it what to do.
- **Agents call agents**: Tag another agent from any app and they coordinate over A2A.
- **Self-improving**: The agent can add features, fix bugs, and refine the UI over time.

## Try it with a skill

Don't want to scaffold a whole app yet? Add visual planning and PR recaps to Claude Code, Codex, Cursor, Pi, OpenCode, GitHub Copilot / VS Code, and similar agents with one command:

```bash
npx @agent-native/core@latest skills add visual-plan
```

![Visual plan and recap in action](https://raw.githubusercontent.com/builderio/skills/main/media/visual-recap.gif)

You get two slash commands:

- **`/visual-plan`**: before the agent writes code, it opens a structured, reviewable plan with inline diagrams, UI wireframes, file-by-file implementation maps, and annotations you can comment on and approve.
- **`/visual-recap`**: after changes land, it turns a PR or git diff into a high-altitude visual recap with a shareable review link instead of a raw diff.

See the **[Skills Guide](https://agent-native.com/docs/skills-guide#app-backed-skills)** for more.

## Quick Start

One command to start a new project locally.

```bash
npx @agent-native/core@latest create my-app
cd my-app
pnpm install
pnpm dev
```

`create` first asks how you want to start:

- **Full template(s)**: clone one or more complete apps into a workspace. Pick Mail + Calendar + Forms and you get all three wired up and sharing auth.
- **Chat**: a single app with a minimal chat UI and the browser shell already wired, the simplest way to get a UI.
- **Headless**: a single action-first app with no UI shell. The CLI walks you through calling your first action and agent, and you can add a UI later.

Prefer flags? `create my-app --template mail`, `--headless`, or `--standalone` skip the prompt.

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
