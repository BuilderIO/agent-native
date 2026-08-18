# Agent-Native


## The framework for agentic apps

Don't pick between apps or agents. Agent-Native apps are both.

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

https://github.com/user-attachments/assets/ef51644b-6506-46d8-8083-0af7b7e5b65c

## Try an Agent-Native app

Start from a working app and let the agent evolve it. **You can customize everything.**

<table>
<tr>
<td width="33%" align="center" valign="top">

**Clips**

<a href="https://agent-native.com/templates/clips"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F189ebd9b2f2b4f0ead3b33138d4e4c10?format=webp&width=800" alt="Clips app" width="100%" /></a>

**Agent-Native Loom**

</td>
<td width="33%" align="center" valign="top">

**Plans**

<a href="https://agent-native.com/templates/plan"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fefc6a3ac908149fa92e2b9392c0bb372?format=webp&width=800" alt="Plans app" width="100%" /></a>

**Visual plan mode for coding agents**

</td>
<td width="33%" align="center" valign="top">

**Design**

<a href="https://agent-native.com/templates/design"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fe2c86908c2fa4f119ee4aa90b4823944?format=webp&width=800" alt="Design app" width="100%" /></a>

**Agent-Native Figma**

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Content**

<a href="https://agent-native.com/templates/content"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F89bcfc6106304bfbaf8ec8a7ccd721eb?format=webp&width=800" alt="Content app" width="100%" /></a>

**Agent-Native Notion/Obsidian**

</td>
<td width="33%" align="center" valign="top">

**Analytics**

<a href="https://agent-native.com/templates/analytics"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4933a80cc3134d7e874631f688be828a?format=webp&width=800" alt="Analytics app" width="100%" /></a>

**Open-Source Alternative to Amplitude and FullStory**

</td>
<td width="33%" align="center" valign="top">

**Chat**

<a href="https://agent-native.com/templates/chat"><img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6b36dc596fca4799815fa34c31e1c406?format=webp&width=800" alt="Chat app" width="100%" /></a>

**A minimal ChatGPT-style app for your own agent**

</td>
</tr>
</table>

View the [full gallery](https://agent-native.com/apps), or build from scratch with the **[framework guide](https://agent-native.com/docs/getting-started)**.

## Quick Start

One command to start a new app locally.

```bash
npx @agent-native/core@latest create my-app
cd my-app
pnpm install
pnpm dev
```

Prefer flags? `create my-app --template chat`, `--headless`, or `--standalone` skip the prompt.

See the full [getting started docs](https://agent-native.com/docs).

## Community

Join the **[Discord](https://discord.gg/qm82StQ2NC)** to ask questions, share what you're building, and get help.

## Docs

Full documentation at **[agent-native.com](https://agent-native.com)**.

## Contributing

Working on this repo itself (not just building an app with it)? See
**[DEVELOPMENT.md](./DEVELOPMENT.md)** for local setup, workspace structure,
and guard scripts.

## License

MIT
