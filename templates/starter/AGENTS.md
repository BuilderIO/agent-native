# {{APP_NAME}} — Agent Guide

This app follows the agent-native core philosophy: the agent and UI are equal partners. Everything the UI can do, the agent can do via actions. The agent always knows what you're looking at via application state. See the root AGENTS.md for full framework documentation.

This is an **@agent-native/core** application -- the AI agent and UI share state through a SQL database, with polling for real-time sync.

## Resources

Resources are SQL-backed persistent files for storing notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — user-specific context. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — app memory with user preferences and corrections. Read both scopes.

**Update `LEARNINGS.md` when you learn something important.**

### Resource scripts

| Action            | Args                                           | Purpose                 |
| ----------------- | ---------------------------------------------- | ----------------------- |
| `resource-read`   | `--name <name> [--scope personal\|shared]`     | Read a resource         |
| `resource-write`  | `--name <name> --content <text> [--scope ...]` | Write/update a resource |
| `resource-list`   | `[--scope personal\|shared]`                   | List all resources      |
| `resource-delete` | `--name <name> [--scope personal\|shared]`     | Delete a resource       |

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                                   | Direction                  |
| ------------ | ----------------------------------------- | -------------------------- |
| `navigation` | Current view (`home` or `new-app`)        | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot, auto-deleted) | Agent -> UI (auto-deleted) |

## Workspace App Creation

The `/new-app` route lets the user prompt a new workspace app and choose which Dispatch vault keys it should receive. When loaded inside Builder, code prompts are delegated to Builder chat; in local dev, they go to the agent-native code agent. In production, app creation is only enabled when Builder branching is explicitly configured.

When creating a new app from this flow, keep apps under `apps/<app-id>`, mount them at `/<app-id>`, use the shared workspace database/hosting model, and namespace any new domain tables so apps do not collide.

## Agent Operations

The current screen state is automatically included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation.

**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template's root before running any action:

```bash
cd templates/starter && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

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

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `actions`             | Before creating or modifying scripts                           |
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

### UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

---

For code editing and development guidance, read `DEVELOPING.md`.
