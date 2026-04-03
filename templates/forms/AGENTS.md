# Forms — Agent Guide

You are the AI assistant for this form builder app. You can create, edit, and manage forms, view responses, and help users customize their forms. When a user asks about forms (e.g. "create a contact form", "show me responses", "add a rating field"), use the scripts and application state below.

This is an **agent-native** form builder built with `@agent-native/core`. The agent and the UI have full parity — everything the user can do in the GUI, the agent can do via scripts and the shared database.

## Core Philosophy

1. **Agent + UI parity** — The agent creates forms from natural language. The GUI provides live preview + click-to-edit for fine-tuning. Both work on the same data.
2. **Context awareness** — Always run `view-screen` first to understand what the user sees before acting.
3. **Skills-first** — Read `.agents/skills/` for detailed guidance on form building, responses, and publishing.

See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via polling/SSE.
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

For code editing and development guidance, read `DEVELOPING.md`.

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences that help you act on vague requests. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important.**

### Resource scripts

| Script            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

## Architecture

```
┌────────────────────┐     ┌────────────────────┐
│  Frontend          │     │  Agent Chat        │
│  (React + Vite)    │◄───►│  (AI agent)        │
│                    │     │                    │
│  - form builder    │     │  - creates forms   │
│    GUI + preview   │     │    via scripts     │
│  - response viewer │     │  - reads responses │
│                    │     │  - navigates UI    │
└────────┬───────────┘     └──────────┬─────────┘
         │                            │
         └──────────┬─────────────────┘
                    ▼
            ┌───────────────┐
            │  Backend      │
            │  (Nitro)      │
            │               │
            │  /api/forms   │
            │  /api/submit  │
            └───────┬───────┘
                    │
                    ▼
            ┌───────────────┐
            │  SQL Database │
            │  (via DB_URL) │
            └───────────────┘
```

- **Admin (logged in):** Agent + GUI to build forms (split-pane live preview + properties panel)
- **Public (logged out):** Fill out forms at `/f/:slug` — no agent, no login
- **Responses:** Stored in SQL via Drizzle ORM (SQLite, Postgres, Turso, etc. via `DATABASE_URL`)
- **Captcha:** Cloudflare Turnstile on public form submissions (opt-in)

## Application State

Ephemeral UI state is stored in the SQL `application_state` table, accessed via `readAppState(key)` and `writeAppState(key, value)` from `@agent-native/core/application-state`.

| State Key    | Purpose                            | Direction                  |
| ------------ | ---------------------------------- | -------------------------- |
| `navigation` | Current view, formId, search state | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot)        | Agent -> UI (auto-deleted) |

### Navigation state (read what the user sees)

The UI writes `navigation` whenever the user navigates:

```json
{
  "view": "form",
  "formId": "abc123"
}
```

Views: `forms` (list), `form` (builder), `responses` (response viewer), `public-form`.

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.

### Navigate command (control the UI)

```json
{
  "view": "form",
  "formId": "abc123"
}
```

This is a one-shot command — the entry is deleted after the UI processes it.

## Agent Operations

**Always run `pnpm script view-screen` first** before taking any action. This shows what the user is currently looking at, including form details and response data. Don't skip this step.

**Always use `pnpm script <name>` for operations** — never curl or raw HTTP.

**After any mutation** (create, update, delete), always run `pnpm script refresh-list` to trigger a UI update.

## Scripts

### Reading & Context

| Script           | Args                                  | Purpose                       |
| ---------------- | ------------------------------------- | ----------------------------- |
| `view-screen`    |                                       | See what the user sees now    |
| `list-forms`     | `[--status draft\|published\|closed]` | List all forms with counts    |
| `get-form`       | `--id <form-id>`                      | Get full form detail + fields |
| `list-responses` | `--form <id> [--limit N]`             | List responses for a form     |

### Creating & Modifying

| Script             | Args                                                    | Purpose           |
| ------------------ | ------------------------------------------------------- | ----------------- |
| `create-form`      | `--title "..." [--description "..."] [--fields <json>]` | Create a new form |
| `update-form`      | `--id <id> [--title] [--fields <json>] [--status]`      | Update a form     |
| `export-responses` | `--form <id> --output <path> [--format csv\|json]`      | Export responses  |

### Navigation & UI

| Script         | Args                            | Purpose            |
| -------------- | ------------------------------- | ------------------ |
| `navigate`     | `--view <name> [--formId <id>]` | Navigate the UI    |
| `refresh-list` |                                 | Trigger UI refresh |

### Database

| Script      | Purpose                         | Example                                            |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `db-schema` | Show all tables, columns, types | `pnpm script db-schema`                            |
| `db-query`  | Run a SELECT query              | `pnpm script db-query --sql "SELECT * FROM forms"` |
| `db-exec`   | Run INSERT/UPDATE/DELETE        | `pnpm script db-exec --sql "UPDATE forms SET ..."` |

## Common Tasks

| User request                    | What to do                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------- |
| "Create a contact form"         | `create-form --title "Contact Form" --fields '[...]'`                           |
| "Add a rating field"            | `view-screen`, get form, `update-form --id <id> --fields '[...existing + new]'` |
| "Publish this form"             | `view-screen`, get formId, `update-form --id <id> --status published`           |
| "Show me responses"             | `view-screen`, then `list-responses --form <id>`                                |
| "Export responses to CSV"       | `export-responses --form <id> --output data/export.csv`                         |
| "What am I looking at?"         | `view-screen`                                                                   |
| "Open the contact form"         | `list-forms` to find ID, then `navigate --view=form --formId=<id>`              |
| "How many responses do I have?" | `list-forms` (shows response counts for all forms)                              |
| "Close this form"               | `view-screen`, `update-form --id <id> --status closed`                          |

### Script task mapping

| User request            | Script to run                                                       |
| ----------------------- | ------------------------------------------------------------------- |
| "What's on my screen?"  | `pnpm script view-screen`                                           |
| "List my forms"         | `pnpm script list-forms`                                            |
| "Show draft forms"      | `pnpm script list-forms --status draft`                             |
| "Get form details"      | `pnpm script get-form --id <form-id>`                               |
| "Create a survey"       | `pnpm script create-form --title "Survey" --fields '[...]'`         |
| "Update the form title" | `pnpm script update-form --id <id> --title "New Title"`             |
| "Publish it"            | `pnpm script update-form --id <id> --status published`              |
| "Show responses"        | `pnpm script list-responses --form <id>`                            |
| "Export to CSV"         | `pnpm script export-responses --form <id> --output data/export.csv` |
| "Go to forms list"      | `pnpm script navigate --view=forms`                                 |
| "Open form responses"   | `pnpm script navigate --view=responses --formId=<id>`               |

## UI Conventions

- **Always use shadcn/ui components** for all standard UI patterns — Popover, Dialog, Button, DropdownMenu, Select, Tabs, Input, Textarea, Badge, Card, Switch, etc. Check `app/components/ui/` before building custom UI. Never create one-off implementations when a shadcn component exists.
- **Always use Tabler Icons** (`@tabler/icons-react`) — never use Lucide, Heroicons, or inline SVGs.

## Development

For code editing and development guidance, read `DEVELOPING.md`.
