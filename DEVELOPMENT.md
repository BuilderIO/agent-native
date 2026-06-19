# Development Guide

## Prerequisites

- **Node.js** >= 22 (v24+ recommended)
- **pnpm** >= 10 (`corepack enable` to use the version pinned in templates)

## Getting Started

```bash
git clone https://github.com/BuilderIO/agent-native.git
cd agent-native/framework
pnpm install
```

The `postinstall` script automatically builds the workspace packages other packages depend on (`shared-app-config`, `core`, `code-agents-ui`, `migrate`, `pinpoint`, `scheduling`, `embedding`, `dispatch`).

## Development

### Run all template apps

```bash
pnpm run dev:all
```

This builds core first, then starts every template app in parallel on sequential ports.

### Run a single package or template

```bash
pnpm --filter mail dev        # run the mail template
pnpm --filter calendar dev    # run the calendar template
pnpm --filter @agent-native/core dev   # watch-build core
pnpm --filter @agent-native/docs dev   # run the docs site
```

### Electron desktop app

```bash
pnpm run dev:electron          # run the desktop app
pnpm run dev:electron:apps     # run with template apps
```

## Workspace Structure

This is a pnpm monorepo. Workspaces are defined in `pnpm-workspace.yaml`.

### Packages (`packages/`)

| Package             | Description                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `core`              | Core framework library (`@agent-native/core`) -- CLI, server plugins, agent tools, Vite plugin                      |
| `code-agents-ui`    | Reusable React UI for Agent-Native Code surfaces                                                                    |
| `desktop-app`       | Electron desktop app                                                                                                |
| `dispatch`          | Workspace control plane -- vault, integrations, destinations, scheduled jobs, and cross-app delegation as a drop-in |
| `docs`              | Documentation site                                                                                                  |
| `embedding`         | Embed Agent-Native apps, pickers, and agents inside other apps                                                      |
| `frame`             | Local dev frame -- agent chat + CLI sidebar wrapping the app iframe                                                 |
| `migrate`           | Migration Workbench engine for moving existing apps to agent-native with verifiable, resumable migration runs       |
| `mobile-app`        | Mobile app                                                                                                          |
| `pinpoint`          | Visual feedback and annotation tool for agent-native web applications                                               |
| `scheduling`        | Scheduling primitives -- event types, availability, bookings, team scheduling, workflows, routing forms             |
| `shared-app-config` | Shared Agent-Native app catalog and configuration helpers                                                           |

### Templates (`templates/`)

Production-ready template apps that demonstrate the framework. Each template is a standalone app with its own `package.json`, Drizzle schema, actions, and UI.

Templates: `analytics`, `assets`, `brain`, `calendar`, `chat`, `clips`, `content`, `design`, `dispatch`, `forms`, `macros`, `mail`, `plan`, `slides`, `videos`

Each template uses the same scripts:

```bash
pnpm dev          # start dev server (via agent-native dev)
pnpm build        # production build
pnpm action <name>  # run an agent action
pnpm typecheck    # type-check
```

## Environment Variables

Templates read from `.env` in their own directory. Key variables:

| Variable               | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`         | Database connection string (see below)                           |
| `ANTHROPIC_API_KEY`    | API key for Claude (required for agent chat)                     |
| `ACCESS_TOKEN`         | Static bearer fallback for MCP/connect clients; not browser auth |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID (for Gmail, Calendar integrations)        |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                                       |

### Database options

Set `DATABASE_URL` to connect to your database. When unset, defaults to a local SQLite file at `data/app.db`.

| Provider         | Example `DATABASE_URL`                                     |
| ---------------- | ---------------------------------------------------------- |
| SQLite (default) | _(unset, or `file:./data/app.db`)_                         |
| Neon Postgres    | `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/db` |
| Supabase         | `postgresql://user:pass@db.xxx.supabase.co:5432/postgres`  |
| Turso (libSQL)   | `libsql://your-db.turso.io?authToken=...`                  |
| Plain Postgres   | `postgresql://user:pass@localhost:5432/mydb`               |

All SQL must be dialect-agnostic -- never assume SQLite.

## Key Commands

Run these from the repo root:

| Command              | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `pnpm run prep`      | Format + typecheck + test + guards in parallel (run before push) |
| `pnpm run fmt`       | Format all files with Prettier                                   |
| `pnpm run fmt:check` | Check formatting without writing                                 |
| `pnpm run typecheck` | Type-check all packages and templates                            |
| `pnpm test`          | Run tests (core + migrate + docs + dispatch + brain evals)       |
| `pnpm run guards`    | Run all security/consistency guard scripts (see Guards below)    |
| `pnpm run lint`      | Format check + typecheck                                         |

## Guards

The `guards` script chains a suite of guard scripts under `scripts/guard-*.mjs`,
each codifying a real past incident or invariant (cross-tenant data leaks,
credential leaks, `drizzle-kit push` against prod, unscoped ownable queries,
env-based credentials, the public template allow-list, etc.). Read the header
comment of each `scripts/guard-*.mjs` for what it enforces.

Enforcement:

- All guards run locally as part of `pnpm run prep`.
- In CI, the `Security guards` job (`.github/workflows/ci.yml`) runs the full
  `pnpm guards` suite on every PR. For it to block merges it must be added to
  the required-status-checks ruleset for `main`.
- There is intentionally **no pre-commit hook** (see project conventions); run
  `pnpm run prep` before pushing.

## Building

```bash
pnpm run build    # build all packages and templates
```

Individual packages:

```bash
pnpm --filter @agent-native/core build
pnpm --filter mail build
```
