# {{APP_NAME}} — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with polling for real-time sync.

### Core Principles

1. **Shared SQL database** -- All app state lives in SQL (SQLite locally, cloud DB via `DATABASE_URL` in production). Core stores: `application_state`, `settings`, `oauth_tokens`, `sessions`, `resources`.
2. **All AI through agent chat** -- No inline LLM calls. UI delegates to the AI via `sendToAgentChat()` / `agentChat.submit()`.
3. **Actions for agent operations** -- `pnpm action <name>` dispatches to callable action files in `actions/`.
4. **Polling for real-time sync** -- Database writes trigger version counter increments that the UI polls to stay in sync.
5. **Agent can update code** -- The agent can modify this app's source code directly.

### Authentication

Auth is automatic and environment-driven:

- **Dev mode**: Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`.
- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts.

Use `getSession(event)` server-side and `useSession()` client-side.

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** -- user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** -- user preferences, corrections, and patterns. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

| Action            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view                              | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

The `navigation` key is written by the UI whenever the route changes. The `navigate` key is a one-shot command: the agent writes it, the UI reads and executes the navigation, then deletes it.

## Agent Operations

**Always know what the user is currently viewing before you edit anything.** The user's view can change mid-conversation. Stale IDs lead to editing the wrong record.

### If you are the built-in agent-chat agent

A `<current-screen>` block is auto-injected into every user message with the current view, IDs, and selected item. You can trust it for the first action of a turn without calling `view-screen`. If the user says "this" or "now do X" after several tool calls, the user may have navigated — call `view-screen` again for a fresh snapshot.

### If you are an external CLI agent (Claude Code, Codex, Cursor, etc.)

You do NOT get auto-injected screen state. **Call `pnpm action view-screen` at the start of every task and before any edit** so you're acting on the IDs the user currently sees, not what was open earlier. Do not rely on cached context from previous turns.

### Actions

| Action        | Args                              | Purpose                         |
| ------------- | --------------------------------- | ------------------------------- |
| `view-screen` |                                   | See current UI state            |
| `navigate`    | `--view <name>` or `--path <url>` | Navigate the UI                 |
| `hello`       | `[--name <name>]`                 | Example script                  |
| `db-schema`   |                                   | Show all tables, columns, types |
| `db-query`    | `--sql "SELECT ..."`              | Run a SELECT query              |
| `db-exec`     | `--sql "INSERT ..."`              | Run INSERT/UPDATE/DELETE        |

## Skills

Skills in `.agents/skills/` provide detailed guidance for each architectural rule. Read them before making changes.

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `actions`             | Before creating or modifying actions                           |
| `real-time-sync`      | Before wiring up real-time UI sync                             |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `capture-learnings`   | Before recording user preferences or corrections               |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |

## When Adding Features

As you build out this app, follow this checklist for each new feature:

1. **Add navigation state entries** -- create or extend `app/hooks/use-navigation-state.ts` to track new routes
2. **Enhance view-screen** -- make the view-screen script return relevant context for the new view
3. **Create domain actions** -- add scripts for CRUD operations on new data models
4. **Create domain skills** -- add `.agents/skills/<feature>/SKILL.md` documenting the data model, storage patterns, and agent operations
5. **Update this AGENTS.md** -- add the new actions, state keys, and common tasks

---

For code editing and development guidance, read `DEVELOPING.md`.
