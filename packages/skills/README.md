# @agent-native/skills

Install BuilderIO skill folders into Codex and Claude skill directories.

```bash
npx @agent-native/skills@latest add
npx @agent-native/skills@latest add --skill quick-recap --client codex --scope project --update-instructions
npx @agent-native/skills@latest add --skill visual-recap --client all --with-github-action
npx @agent-native/skills@latest add --skill visual-plan --mode local-files
```

Use `--skill <name>` one or more times to select specific skills, or omit it in
an interactive terminal to choose from a prompt. The prompt puts `visual-plan`
and `visual-recap` first and preselects only those by default. Use
`--client codex`, `--client claude-code`, or `--client all` to choose install
targets; omitted `--client` defaults to all supported clients. For
`visual-plan` and `visual-recap`, use `--mode hosted`, `--mode local-files`, or
`--mode self-hosted --mcp-url <url>` to choose hosted sharing, all-local text
files, or your own Plan app. Add `--update-instructions` to append an idempotent
managed block to `AGENTS.md` and/or `CLAUDE.md` for instruction-style skills.

Skill content comes from `BuilderIO/skills@main` at install/list time for plain
skill installs. Explicit `visual-plan` / `visual-recap` installs delegate to
`@agent-native/core` so Plan mode selection, MCP registration, and local-files
instructions stay in one framework-owned flow.
