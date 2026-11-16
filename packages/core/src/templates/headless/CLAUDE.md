# {{APP_NAME}} - Agent Guide

This headless app starts with callable actions, not a browser UI. Runtime state,
auth, and framework stores use PostgreSQL; local development uses PGlite at
`DATABASE_URL=pglite:./data/pglite`, while hosted deployments need persistent
PostgreSQL.

## Skills

Read linked guides before changing that area; use `rg --hidden --follow` to
search hidden or linked directories. This scaffold ships
`.agents/skills/actions/SKILL.md`,
`.agents/skills/adding-a-feature/SKILL.md`,
`.agents/skills/agent-native-docs/SKILL.md`,
`.agents/skills/agent-native-toolkit/SKILL.md`,
`.agents/skills/customizing-agent-native/SKILL.md`,
`.agents/skills/delegate-to-agent/SKILL.md`,
`.agents/skills/performance/SKILL.md`,
`.agents/skills/reliable-mutations/SKILL.md`,
`.agents/skills/secrets/SKILL.md`,
`.agents/skills/security/SKILL.md`,
`.agents/skills/self-modifying-code/SKILL.md`,
`.agents/skills/sharing/SKILL.md`, and
`.agents/skills/storing-data/SKILL.md`.

## Core rules

- Put app operations in `actions/` with Zod validation and structured results.
  `actions/run.ts` dispatches `pnpm action ...`; it is not an app action. Do not
  create REST wrappers around actions.
- SQL stores structured records and references. Keep schemas PostgreSQL-specific;
  store large payloads in configured file/blob storage. Never hardcode keys,
  tokens, webhook URLs, or private/customer data.
- For external integrations, inspect the workspace/provider connection catalog
  first; reuse its scoped resolver before app-local vault/OAuth/settings.
- There is no `app/` UI shell. For browser UI, use the Chat template as the
  on-ramp; `agent-native add` is for integration blueprints.
- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.

## Docs and framework changes

Use local version-matched package docs only (no web research):
`pnpm action docs-search --query "<topic>"`,
`pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`,
`pnpm action source-search --query "<pattern>"`, and
`pnpm action source-search --path <path>`. Docs are in
`node_modules/@agent-native/core/docs`; optional template examples are in
`node_modules/@agent-native/core-corpus/corpus` (install the matching version
with `pnpm add -D @agent-native/core-corpus@<installed-core-version>` if needed).
If the runner is unavailable, read `node_modules/@agent-native/core/docs/AGENTS.md`
and search its `content/` directory with `rg`.

Before building common workspace or agent UI, read `agent-native-toolkit`; for
supported UI customization, read `customizing-agent-native`. Use configure → compose → eject
the smallest unit; preview ejection before applying and preserve protected
contracts. To upgrade, use `pnpm upgrade:agent-native` or
`npx @agent-native/core@latest upgrade`; after a manual core bump,
`pnpm skills:update` refreshes scaffold skills. Do not patch dependencies or
edit `node_modules/@agent-native/*`; fix app code or ask. See
`self-modifying-code`.

## Actions

| Action | Args | Purpose |
| --- | --- | --- |
| `hello` | `[--name <name>]` | Return a greeting |
| `db-schema` | | Show SQL schema |
| `db-query` | `--sql "SELECT"` | Run a scoped SELECT |

Raw SQL writes are not exposed by default. Add typed write actions or opt into
`databaseTools: "write"` only for deliberate maintenance. Run
`pnpm action hello '{"name":"Builder"}'` and
`pnpm agent "Call the hello action for Builder and explain the result"` from
the app root.
