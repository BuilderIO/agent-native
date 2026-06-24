# {{APP_NAME}} - Agent Guide

This is a headless Agent Native app. It starts with actions instead of a browser UI, so the first useful primitive is callable from the agent, CLI, and action runtime.

This app is not stateless. The Agent Native runtime uses SQL-backed stores for app state, settings, auth/session data, resources, and other framework capabilities when those surfaces are used. Local development can use SQLite at `data/app.db`; hosted or long-lived deployments should set `DATABASE_URL` to a persistent database.

## Working In This App

- Prefer actions in `actions/` for every app operation. Do not create REST wrappers around actions.
- Keep action inputs validated with Zod and return structured data, not JSON strings.
- Do not hardcode API keys, tokens, webhook URLs, private data, or credential-looking literals.
- `actions/run.ts` is the CLI dispatcher for `pnpm action ...`, not an app
  action. Leave it in place and add callable primitives as separate
  `actions/<name>.ts` files.
- There is intentionally no `app/` UI shell in this scaffold. When you need a browser UI, use the Chat template as the UI on-ramp and keep `agent-native add` for integration blueprints.

## Framework Docs Lookup

Version-matched Agent Native docs ship with `@agent-native/core` in
`node_modules/@agent-native/core/docs`. A source-only corpus of core and
first-party template patterns ships in `node_modules/@agent-native/core/corpus`.

- Use `pnpm action docs-search --query "<topic>"` to search framework docs,
  bundled `AGENTS.md`, and codebase skills.
- Use `pnpm action docs-search --slug <slug>` to read a full page. Start with
  `actions`, `pure-agent-apps`, `automations`, `recurring-jobs`,
  `a2a-protocol`, `external-agents`, `mcp-protocol`, `database`, `sharing`,
  and `security` for advanced headless workflows.
- Use `pnpm action docs-search --list` to see everything available.
- Use `pnpm action source-search --query "<pattern>"` when you need current
  implementation examples or template best practices, and
  `pnpm action source-search --path <path>` to read a specific corpus file.
- If the action runner is unavailable, read
  `node_modules/@agent-native/core/docs/AGENTS.md` and search
  `node_modules/@agent-native/core/docs/content/` directly with `rg`. Search
  `node_modules/@agent-native/core/corpus/` for source examples.

Read these local package docs before implementing advanced Agent Native
features. Prefer this app's own `AGENTS.md` for app-specific rules, then use
the corpus for reusable framework/template patterns.
After updating `@agent-native/core`, run `pnpm skills:update` or
`npx @agent-native/core@latest skills update scaffold --project` from the app
root to refresh framework-provided `.agents/skills` and repair `CLAUDE.md` /
`.claude/skills` compatibility links.

## Actions

| Action      | Args              | Purpose                 |
| ----------- | ----------------- | ----------------------- |
| `hello`     | `[--name <name>]` | Return a greeting       |
| `db-schema` |                   | Show SQL schema         |
| `db-query`  | `--sql "SELECT"`  | Run a scoped SELECT     |
| `db-exec`   | `--sql "UPDATE"`  | Last-resort maintenance |

Run actions from this app root:

```bash
pnpm action hello '{"name":"Builder"}'
```

Run the app-agent loop against those actions:

```bash
pnpm agent "Call the hello action for Builder and explain the result"
```

## Skills

Skills in `.agents/skills/` provide detailed guidance. Read
`.agents/skills/agent-native-docs/SKILL.md` before using advanced Agent Native
framework APIs, generated-app features, automations, A2A, sharing, or MCP.
