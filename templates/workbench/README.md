# Workbench

A visual command center for AI-assisted work. Runs as a standalone web app, as an MCP App inside Claude / ChatGPT / Cursor / Codex / Claude Code, and as a forkable template teams can self-host.

The **Attention Queue** is the home; rooms (**PRs**, **Agent Runs**, **Custom Tools**) are the depth.

## What's here

- **`app/`** — React Router 7 frontend. Top nav with Queue / PRs / Runs / Tools tabs, agent sidebar mounted, real-time sync via `useDbSync`.
- **`server/`** — Nitro server. Drizzle schema for Workbench-owned tables, agent-chat plugin, deep-link router.
- **`actions/`** — Agent operations. Each file is auto-mounted at `/_agent-native/actions/:name` and exposed as an MCP tool. (Empty in the scaffold pass — room agents add the actions.)
- **`PRD.md`** — Product requirements for v1.

## Running locally

```bash
# from this directory
pnpm dev
```

Default dev port: **8104**.

`.env` is loaded automatically. Set `DATABASE_URL` (defaults to local SQLite) to point at Neon, Turso, or any libSQL/Postgres-compatible database.

## Building

```bash
pnpm build       # Nitro production build
pnpm typecheck   # Type check
pnpm test        # Vitest (passes with no tests in the scaffold)
```

## Conventions

- TypeScript everywhere. No `.js` / `.mjs`.
- Shadcn/ui primitives only — never custom dropdowns / modals.
- Tabler icons only — never emojis as icons, never robot or sparkle icons.
- Additive migrations only — never `drizzle-kit push`, never drop or rename.
- Shared workspace integrations for GitHub / Sentry — never Workbench-owned OAuth.

See [`AGENTS.md`](./AGENTS.md) for the full agent operating guide and the [`PRD.md`](./PRD.md) for the product spec.
