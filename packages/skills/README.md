# @agent-native/skills

Install BuilderIO skill folders into Codex and Claude skill directories.

```bash
npx @agent-native/skills add
npx @agent-native/skills add --skill quick-recap --client codex --scope project --update-instructions
npx @agent-native/skills add --skill visual-recap --client all --with-github-action
```

Use `--skill <name>` one or more times to select specific skills, or omit it in
an interactive terminal to choose from a prompt. Use `--client codex`,
`--client claude-code`, or `--client all` to choose install targets. Add
`--update-instructions` to append an idempotent managed block to `AGENTS.md`
and/or `CLAUDE.md` for instruction-style skills.
