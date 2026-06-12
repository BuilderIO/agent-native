# @agent-native/skills

Install BuilderIO skill folders into Codex and Claude skill directories.

```bash
npx @agent-native/skills@latest add
npx @agent-native/skills@latest add --skill quick-recap --client codex --scope project --update-instructions
npx @agent-native/skills@latest add --skill visual-recap --client all --with-github-action
```

Use `--skill <name>` one or more times to select specific skills, or omit it in
an interactive terminal to choose from a prompt. Use `--client codex`,
`--client claude-code`, or `--client all` to choose install targets; omitted
`--client` defaults to all supported clients. Add `--update-instructions` to
append an idempotent managed block to `AGENTS.md` and/or `CLAUDE.md` for
instruction-style skills.

Skill content comes from `BuilderIO/skills@main` at install/list time. That
means adding or updating public skills such as `quick-recap` or
`efficient-fable` in the skills repo is picked up by this CLI without publishing
a new `@agent-native/skills` package. `visual-plan` and `visual-recap` are also
installed from `BuilderIO/skills`; Agent Native syncs those two into the public
repo from the framework source of truth.
