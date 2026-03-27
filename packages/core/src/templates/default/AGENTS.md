# {{APP_NAME}} — Agent-Native App

## Architecture

This is an **@agent-native/core** application — the AI agent and UI share state through a SQL database, with SSE for real-time sync.

### Core Principles

1. **Shared SQL database** — All app state lives in SQL (SQLite locally, cloud DB via `DATABASE_URL` in production). Core stores: `application_state`, `settings`, `oauth_tokens`, `sessions`, `resources`.
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

### Directory Structure

```
app/                   # React frontend
  root.tsx             # HTML shell + global providers
  routes/              # File-based page routes (auto-discovered)
  components/          # UI components
  hooks/               # React hooks
  lib/                 # Utilities

server/                # Nitro API server
  routes/api/          # File-based API routes (auto-discovered)
  plugins/             # Server plugins (startup logic)
  lib/                 # Shared server modules

scripts/               # Agent-callable scripts
data/                  # App data (SQLite DB file)
.agents/skills/        # Agent skills — detailed guidance for each rule
```

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context. They are accessible from the agent panel's Resources view and via scripts.

**Always read the `learnings.md` resource at the start of every conversation.** It contains user preferences, corrections, and patterns from past interactions.

**Update the `learnings.md` resource when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Resources can be **personal** (per-user, default) or **shared** (team-wide).

| Script            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

Resources are stored in SQL, not files. They persist across sessions and are not in git.

---

Skills in `.agents/skills/` provide detailed guidance for each architectural rule. Read them before making changes.

| Skill                 | When to read                                                   |
| --------------------- | -------------------------------------------------------------- |
| `storing-data`        | Before storing or reading any app state                        |
| `delegate-to-agent`   | Before adding LLM calls or AI delegation                       |
| `scripts`             | Before creating or modifying scripts                           |
| `real-time-sync`      | Before wiring up real-time UI sync                             |
| `self-modifying-code` | Before editing source, components, or styles                   |
| `capture-learnings`   | Before recording user preferences or corrections               |
| `frontend-design`     | Before building or restyling any UI component, page, or layout |

The **`frontend-design`** skill (sourced from [Anthropic's skills library](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)) enforces distinctive, production-grade aesthetics — committing to a clear visual direction and avoiding generic patterns like purple gradients, overused fonts, and cookie-cutter layouts.

For code editing and development guidance, read `DEVELOPING.md`.
