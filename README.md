# Agent-Native

## The framework for agentic apps

Agent-Native is an open-source framework for rapidly building robust applications with agents at their core.

```ts
// One action powers every app surface: UI, agent, HTTP, MCP, A2A, and CLI.
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

- **[Actions](https://agent-native.com/docs/actions)**: Define work once. Use it from every app surface: UI, agent, HTTP, MCP, A2A, and CLI.
- **[Agent runtime](https://agent-native.com/docs/agent-surfaces)**: Chat, tools, skills, memory, jobs, observability, and handoffs ship together.
- **[Backend agnostic](https://agent-native.com/docs/database)**: Plug in any Drizzle-supported SQL database and Nitro-compatible host.
- **[Toolkits](https://agent-native.com/docs/agent-native-toolkit)**: Reusable building blocks for collaboration, sharing, settings, teams, and observability.

## Don't pick between apps or agents.

Agent-native apps are both

|                   | SaaS Tools         | Raw AI Agents           | Internal Tools             | Agent-Native App        |
| ----------------- | ------------------ | ----------------------- | -------------------------- | ----------------------- |
| **UI**            | Polished but rigid | None                    | Mixed quality              | Full UI, fork & go      |
| **AI**            | Bolted on          | Powerful                | Shallowly connected        | Agent-first, integrated |
| **Customization** | Can't              | Instructions and skills | Full, but high maintenance | Agent modifies the app  |
| **Ownership**     | Rented             | Somewhat yours          | You own the code           | You own the code        |

## Try an Agent-Native app

Fork a working app and let the agent evolve it. **You can customize everything.**

<table>
<tr>
<td width="33%" align="center" valign="top">

**Clips**

<a href="https://agent-native.com/templates/clips"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F189ebd9b2f2b4f0ead3b33138d4e4c10?format=webp&width=800" alt="Clips app" width="100%" /></a>

**Agent-Native Loom + Jam**

Record your screen with auto-transcripts and captured browser debug logs, share a link, and let an agent read the transcript, see timestamped frames, and fix the bug.

</td>
<td width="33%" align="center" valign="top">

**Plans**

<a href="https://agent-native.com/templates/plan"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fefc6a3ac908149fa92e2b9392c0bb372?format=webp&width=800" alt="Plans app" width="100%" /></a>

**Visual plan mode for coding agents**

Install `/visual-plan` and `/visual-recap` so your coding agent can plan before it builds and recap changes after they land. High-level code reviews with diagrams, wireframes, annotations, and review links.

</td>
<td width="33%" align="center" valign="top">

**Design**

<a href="https://agent-native.com/templates/design"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe2c86908c2fa4f119ee4aa90b4823944?format=webp&width=800" alt="Design app" width="100%" /></a>

**Agent-Native design prototyping**

Generate interactive HTML prototypes, compare variants, refine controls, and export the result.

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Content**

<a href="https://agent-native.com/templates/content"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800" alt="Content app" width="100%" /></a>

**Open-source Obsidian for MDX**

Edit local Markdown/MDX files, generate rich interactive custom blocks, and draft, rewrite, or publish with an agent.

</td>
<td width="33%" align="center" valign="top">

**Slides**

<a href="https://agent-native.com/templates/slides"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F2c09b451d40c4a74a89a38d69170c2d8?format=webp&width=800" alt="Slides app" width="100%" /></a>

**Agent-Native Google Slides, Pitch**

Generate and edit React-based presentations via prompt or point-and-click.

</td>
<td width="33%" align="center" valign="top">

**Analytics**

<a href="https://agent-native.com/templates/analytics"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800" alt="Analytics app" width="100%" /></a>

**Agent-Native Amplitude, Mixpanel**

Connect analytics data sources, prompt for real charts, and build reusable dashboards.

</td>
</tr>
<tr>
<td colspan="3" align="center" valign="top">

**Chat**

<a href="https://agent-native.com/templates/chat"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b36dc596fca4799815fa34c31e1c406?format=webp&width=800" alt="Chat app" width="66%" /></a>

**A minimal ChatGPT-style app for your own agent**

Chat-first app scaffold with durable threads, actions, auth, live sync, and a clean path to add screens or plug in your own agent backend.

</td>
</tr>
</table>

**Build from scratch.** Use the [framework guide](https://agent-native.com/docs/getting-started).

View the full app gallery at **[agent-native.com/apps](https://agent-native.com/apps)**.

## Quick Start

One command to start a new app locally.

```bash
npx @agent-native/core@latest create my-app
cd my-app
pnpm install
pnpm dev
```

`create` first asks how you want to start:

- **Full app(s)**: clone one or more complete apps into a workspace. Pick Mail + Calendar + Forms and you get all three wired up and sharing auth.
- **Chat**: a single app with a minimal chat UI and the browser shell already wired, the simplest way to get a UI.
- **Headless**: a single action-first app with no UI shell. The CLI walks you through calling your first action and agent, and you can add a UI later.

Prefer flags? `create my-app --template mail`, `--headless`, or `--standalone` skip the prompt.

See the full [getting started docs](https://agent-native.com/docs).

## Community

Join the **[Discord](https://discord.gg/qm82StQ2NC)** to ask questions, share what you're building, and get help.

## Docs

Full documentation at **[agent-native.com](https://agent-native.com)**.

## License

MIT
