# Development Guide

## Prerequisites

- **Node.js** >= 22 (v24+ recommended)
- **pnpm** >= 10 (`corepack enable` to use the version pinned in templates)

## Getting Started

```bash
git clone https://github.com/BuilderIO/agent-native.git
cd agent-native
pnpm install
```

The `postinstall` script automatically builds the workspace packages other packages depend on (`shared-app-config`, `toolkit`, `core`, `code-agents-ui`, `migrate`, `pinpoint`, `scheduling`, `embedding`, `dispatch`).

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

Templates: `analytics`, `assets`, `brain`, `calendar`, `chat`, `clips`, `content`, `design`, `dispatch`, `forms`, `macros`, `mail`, `plan`, `slides`

Each template uses the same scripts:

```bash
pnpm dev          # start dev server (via agent-native dev)
pnpm build        # production build
pnpm action <name>  # run an agent action
pnpm typecheck    # type-check
```

## Environment Variables

Templates read from `.env` in their own directory, and workspace development
loads the root `.env` before app-local values. The complete repository-wide
index is [docs/environment-variables.md](docs/environment-variables.md). It
covers framework, template, local/test, build/deploy, CI-only, and credential
variables, and is checked by `pnpm run guard:env-documentation`.

For the most common setup variables, start with `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `A2A_SECRET`, and the provider key
needed by the selected agent engine. User-, organization-, and workspace-scoped
credentials should be stored through the scoped secret/credential store rather
than added to `.env`.

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

| Command              | Description                                                            |
| -------------------- | ---------------------------------------------------------------------- |
| `pnpm run prep`      | Format + typecheck + test + guards in parallel (run before push)       |
| `pnpm run fmt`       | Format all files with Prettier                                         |
| `pnpm run fmt:check` | Check formatting without writing                                       |
| `pnpm run typecheck` | Type-check all packages and templates                                  |
| `pnpm test`          | Run tests across every workspace package/template with a `test` script |
| `pnpm run guards`    | Run all security/consistency guard scripts (see Guards below)          |
| `pnpm run lint`      | Format check + typecheck                                               |

## Concurrency

Each runner sizes itself off the whole machine, which oversubscribes the CPU
when several agent sessions or checkouts run checks at once. Every lid has an
env override:

| Variable                                                | Controls                            | Default                         |
| ------------------------------------------------------- | ----------------------------------- | ------------------------------- |
| `VITEST_CONCURRENCY`, `AGENT_NATIVE_VITEST_CONCURRENCY` | Workers per vitest suite            | `25%` of cores                  |
| `GUARD_CONCURRENCY`, `AGENT_NATIVE_GUARD_CONCURRENCY`   | Guards running in parallel          | `cores / 2`, clamped to 2--6    |
| `WORKSPACE_CONCURRENCY`, `PNPM_WORKSPACE_CONCURRENCY`   | Packages running a task in parallel | per-profile, derived from cores |

`VITEST_CONCURRENCY` takes a percentage (`25%`) or a worker count (`2`). The
base config every vitest config merges in ships from
`@agent-native/core/vitest-config`; templates and examples import it by package
name, and `packages/*` go through the `vitest.shared.ts` re-export at the repo
root so they need no dependency on core. A package that needs a different value
sets `test.maxWorkers` in its own config; that wins the merge.

Template configs must import the package path, never the root re-export.
`agent-native create` extracts a template directory with `--strip-components=1`,
so anything a template reaches for above its own directory resolves to nothing
in the scaffolded app.

Vitest's own `VITEST_MAX_WORKERS` still works for a one-off integer, but never
give it a percentage: vitest applies it as `Number.parseInt`, so `25%` becomes
25 workers rather than a quarter of the machine (vitest#9631). The config
throws rather than let that through.

## Guards

The `guards` script (`scripts/run-guards.ts`) runs the fixed list of checks
registered there. Most are `scripts/guard-*` scripts (`.mjs` and `.ts`), but a
few -- `guard:workspace-skills`, `guard:plan-skills`, `guard:plan-marketplace`
-- run `scripts/sync-*.ts --check` and don't match the `guard-*` filename
glob. `scripts/run-guards.ts` is the authoritative registry of what runs;
each check codifies a real past incident or invariant (cross-tenant data
leaks, credential leaks, `drizzle-kit push` against prod, unscoped ownable
queries, env-based credentials, the public template allow-list, etc.). Read
the header comment of each guard script for what it enforces.

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
