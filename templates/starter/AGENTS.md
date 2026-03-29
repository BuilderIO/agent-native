# {{APP_NAME}} — Agent-Native App

## Architecture

This is an **@agent-native/core** application — the AI agent and UI share state through a SQL database, with SSE for real-time sync.

### Core Principles

1. **Shared SQL database** — All app state lives in SQL (SQLite locally, cloud DB via `DATABASE_URL` in production). Core stores: `application_state`, `settings`, `oauth_tokens`, `sessions`.
2. **All AI through agent chat** — No inline LLM calls. UI delegates to the AI via `sendToAgentChat()` / `agentChat.submit()`.
3. **Scripts for agent operations** — `pnpm script <name>` dispatches to callable script files in `scripts/`.
4. **SSE for real-time sync** — Database writes emit events that keep the UI in sync automatically.
5. **Agent can update code** — The agent can modify this app's source code directly.

### Authentication

Auth is automatic and environment-driven. The `server/plugins/auth.ts` plugin calls `autoMountAuth(app)` at startup.

- **Dev mode**: Auth is bypassed. `getSession()` returns `{ email: "local@localhost" }`. Zero friction.
- **Production** (`ACCESS_TOKEN` set): Auth middleware auto-mounts. Login page for unauthenticated visitors.
- **Production** (no token, no `AUTH_DISABLED=true`): Server refuses to start.

Use `getSession(event)` server-side and `useSession()` client-side. See [docs/auth.md](docs/auth.md).

## Resources

Resources are SQL-backed persistent files that store notes, learnings, context, and other long-lived information. They replace the old `LEARNINGS.md` file approach with a structured, scriptable system.

- **Personal resources** — scoped to the current user. Use these for individual preferences, corrections, and context.
- **Shared resources** — visible to all users. Use these for team-wide patterns, app-specific knowledge, and shared context.

### Startup resources

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences that help you act on vague requests. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — the app's memory with user preferences, corrections, important context, and patterns learned from past interactions. Read both `--scope personal` and `--scope shared`.

**Update `LEARNINGS.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category.

### Resource scripts

| Script            | Purpose                     | Example                                                          |
| ----------------- | --------------------------- | ---------------------------------------------------------------- |
| `resource-read`   | Read a resource             | `pnpm script resource-read --name LEARNINGS.md`                  |
| `resource-write`  | Create or update a resource | `pnpm script resource-write --name LEARNINGS.md --content "..."` |
| `resource-list`   | List all resources          | `pnpm script resource-list`                                      |
| `resource-delete` | Delete a resource           | `pnpm script resource-delete --name old-notes.md`                |

## Available Scripts

| Script      | Purpose                         | Example                                            |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `db-schema` | Show all tables, columns, types | `pnpm script db-schema`                            |
| `db-query`  | Run a SELECT query              | `pnpm script db-query --sql "SELECT * FROM forms"` |
| `db-exec`   | Run INSERT/UPDATE/DELETE        | `pnpm script db-exec --sql "UPDATE forms SET ..."` |

## Skills

Skills in `.agents/skills/` provide detailed guidance for each architectural rule. Read them before making changes.

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `scripts`             | Before creating or modifying scripts                           |
| `real-time-sync`      | Before wiring up real-time UI sync                             |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) enforces distinctive, production-grade aesthetics — committing to a clear visual direction and avoiding generic patterns like purple gradients, overused fonts, and cookie-cutter layouts.

---

For code editing and development guidance, read `DEVELOPING.md`.
