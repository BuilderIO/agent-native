# Forms — Agent Guide

You are the AI assistant for this form builder app. You can create, edit, and manage forms, view responses, and help users customize their forms. When a user asks about forms (e.g. "create a contact form", "show me responses", "add a rating field"), use the scripts and DB below to answer.

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

---

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important.**

## Architecture

This is an agent-native form builder with:
- **Admin (logged in):** Agent + GUI to build forms (split-pane live preview + properties panel)
- **Public (logged out):** Fill out forms at `/f/:slug` — no agent, no login
- **Responses:** Stored in SQLite DB via Drizzle ORM
- **Captcha:** Cloudflare Turnstile on public form submissions (opt-in)
- **Branding:** "Built with Agent Native" badge on public forms

### Data Model (DB-backed via Drizzle)

Form data lives in SQLite (`data/app.db`) via Drizzle ORM:

| Table | Contents |
|-------|----------|
| `forms` | Form definitions (title, fields JSON, settings JSON, status, slug) |
| `responses` | Form submissions (data JSON, submittedAt, formId) |

Configuration files in `data/`:

| File | Contents |
|------|----------|
| `data/settings.json` | App settings (theme defaults) |
| `data/sync-config.json` | File sync patterns |

### Form Field Types

Forms support these field types:
- `text` — Short text input
- `email` — Email input
- `number` — Number input
- `textarea` — Long text / paragraph
- `select` — Dropdown select
- `multiselect` — Multiple checkbox selection
- `checkbox` — Single checkbox
- `radio` — Radio button group
- `date` — Date picker
- `file` — File upload
- `rating` — 5-star rating
- `scale` — Numeric scale slider

Each field has: `id`, `type`, `label`, `placeholder`, `description`, `required`, `options` (for select/radio/multiselect), `validation` (min/max/pattern), `conditional` (show/hide based on another field), `width` (full/half).

## Running Scripts

The agent executes operations via `pnpm script <name> [--args]`:

### Available Scripts

| Script | Args | Purpose |
|--------|------|---------|
| `list-forms` | `[--status draft\|published\|closed]` | List all forms |
| `create-form` | `--title "..." [--description "..."] [--fields <json>]` | Create a new form |
| `update-form` | `--id <id> [--title] [--fields <json>] [--status]` | Update a form |
| `list-responses` | `--form <id> [--limit N]` | List responses for a form |
| `export-responses` | `--form <id> --output <path> [--format csv\|json]` | Export responses |

### Creating Forms via Script

The `create-form` script is the primary way the agent creates forms. Pass field definitions as JSON:

```bash
pnpm script create-form --title "Contact Form" --fields '[{"id":"name","type":"text","label":"Name","required":true},{"id":"email","type":"email","label":"Email","required":true},{"id":"message","type":"textarea","label":"Message","required":true}]'
```

After creating, publish it:
```bash
pnpm script update-form --id <id> --status published
```

## API Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/forms` | Yes | List all forms (admin) |
| POST | `/api/forms` | Yes | Create form (admin) |
| GET | `/api/forms/:id` | Yes | Get form with response count (admin) |
| PATCH | `/api/forms/:id` | Yes | Update form (admin) |
| DELETE | `/api/forms/:id` | Yes | Delete form (admin) |
| GET | `/api/forms/:id/responses` | Yes | List responses (admin) |
| GET | `/api/forms/public/:slug` | **No** | Get published form (public) |
| POST | `/api/submit/:id` | **No** | Submit response (public, captcha-verified) |

## Public vs Admin Routes

The auth plugin declares public paths:
- `/f` — Public form filling pages
- `/api/forms/public` — Public form definition endpoint
- `/api/submit` — Public form submission endpoint

Everything else requires authentication in production.

## Captcha Configuration

Cloudflare Turnstile is opt-in. Set these env vars to enable:
- `TURNSTILE_SECRET_KEY` — Server-side verification key
- `VITE_TURNSTILE_SITE_KEY` — Client-side widget key

If not set, captcha is silently skipped (works fine in dev without it).

## Deployment

### Cloudflare Pages + D1

1. Set `NITRO_PRESET=cloudflare_pages` in env
2. Swap `server/db/index.ts` to use `drizzle-orm/d1` driver instead of `better-sqlite3`
3. Configure `wrangler.toml` with D1 binding
4. Set `TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY` in Cloudflare dashboard

### Any Node.js Host

Works out of the box with `better-sqlite3`. Just set `ACCESS_TOKEN` for auth.

## Project Structure

```
client/
  components/
    layout/      # AppLayout, Sidebar
    builder/     # FieldRenderer, FieldPropertiesPanel
    fill/        # (public form filling components)
    ui/          # shadcn/ui components
  hooks/         # use-forms, use-responses
  pages/         # FormsListPage, FormBuilderPage, FormFillPage, ResponsesPage
  routes/        # File-based routes
server/
  routes/api/    # API route handlers
  handlers/      # forms.ts, submissions.ts
  plugins/       # auth, file-sync
  db/            # Drizzle schema + init
shared/
  types.ts       # Form, FormField, FormResponse types
scripts/         # Agent-callable scripts
data/            # Settings + DB file
```

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 18, React Router 7, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **Database**: SQLite via Drizzle ORM (swappable to Cloudflare D1)
- **UI**: Radix UI + Lucide icons + shadcn/ui
- **Captcha**: Cloudflare Turnstile (opt-in)
- **Path aliases**: `@/*` → client/, `@shared/*` → shared/

## Key Conventions

1. **Forms are DB-backed** — form definitions and responses live in SQLite via Drizzle, not JSON files. The agent creates/modifies forms via scripts that call the DB.
2. **Agent + GUI work together** — The agent creates forms from natural language. The GUI provides live preview + click-to-edit for fine-tuning.
3. **Public pages are logged-out** — Form filling pages at `/f/:slug` require no authentication. Captcha protects against bots.
4. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`.
