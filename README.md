# Agent-Native

## The framework for agent-native apps

Agent-Native is an open-source framework for apps where agents and UI share the same actions, state, and context.

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

- **Actions**: Define work once. Use it from every app surface: UI, agent, HTTP, MCP, A2A, and CLI.
- **Agent runtime**: Chat, tools, skills, memory, jobs, observability, and handoffs ship together.
- **Backend agnostic**: Plug in any Drizzle-supported SQL database and Nitro-compatible host.

## Apps

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
</table>

View the full app gallery at **[agent-native.com/templates](https://agent-native.com/templates)**.

## Quick Start

One command to start a new app locally.

```bash
npx @agent-native/core@latest create my-app
cd my-app
pnpm install
pnpm dev
```

### Quick Start validation and common failures

After `pnpm dev` starts, use this checklist to confirm the generated app is wired correctly before adding custom code:

1. Open the local URL printed by the dev server and verify the app shell loads without a blank page.
2. Start a new chat and send a short prompt such as `List the available actions`; the agent should respond instead of timing out.
3. Trigger one UI action from the app and confirm the same operation is visible to the agent through the shared action surface.
4. Restart `pnpm dev` once after the first successful boot; this catches missing generated files or environment assumptions early.

If the first run fails, these checks usually identify the problem quickly:

- **Node version mismatch**: Agent-Native expects the Node version declared in `package.json`. Run `node --version` and upgrade before reinstalling dependencies.
- **Wrong package manager**: Use `pnpm install`, not `npm install` or `yarn install`, so the workspace links and lockfile match the generated project.
- **Stale dependencies**: Delete `node_modules` and rerun `pnpm install` if a template was generated with an interrupted install.
- **Port already in use**: Stop the other process or rerun the dev command with the alternate port suggested by the dev server.
- **Missing model credentials**: If the UI loads but chat requests fail, check the generated `.env` file and add the provider keys required by the selected template.
- **Database startup errors**: Re-run the template's documented setup command before editing migrations; avoid changing schema files until the untouched template boots once.
- **Browser-only failures**: Open the browser devtools console and terminal output side by side; most startup issues include the route, action, or missing environment variable name in one of those logs.

For a clean retry, remove the generated directory and run `create` again with the same template flags. This is faster and safer than debugging a partially generated app.

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
