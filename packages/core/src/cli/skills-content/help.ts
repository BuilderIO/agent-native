export const HELP = `npx @agent-native/core@latest skills

Usage:
  npx @agent-native/core@latest skills list
  npx @agent-native/core@latest skills status [assets|content|design-exploration|visual-edit|visual-plan|visual-recap|visualize-repo|context-xray|scaffold] [--client codex|claude-code|pi|all] [--scope user|project] [--json]
  npx @agent-native/core@latest skills update [assets|content|design-exploration|visual-edit|visual-plan|visual-recap|visualize-repo|context-xray|scaffold] [--client codex|claude-code|pi|all] [--scope user|project] [--dry-run] [--json]
  npx @agent-native/core@latest skills add assets|content|design-exploration|visual-edit|visual-plan|visual-recap|visualize-repo|context-xray [--client codex|claude-code|cowork|cursor|opencode|github-copilot|all] [--scope user|project] [--mode hosted|local-files|self-hosted] [--mcp-url <url>] [--no-connect] [--with-github-action] [--yes] [--dry-run] [--json]
  npx @agent-native/core@latest skills add <manifest-or-app-dir|skill-repo> [--skill <name>] [--client ...] [--yes]

Examples:
  npx @agent-native/core@latest skills add assets
  npx @agent-native/core@latest skills add content --mode local-files
  npx @agent-native/core@latest skills add design-exploration
  npx @agent-native/core@latest skills add visual-edit
  npx @agent-native/core@latest skills add visual-plan
  npx @agent-native/core@latest skills add visual-recap
  npx @agent-native/core@latest skills add visualize-repo
  npx @agent-native/core@latest skills add visual-recap --with-github-action
  npx @agent-native/core@latest skills add visual-plan --mode local-files
  npx @agent-native/core@latest skills add visual-plan --mode self-hosted --mcp-url https://my-plan-app.example.com
  npx @agent-native/core@latest skills status visual-plan
  npx @agent-native/core@latest skills update visual-plan
  npx @agent-native/core@latest skills update scaffold --project
  npx @agent-native/core@latest skills add visual-plan --no-connect
  npx @agent-native/core@latest skills add context-xray --client all
  npx @agent-native/core@latest skills add assets --client claude-code
  npx @agent-native/core@latest skills add assets --mcp-url https://my-app.ngrok-free.dev
  npx @agent-native/core@latest skills add ./dist/assets-skill --client codex
  npx @agent-native/core@latest skills add BuilderIO/skills --client codex --scope project
  npx @agent-native/core@latest skills add BuilderIO/skills --with-github-action

The add command installs the SKILL.md instructions, registers the app-backed
MCP connector, and then authenticates it in one step so you do not hit an OAuth
wall on the first tool call. Hosted installs can configure Claude Code, Codex,
Claude Cowork, Cursor, OpenCode, and GitHub Copilot / VS Code; local-files
instruction installs target the shared .agents skill path used by Codex, Pi,
Cursor, OpenCode, Copilot, and similar agents, plus Claude Code's native skill
path when selected. Pass --client to narrow it. Authentication reuses
"npx @agent-native/core@latest connect": OAuth-capable clients (Claude Code,
Cursor, OpenCode, GitHub Copilot / VS Code) get URL-only entries and authenticate
inside that host, while Codex / Cowork run the browser device-code flow. In a
non-interactive shell or CI the auth step is skipped and the exact
"npx @agent-native/core@latest connect <url> --client all" command is printed instead.

Running "npx @agent-native/skills@latest add ..." uses this same shared install
flow with the broader BuilderIO skills catalog enabled. Pass --no-connect to
register MCP where possible without authenticating (leave auth to the host or run
"npx @agent-native/core@latest connect" later). Pass --mcp-url to register that connector against
a custom origin (an ngrok tunnel, a local dev server, or a self-hosted
deployment) instead of the built-in hosted default — a bare origin gets the
standard /_agent-native/mcp path appended. Use app-skill pack for marketplace
bundles and custom adapter output.

When installing visual-plan, visual-recap, or visualize-repo interactively, the
CLI asks where Plans artifacts should live: hosted Plans for shareable
links/comments, local files for "No sharing, all local.", or a
self-hosted/custom Plan app URL.
Pass --mode to choose directly. Local-files mode skips MCP registration and
auth and installs instructions that default to a no-auth block catalog fetch,
MDX folders, and the localhost bridge viewer.

When installing content with --mode local-files, the CLI installs Content
instructions and writes or updates agent-native.json with repo-backed Markdown /
MDX roots for docs, blog, content, and resources. Use a local Content app, Agent
Native Desktop, or another trusted local bridge for Content actions to read and
write those files.

When installing visual-recap interactively, the CLI offers to add the optional PR
Visual Recap GitHub Action. Pass --with-github-action to write it directly, then
run "npx @agent-native/core@latest recap setup" / "npx @agent-native/core@latest recap doctor" to configure and
verify GitHub Actions. Docs: https://www.agent-native.com/docs/pr-visual-recap.

The status/update commands inspect copied Agent Native skill folders and refresh
their instruction files from the current @agent-native/core package. In generated
apps/workspaces, "skills update scaffold --project" refreshes the framework
skills copied into the scaffold and repairs AGENTS.md / CLAUDE.md and
.agents/skills / .claude/skills compatibility links.`;
