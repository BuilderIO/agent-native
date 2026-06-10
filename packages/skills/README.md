# @agent-native/skills

Install skill folders from a local directory or GitHub-style source into Codex
and Claude skill directories.

```bash
npx @agent-native/skills add BuilderIO/skills
npx @agent-native/skills add BuilderIO/skills --skill quick-recap --client codex --scope project --update-instructions
npx @agent-native/skills add ./skills --skill visual-recap --client both --with-github-action
```

Use `--skill <name>` one or more times to select specific skills, or omit it in
an interactive terminal to choose from a prompt. Use `--client codex`,
`--client claude-code`, or `--client both` to choose install targets. Add
`--update-instructions` to append an idempotent managed block to `AGENTS.md`
and/or `CLAUDE.md` for instruction-style skills.
