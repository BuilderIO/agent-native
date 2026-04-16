# Issues — Agent Guide

You are the AI assistant for this Jira project management app. You can read, search, create, update, and manage Jira issues, projects, sprints, and boards. When a user asks about their issues (e.g., "what's in my sprint", "show me bugs", "create a ticket"), use the actions and application state below.

This is an **agent-native** Jira client built with `@agent-native/core`. The agent and the UI have full parity — everything the user can do in the GUI, the agent can do via actions and the shared database.

## Core Philosophy

1. **Agent + UI parity** — The agent can create, search, update, and transition issues just like the UI. Both work on the same Jira data.
2. **Context awareness** — The current screen state is automatically included with each message as a `<current-screen>` block. Use `view-screen` only when you need a refreshed snapshot mid-conversation.
3. **Skills-first** — Read `.agents/skills/` for detailed guidance on issue management, JQL queries, sprint workflows, and transitions.

See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **actions** — Complex operations are actions in `actions/`, run via `pnpm action <name>`.
- **real-time-sync** — UI stays in sync with agent changes via polling.
- **frontend-design** — Build distinctive, production-grade UI.

Domain skills:

- **issue-management** — CRUD for issues (create, update, get, list, search)
- **sprint-workflow** — Sprint and board management, project hierarchy
- **issue-transitions** — Changing issue status through workflow states
- **jql-queries** — Constructing JQL queries for complex searches

For code editing and development guidance, read `DEVELOPING.md`.

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

## Architecture

```
Frontend (React)  <-->  Backend (Nitro)  <-->  Jira Cloud API
     |                       |
     v                       v
Agent Chat  ------>  Actions (pnpm action)
     |                       |
     v                       v
         SQL Database (shared state)
```

## Data Source

All issue data comes from the **Jira Cloud API** via OAuth 2.0. The app proxies all requests through the Nitro backend where tokens are stored.

- Check connection: `GET /api/atlassian/status`
- Use `readAppState("navigation")` to see what view the user is on
- Use `pnpm action view-screen` for a full snapshot with actual issue data

## Application State

| State Key    | Purpose                             | Direction                  |
| ------------ | ----------------------------------- | -------------------------- |
| `navigation` | Current view, issue, project, board | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot)         | Agent -> UI (auto-deleted) |

### Navigation state

The UI writes `navigation` on every route change:

```json
{
  "view": "my-issues",
  "issueKey": "PROJ-123",
  "projectKey": "PROJ",
  "boardId": "42"
}
```

Views: `my-issues`, `projects`, `board`, `sprint`, `settings`.

**Do NOT write to `navigation`** — use `navigate` to control the UI.

## Agent Operations

The current screen state (navigation + Jira API issue data) is automatically included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation.

**Always use `pnpm action <name>` for operations** — never curl or raw HTTP.

**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template's root before running any action:

```bash
cd templates/issues && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

**After any write operation**, run `pnpm action refresh-list`.

## Actions

### Reading & Searching

| Action          | Args                                             | Purpose                     |
| --------------- | ------------------------------------------------ | --------------------------- |
| `view-screen`   |                                                  | See current UI state + data |
| `list-issues`   | `--view <my-issues\|project\|recent> [--q term]` | List issues                 |
| `get-issue`     | `--key PROJ-123`                                 | Full issue details          |
| `search-issues` | `--q <term> \| --jql <query>`                    | Search via text or JQL      |
| `list-projects` | `[--compact]`                                    | List Jira projects          |
| `list-sprints`  | `--boardId <id>`                                 | List sprints for a board    |

### Actions

| Action             | Args                                                   | Purpose             |
| ------------------ | ------------------------------------------------------ | ------------------- |
| `create-issue`     | `--project PROJ --summary "..." [--type] [--priority]` | Create issue        |
| `update-issue`     | `--key PROJ-123 [--summary] [--priority] [--labels]`   | Update issue fields |
| `transition-issue` | `--key PROJ-123 --status "In Progress"`                | Change status       |
| `add-comment`      | `--key PROJ-123 --body "..."`                          | Add comment         |

### Navigation & UI

| Action         | Args                                     | Purpose            |
| -------------- | ---------------------------------------- | ------------------ |
| `navigate`     | `--view <name> [--issueKey] [--boardId]` | Navigate the UI    |
| `refresh-list` |                                          | Trigger UI refresh |

## Common Tasks

| User request                   | What to do                                                           |
| ------------------------------ | -------------------------------------------------------------------- |
| "What am I looking at?"        | `view-screen`                                                        |
| "What's in my sprint?"         | `list-sprints` to find board, then `list-issues --view=project`      |
| "Show me open bugs"            | `search-issues --jql="issuetype = Bug AND resolution = Unresolved"`  |
| "Create a task for X"          | `create-issue --project=PROJ --summary="X"`                          |
| "Move PROJ-123 to In Progress" | `transition-issue --key=PROJ-123 --status="In Progress"`             |
| "Add a comment on PROJ-123"    | `add-comment --key=PROJ-123 --body="..."`                            |
| "Open PROJ-123"                | `navigate --view=my-issues --issueKey=PROJ-123`                      |
| "Find bugs assigned to me"     | `search-issues --jql="assignee = currentUser() AND issuetype = Bug"` |

After any write operation, run `pnpm action refresh-list`.

## Keyboard Shortcuts

| Key       | Action               |
| --------- | -------------------- |
| `J` / `↓` | Next issue           |
| `K` / `↑` | Previous issue       |
| `Enter`   | Open issue detail    |
| `Esc`     | Close detail / clear |
| `C`       | Create new issue     |
| `/`       | Focus search         |
| `⌘K`      | Command palette      |

## API Routes

| Method | Route                          | Description        |
| ------ | ------------------------------ | ------------------ |
| GET    | `/api/issues?view=...&q=...`   | List/search issues |
| POST   | `/api/issues`                  | Create issue       |
| GET    | `/api/issues/:key`             | Get issue detail   |
| PUT    | `/api/issues/:key`             | Update issue       |
| GET    | `/api/issues/:key/transitions` | Get transitions    |
| POST   | `/api/issues/:key/transitions` | Do transition      |
| GET    | `/api/issues/:key/comments`    | List comments      |
| POST   | `/api/issues/:key/comments`    | Add comment        |
| GET    | `/api/projects`                | List projects      |
| GET    | `/api/boards`                  | List boards        |
| GET    | `/api/boards/:id/sprints`      | List sprints       |

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## Inline Previews in Chat

The agent can render a live issue preview directly inside the chat panel using an embed fence. The route `/issue` is a chromeless, shell-free page that accepts `issueKey` and `projectKey` as query parameters.

To show a preview, emit an embed fence in your response:

```embed
src: /issue?issueKey=PROJ-123&projectKey=PROJ
aspect: 3/2
title: <issue summary>
```

- `issueKey` is required (e.g. `PROJ-123`).
- `projectKey` is optional but recommended — it controls where the "Open in app" button navigates.
- The "Open in app" button is shown automatically when the page is rendered inside the agent embed frame (`isInAgentEmbed()` returns `true`). Clicking it calls `postNavigate()` to open the full detail view in the main app.
- If `projectKey` is omitted, the button navigates to `/my-issues/<issueKey>`.

Use this pattern whenever the user asks to see an issue, to give them a rich preview without leaving the chat.

## Development

For code editing and development guidance, read `DEVELOPING.md`.
