# Agent-Native

**The agentic application framework**

Build autonomous agents with intuitive UIs.

[Documentation](https://agent-native.com/docs) · [Getting started](https://agent-native.com/docs/getting-started) · [Examples](https://agent-native.com/apps) · [Discord](https://discord.gg/qm82StQ2NC)

[![npm version](https://img.shields.io/npm/v/%40agent-native%2Fcore)](https://www.npmjs.com/package/@agent-native/core)
[![Node.js compatibility](https://img.shields.io/node/v/%40agent-native%2Fcore)](https://nodejs.org)

Agent-Native is an open-source TypeScript framework for building agents that pair autonomous work with a purpose-built UI. Define each capability once as an [action](https://agent-native.com/docs/actions-overview): the agent uses it as a tool, and the UI calls it from code.

## Quick start

You need [Node.js](https://nodejs.org) 22.22 or later, [pnpm](https://pnpm.io), and an LLM connection.

```bash
npx @agent-native/core@latest create my-agent --standalone --template chat
cd my-agent
pnpm install
pnpm dev
```

The browser UI opens at `http://localhost:8080`. Select **Continue as local dev**, then connect Builder.io, your Anthropic or OpenAI API key, or a local Ollama model.

Ask the agent:

> Call the hello action for Alex.

The agent runs the included `hello` action and replies with `Hello, Alex!`. Follow the [getting started guide](https://agent-native.com/docs/getting-started) to call the same action from the UI and create your own.

## Why build agents with UIs?

Coding agents work with more than a text box. Their environment provides context, tools, files, tests, and previews that make their capabilities and results visible.

Knowledge work needs that same kind of environment. A UI shows what an agent can do and gives people familiar ways to inspect, edit, approve, and share its work.

## How Agent-Native works

- **[Shared actions](https://agent-native.com/docs/actions-overview).** The agent calls each capability as a tool, and the UI calls it from code. Both paths use the same validation, permissions, and implementation.
- **[Shared data](https://agent-native.com/docs/server-database).** Work done by the agent appears in the UI, and work done in the UI is available to the agent.
- **[Shared application state](https://agent-native.com/docs/context-awareness).** The agent receives relevant UI state, such as the current page, selected record, or active view.

The agent does not click through the UI. It works through the same action layer as the UI.

### Example: a shared action

Create `actions/hello.ts`:

```ts
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Return a friendly greeting.",
  schema: z.object({
    name: z.string().default("world").describe("Name to greet"),
  }),
  http: { method: "GET" },
  run: async ({ name }) => {
    return { message: `Hello, ${name}!` };
  },
});
```

The agent receives `hello` as a tool. React calls the same function with `useActionQuery("hello", { name: "Alex" })`. Agent-Native also exposes it through HTTP, MCP, A2A, and the CLI.

## Included

- **[Agent chat](https://agent-native.com/docs/agent-surfaces):** Let people delegate work, ask questions, and review results in the same UI.
- **[Authentication and permissions](https://agent-native.com/docs/authentication):** Control who can access and change shared work.
- **[Skills and memory](https://agent-native.com/docs/agent-resources):** Give agents reusable expertise and persistent context.
- **[Automations](https://agent-native.com/docs/automations):** Run agent work on schedules or events.
- **[Agent teams](https://agent-native.com/docs/agent-teams):** Delegate work to specialist agents in the same workspace or across connected agents.

Bring your LLM, SQL database, tools, and infrastructure. Everything you build stays yours.

See Agent-Native in action:

https://github.com/user-attachments/assets/ef51644b-6506-46d8-8083-0af7b7e5b65c

## Open-source agents

Start from one of these agents or use it as an example for your own.

<table>
<tr>
<td width="33%" align="center" valign="top">

**Clips**

<a href="https://agent-native.com/apps/clips/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F4dc9c87b9a224132855e1cb68cd89f9e?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F462fdb643d5d403a8c54540c5c3292f6?format=webp&width=800" alt="Clips app screenshot" width="100%">
</picture>
</a>

Record and understand meetings, screens, and voice notes.

</td>
<td width="33%" align="center" valign="top">

**Design**

<a href="https://agent-native.com/apps/design/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F072f66a3e360464fb48617670ceee46f?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fc9f693f170294bde8ebc733cff368af9?format=webp&width=800" alt="Design app screenshot" width="100%">
</picture>
</a>

Generate and refine interactive designs.

</td>
<td width="33%" align="center" valign="top">

**Slides**

<a href="https://agent-native.com/apps/slides/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F710f5b7586cc41deaa0e6f8de658a499?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F6223a64717a04931a6f509696019f48b?format=webp&width=800" alt="Slides app screenshot" width="100%">
</picture>
</a>

Create and edit on-brand presentations.

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Analytics**

<a href="https://agent-native.com/apps/analytics/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fba632b39758d448594f7e5d2403e5d0f?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F976ea93771b64b9e8c1b3eb12e606e07?format=webp&width=800" alt="Analytics app screenshot" width="100%">
</picture>
</a>

Ask questions of your data and build dashboards.

</td>
<td width="33%" align="center" valign="top">

**Calendar**

<a href="https://agent-native.com/apps/calendar/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F91d4c18d256b49e6bca24c23ce90a4f2?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F8d9d48bb2f1d498f9601ac28c64edd4c?format=webp&width=800" alt="Calendar app screenshot" width="100%">
</picture>
</a>

Find time, schedule events, and manage bookings.

</td>
<td width="33%" align="center" valign="top">

**Mail**

<a href="https://agent-native.com/apps/mail/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F216aaef9859144ffa3eb9498fa1132da?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F064aee3ec5cd44879b9c186f63a6d6f4?format=webp&width=800" alt="Mail app screenshot" width="100%">
</picture>
</a>

Prioritize email, draft replies, and follow up.

</td>
</tr>
<tr>
<td width="33%" align="center" valign="top">

**Assets**

<a href="https://agent-native.com/apps/assets/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fde445dd867744e9bac5d3e5d04c903b2?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fac5701f0871f4edbb06fa9cdb12b166e?format=webp&width=800" alt="Assets app screenshot" width="100%">
</picture>
</a>

Create and organize on-brand media.

</td>
<td width="33%" align="center" valign="top">

**Content**

<a href="https://agent-native.com/apps/content/">
<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa9f30380b03b4fd1a7d2ab371ddfd798?format=webp&width=800">
<img src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F979f792c79834470a513a9d9b733dd84?format=webp&width=800" alt="Content app screenshot" width="100%">
</picture>
</a>

Draft, organize, and publish content.

</td>
<td width="33%"></td>
</tr>
</table>

Explore the [full app gallery](https://agent-native.com/apps), or start with the [framework guide](https://agent-native.com/docs/getting-started).

## Documentation and community

- Read the [documentation](https://agent-native.com/docs).
- Join [Discord](https://discord.gg/qm82StQ2NC) to ask questions, share what you're building, and get help.

## Contributing

Working on this repository itself? See [DEVELOPMENT.md](https://github.com/BuilderIO/agent-native/blob/main/DEVELOPMENT.md) for local setup, workspace structure, and guard scripts.

## License

MIT
