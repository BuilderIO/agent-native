# {{APP_NAME}} — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via scripts. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with polling for real-time sync.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Script            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view                              | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

## Agent Operations

**Always run `pnpm script view-screen` first** before taking any action.

### Scripts

| Script        | Args                              | Purpose                         |
| ------------- | --------------------------------- | ------------------------------- |
| `view-screen` |                                   | See current UI state            |
| `navigate`    | `--view <name>` or `--path <url>` | Navigate the UI                 |
| `hello`       | `[--name <name>]`                 | Example script                  |
| `db-schema`   |                                   | Show all tables, columns, types |
| `db-query`    | `--sql "SELECT ..."`              | Run a SELECT query              |
| `db-exec`     | `--sql "INSERT ..."`              | Run INSERT/UPDATE/DELETE        |

## Skills

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `scripts`             | Before creating or modifying scripts                           |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |

## When Adding Features

As you build out this app, follow this checklist for each new feature:

1. **Add navigation state entries** -- extend `use-navigation-state.ts` to track new routes
2. **Enhance view-screen** -- make the view-screen script return relevant context for the new view
3. **Create domain scripts** -- add scripts for CRUD operations on new data models
4. **Create domain skills** -- add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations
5. **Update this AGENTS.md** -- add the new scripts, state keys, and common tasks

### Authentication

Auth is automatic and environment-driven:

- **Dev mode**: Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`.
- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts.

Use `getSession(event)` server-side and `useSession()` client-side.

---

For code editing and development guidance, read `DEVELOPING.md`.
