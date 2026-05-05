# Forms — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 18, React Router 7, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **Database**: SQLite via Drizzle ORM + @libsql/client (local by default, cloud upgrade via `DATABASE_URL`)
- **UI**: Radix UI + Lucide icons + shadcn/ui
- **Captcha**: Cloudflare Turnstile (opt-in)
- **Path aliases**: `@/*` → app/, `@shared/*` → shared/

## Project Structure

```
app/
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
  plugins/       # auth, SSE
  db/            # Drizzle schema + init
shared/
  types.ts       # Form, FormField, FormResponse types
actions/         # Agent-callable scripts
data/            # SQLite database file (app.db)
```

## Database Schema (Drizzle ORM)

Form data lives in SQLite (`data/app.db`) via Drizzle ORM:

| Table       | Contents                                                           |
| ----------- | ------------------------------------------------------------------ |
| `forms`     | Form definitions (title, fields JSON, settings JSON, status, slug) |
| `responses` | Form submissions (data JSON, submittedAt, formId)                  |

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

## API Routes

| Method | Path                       | Auth   | Purpose                                    |
| ------ | -------------------------- | ------ | ------------------------------------------ |
| GET    | `/api/forms`               | Yes    | List all forms (admin)                     |
| POST   | `/api/forms`               | Yes    | Create form (admin)                        |
| GET    | `/api/forms/:id`           | Yes    | Get form with response count (admin)       |
| PATCH  | `/api/forms/:id`           | Yes    | Update form (admin)                        |
| DELETE | `/api/forms/:id`           | Yes    | Delete form (admin)                        |
| GET    | `/api/forms/:id/responses` | Yes    | List responses (admin)                     |
| GET    | `/api/forms/public/:slug`  | **No** | Get published form (public)                |
| POST   | `/api/submit/:id`          | **No** | Submit response (public, captcha-verified) |

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

### Local (default)

Works out of the box with local SQLite via `@libsql/client`. Just set `ACCESS_TOKEN` for auth.

### Cloud Database (Turso)

Set `DATABASE_URL` to a Turso database URL (e.g. `libsql://your-db.turso.io`) and `DATABASE_AUTH_TOKEN` to your Turso auth token. The same `@libsql/client` driver handles both local and remote seamlessly.

### Cloudflare Pages + D1

1. Set `NITRO_PRESET=cloudflare_pages` in env
2. Swap `server/db/index.ts` to use `drizzle-orm/d1` driver instead of `@libsql/client`
3. Configure `wrangler.toml` with D1 binding
4. Set `TURNSTILE_SECRET_KEY` and `VITE_TURNSTILE_SITE_KEY` in Cloudflare dashboard

## Build & Dev Commands

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm action <name> [--args]  # Run a backend script
```

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
