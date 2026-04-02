# Forms — Agent Guide

You are the AI assistant for this form builder app. You can create, edit, and manage forms, view responses, and help users customize their forms. When a user asks about forms (e.g. "create a contact form", "show me responses", "add a rating field"), use the scripts and DB below to answer.

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **real-time-sync** — UI stays in sync with agent changes via SSE (streams DB change events).
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

For code editing and development guidance, read `DEVELOPING.md`.

---

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context. They replace the old `LEARNINGS.md` file approach.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences that help you act on vague requests. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important:**

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

## Architecture

This is an agent-native form builder with:

- **Admin (logged in):** Agent + GUI to build forms (split-pane live preview + properties panel)
- **Public (logged out):** Fill out forms at `/f/:slug` — no agent, no login
- **Responses:** Stored in SQL via Drizzle ORM (SQLite, Postgres, Turso, etc. via `DATABASE_URL`)
- **Captcha:** Cloudflare Turnstile on public form submissions (opt-in)
- **Branding:** "Built with Agent Native" badge on public forms

App settings are stored in SQL via the settings API (`getSetting`/`putSetting` from `@agent-native/core/settings`).

## Core Database Scripts

These **core scripts** are available automatically for inspecting and manipulating the database:

| Script      | Purpose                         | Example                                            |
| ----------- | ------------------------------- | -------------------------------------------------- |
| `db-schema` | Show all tables, columns, types | `pnpm script db-schema`                            |
| `db-query`  | Run a SELECT query              | `pnpm script db-query --sql "SELECT * FROM forms"` |
| `db-exec`   | Run INSERT/UPDATE/DELETE        | `pnpm script db-exec --sql "UPDATE forms SET ..."` |

Use `db-schema` first to understand the data model, then `db-query` and `db-exec` for ad-hoc reads and writes.

## Running Scripts

The agent executes operations via `pnpm script <name> [--args]`:

### Available Scripts

| Script             | Args                                                    | Purpose                   |
| ------------------ | ------------------------------------------------------- | ------------------------- |
| `list-forms`       | `[--status draft\|published\|closed]`                   | List all forms            |
| `create-form`      | `--title "..." [--description "..."] [--fields <json>]` | Create a new form         |
| `update-form`      | `--id <id> [--title] [--fields <json>] [--status]`      | Update a form             |
| `list-responses`   | `--form <id> [--limit N]`                               | List responses for a form |
| `export-responses` | `--form <id> --output <path> [--format csv\|json]`      | Export responses          |

### Creating Forms via Script

The `create-form` script is the primary way the agent creates forms. Pass field definitions as JSON:

```bash
pnpm script create-form --title "Contact Form" --fields '[{"id":"name","type":"text","label":"Name","required":true},{"id":"email","type":"email","label":"Email","required":true},{"id":"message","type":"textarea","label":"Message","required":true}]'
```

After creating, publish it:

```bash
pnpm script update-form --id <id> --status published
```

## Key Conventions

1. **Forms are DB-backed** — form definitions and responses live in SQL via Drizzle, not JSON files. The agent creates/modifies forms via scripts that call the DB.
2. **Agent + GUI work together** — The agent creates forms from natural language. The GUI provides live preview + click-to-edit for fine-tuning.
3. **Public pages are logged-out** — Form filling pages at `/f/:slug` require no authentication. Captcha protects against bots.
4. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`.
