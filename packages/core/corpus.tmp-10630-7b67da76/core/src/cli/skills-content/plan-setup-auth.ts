/**
 * Setup/auth block for the `/visual-plan` skill. Interpolated into
 * `VISUAL_PLANS_SKILL_MD` below so the install + one-step authenticate
 * instructions are single-sourced. The materialized SKILL.md copies under
 * `templates/plan/.agents/skills/*`, top-level `skills/*`, and
 * `.agents/skills/*` are guarded byte-identical by `skills.sync.spec.ts`.
 */
export const PLAN_SETUP_AUTH_MD = `## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and runs
auth/setup for the selected local client(s) in the same step (a one-time browser
sign-in at setup — this is intended), so the first tool call in that client does
not hit an OAuth wall:

\`\`\`bash
npx @agent-native/core@latest skills add visual-plans
\`\`\`

After that, \`/visual-plan\`, \`/visual-recap\`, and \`/visualize-repo\` are the
installed slash commands. If you only need one command, use
\`skills add visual-plan\`, \`skills add visual-recap\`, or
\`skills add visualize-repo\` instead. The other planning modes
(\`create-ui-plan\`, \`create-prototype-plan\`, \`create-plan-design\`,
\`create-visual-questions\`) are MCP tools reachable from \`/visual-plan\`, not
separate slash commands. Pass \`--no-connect\` to register the connector without
authenticating, then run
\`npx @agent-native/core@latest connect https://plan.agent-native.com --client all\`
whenever you are ready, or choose a narrower \`--client\`. Auth and MCP tool
loading are per client config/session.

**Local-only / text installs.** If the user wants no sharing and all local files,
install with \`--mode local-files\`:

\`\`\`bash
npx @agent-native/core@latest skills add visual-plans --mode local-files
\`\`\`

This mode does not register the Plan MCP connector. Before authoring structured
MDX, fetch the no-auth, schema-only block catalog with
\`npx @agent-native/core@latest plan blocks --out plan-blocks.md\`, read that file,
write the MDX folder locally, run \`plan local check\`, then run \`plan local serve\`.
For repo-wide visual docs, run
\`npx @agent-native/core@latest visualize-repo --open\` to create/update
\`agent-native.json\`, seed \`.agent-native/visual-docs/repo-overview\`, and open
the local bridge.
Plain text skill
installs (Vercel Skills CLI, copied GitHub files, etc.) can follow that same
local flow if \`@agent-native/core\` is available. Text alone cannot register
MCP tools; hosted/shareable Plans still need the Agent-Native CLI
install/reconnect step above.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For no-account, no-DB plan storage, use local-files mode and the local bridge
command. The optional \`plan blocks\` lookup reads only public schema metadata.
If network access is unavailable, use the bundled references and a local Plan
app/runtime for validation.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Stop and give the user the reconnect step for the
client they are using: Codex/Codex Desktop should run
\`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex\`
and start a new Codex session; Claude Code should run \`/mcp\` and choose
Authenticate/Reconnect for the plan connector, or run the reconnect command with
\`--client claude-code\` and restart Claude. To refresh every local client config
that already has the Plan entry, use \`--client all\`, then restart/reload each
client. Reconnect re-authenticates WITHOUT reinstalling and finds the entry by
URL regardless of connector name. Never reinstall from scratch just to fix auth.
Continue once the connector is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.`;
