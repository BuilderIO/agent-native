# @agent-native/skills

Install BuilderIO skill folders into Codex and Claude skill directories.

```bash
npx @agent-native/skills@latest add
npx @agent-native/skills@latest add --skill quick-recap --client codex --scope project --update-instructions
npx @agent-native/skills@latest add --skill visual-recap --client all --with-github-action
npx @agent-native/skills@latest add --skill visualize-repo --mode local-files
npx @agent-native/skills@latest add --skill visual-plan --mode local-files
npx @agent-native/skills@latest add --skill content --mode local-files --scope project
npx @agent-native/skills@latest update scaffold --project
```

Use `--skill <name>` one or more times to select specific skills, or omit it in
an interactive terminal to choose from a prompt. The prompt puts `visual-plan`
`visual-recap`, and `visualize-repo` first and preselects those by default. Use
`--client codex`, `--client claude-code`, or `--client all` to choose install
targets; omitted `--client` defaults to all supported clients. For
`visual-plan`, `visual-recap`, `visualize-repo`, and `content`, use
`--mode hosted`, `--mode local-files`, or
`--mode self-hosted --mcp-url <url>` to choose hosted sharing, local-file
workflows, or your own app. Add `--update-instructions` to append an idempotent
managed block to `AGENTS.md` and/or `CLAUDE.md` for instruction-style skills.

On first run, `npx` itself may be quiet while it downloads the package before
this CLI can print anything. For unattended installs, pass explicit flags such
as `--skill`, `--client`, `--scope`, and `--no-connect` to skip prompts and
leave MCP authentication for a later `connect` command.

Skill content comes from `BuilderIO/skills@main` at install/list time for plain
skill installs. Explicit app-backed installs such as `visual-plan`,
`visual-recap`, `visualize-repo`, and `content` delegate to
`@agent-native/core` so mode selection, MCP registration, and local-files
instructions stay in one framework-owned flow.

Generated Agent Native apps and workspaces can refresh their framework-provided
`.agents/skills` from the latest installed CLI with:

```bash
npm run skills:update
# or
npx @agent-native/core@latest skills update scaffold --project
```

`AGENTS.md` and `.agents/skills` are the canonical files. The scaffold command
also repairs Claude compatibility links (`CLAUDE.md` and `.claude/skills`) when
the host filesystem supports them, with copy fallback where symlinks are
blocked.
