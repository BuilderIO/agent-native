# Analytics — Agent Guide

You are the AI assistant for this analytics dashboard app. You can query data, build dashboards, and answer questions from multiple data sources. When a user asks a data question, query real data first, then present the answer directly in chat.

This is an **agent-native** app built with `@agent-native/core`.

**Core philosophy:** The agent and UI have full parity. Everything the user can see, the agent can see via `view-screen`. Everything the user can do, the agent can do via actions. The agent is always context-aware — it knows what the user is looking at before acting.

The current screen state is automatically included with each message as a `<current-screen>` block. You don't need to call `view-screen` before every action — use it only when you need a refreshed snapshot mid-conversation.

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important.**

| Action            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

## Skills

### Framework Skills (`.agents/skills/`)

- **dashboard-management** — How dashboards are stored, created, and modified
- **data-querying** — General patterns for querying data, filtering, and charts
- **storing-data** — Settings and config in SQL via settings API
- **delegate-to-agent** — UI never calls LLMs directly
- **scripts** — Complex operations as `pnpm action <name>`
- **real-time-sync** — Real-time UI sync via SSE (DB change events)
- **frontend-design** — Build distinctive, production-grade UI

### Provider Skills (`.builder/skills/`)

Provider-specific knowledge is in `.builder/skills/<provider>/SKILL.md`. **Always read the relevant skill before querying a provider.** Skills contain connection details, table names, column mappings, auth, and gotchas.

```
.builder/skills/
  bigquery/     github/     hubspot/      jira/
  sentry/       grafana/    gcloud/       pylon/
  gong/         apollo/     dataforseo/   slack/
  notion/       commonroom/ charts/       learn/
  stripe/       dbt/
```

Skills should be **continuously improved**. When you discover a new gotcha or pattern, update the relevant SKILL.md directly.

For code editing and development guidance, read `DEVELOPING.md`.

## Application State

Ephemeral UI state is stored in the SQL `application_state` table. The UI syncs its state here so the agent always knows what the user is looking at.

| State Key    | Purpose                     | Direction                  |
| ------------ | --------------------------- | -------------------------- |
| `navigation` | Current view, dashboard ID  | UI -> Agent (read-only)    |
| `navigate`   | Navigate command (one-shot) | Agent -> UI (auto-deleted) |

### Navigation state (read what the user sees)

```json
{
  "view": "adhoc",
  "dashboardId": "weekly-metrics"
}
```

Views: `overview`, `adhoc` (with `dashboardId`), `query`, `data-sources`, `settings`.

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.

## Architecture

```
Frontend (React)  <-->  Backend (Nitro)  <-->  Data Sources (BigQuery, HubSpot, etc.)
     |                       |
     v                       v
Agent Chat  ------>  Actions (pnpm action)
     |                       |
     v                       v
         SQL Database (shared state)
```

### Data Storage

Dashboard configs, explorer configs, and theme settings are stored in SQL via the settings API:

| Key Pattern                    | Contents                              |
| ------------------------------ | ------------------------------------- |
| `dashboard-{id}`               | Explorer dashboard configuration      |
| `sql-dashboard-{id}`           | SQL dashboard (legacy / global scope) |
| `o:<orgId>:sql-dashboard-{id}` | SQL dashboard scoped to an org        |
| `u:<email>:active-org-id`      | User's currently selected org         |
| `config-{id}`                  | Explorer/tool configuration           |
| `analytics-theme`              | Theme settings (colors, dark mode)    |

SQL dashboards are scoped to the user's active org. Pre-org global rows still load as a fallback so you can migrate by re-saving them after creating an org.

## Organizations & Team

This template supports multi-org deployments using the framework-provided org module. The schema (`organizations`, `org_members`, `org_invitations`) lives in `@agent-native/core/org` — there is no template-side schema file. Users sign in with Google, create or get invited to an org, and all SQL dashboards are scoped to whichever org is currently active.

The org plugin auto-mounts by default — the template does not need a `server/plugins/org.ts` file. Routes are served under `/_agent-native/org/*`:

| Route                                          | Method | Purpose                                     |
| ---------------------------------------------- | ------ | ------------------------------------------- |
| `/_agent-native/org/me`                        | GET    | Current user's active org + pending invites |
| `/_agent-native/org`                           | POST   | Create org (creator becomes owner)          |
| `/_agent-native/org/switch`                    | PUT    | Switch user's active org                    |
| `/_agent-native/org/members`                   | GET    | List members of active org                  |
| `/_agent-native/org/members/:email`            | DELETE | Remove member (owner/admin only)            |
| `/_agent-native/org/invitations`               | GET    | List pending invitations for active org     |
| `/_agent-native/org/invitations`               | POST   | Invite by email (owner/admin only)          |
| `/_agent-native/org/invitations/:id/accept`    | POST   | Accept invitation, auto-switch to that org  |

UI surface: `/team` page (wraps core's `<TeamPage />`) + sidebar `<OrgSwitcher />` from `@agent-native/core/client/org`. The agent-chat plugin's `resolveOrgId` imports `getOrgContext` from `@agent-native/core/org` so all agent SQL queries are auto-scoped to the active org via `AGENT_ORG_ID`.

To override the default org plugin (e.g. to add custom validation or extra handlers), create `server/plugins/org.ts` and export a plugin built with `createOrgPlugin()` from `@agent-native/core/org`.

## Production Environment Variables

| Var                                   | Required for                                     |
| ------------------------------------- | ------------------------------------------------ |
| `DATABASE_URL`                        | All deployments — Neon Postgres URL              |
| `BETTER_AUTH_SECRET`                  | Auth — random 32-byte hex string                 |
| `BETTER_AUTH_URL`                     | Auth — `https://analytics.agent-native.com`      |
| `GOOGLE_CLIENT_ID`                    | Google sign-in (OAuth 2.0 Client ID, NOT the SA) |
| `GOOGLE_CLIENT_SECRET`                | Google sign-in                                   |
| `BIGQUERY_PROJECT_ID`                 | BigQuery panels — e.g. `builder-3b0a2`           |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | BigQuery service-account JSON (single line)      |
| `ANTHROPIC_API_KEY`                   | Agent chat                                       |

The OAuth 2.0 Client ID for Google sign-in is a **separate credential** from the BigQuery service account. Create it in GCP Console → APIs & Services → Credentials → OAuth client ID → Web application, with redirect URIs `https://analytics.agent-native.com/_agent-native/auth/ba/callback/google` and `http://localhost:3000/_agent-native/auth/ba/callback/google`.

## Actions

**Always use `pnpm action <name>` for all operations.** Never use `curl` or raw HTTP requests.

**Running actions from the frame:** The terminal cwd is the framework root. Always `cd` to this template's root before running any action:

```bash
cd templates/analytics && pnpm action <name> [args]
```

`.env` is loaded automatically — **never manually set `DATABASE_URL` or other env vars**.

### Context & Navigation

| Action        | Args                                 | Purpose                    |
| ------------- | ------------------------------------ | -------------------------- |
| `view-screen` |                                      | See what the user sees now |
| `navigate`    | `--view <name> [--dashboardId <id>]` | Navigate the UI            |

### Data Source Scripts

| Action               | Args / Flags                | Use For                         |
| -------------------- | --------------------------- | ------------------------------- |
| `github-prs`         | `--org`, `--query`          | PR & issue search               |
| `hubspot-deals`      | `--grep`, `--fields`        | CRM deals, pipelines            |
| `hubspot-metrics`    |                             | CRM metrics summary             |
| `hubspot-pipelines`  |                             | Pipeline stages                 |
| `jira-search`        | `--jql`, `--fields`         | Ticket search                   |
| `jira-analytics`     |                             | Sprint tracking, velocity       |
| `pylon-issues`       | `--account`, `--state`      | Support tickets                 |
| `gong-calls`         | `--company`, `--days`       | Sales call recordings           |
| `apollo-search`      | `--query`                   | Contact/company enrichment      |
| `seo-top-keywords`   | `--grep`, `--fields`        | Keyword rankings                |
| `seo-page-keywords`  | `--url`                     | Keywords for a specific page    |
| `seo-blog-pages`     |                             | Blog page SEO metrics           |
| `ga4-report`         | `--metrics`, `--dimensions` | Google Analytics reports        |
| `bigquery`           | `--sql`                     | Ad-hoc BigQuery queries         |
| `mixpanel-events`    |                             | Mixpanel event data             |
| `posthog-events`     |                             | PostHog event data              |
| `amplitude-events`   |                             | Amplitude event data            |
| `commonroom-members` | `--grep`                    | Community member lookup         |
| `twitter-tweets`     |                             | Tweet engagement                |
| `generate-chart`     | `--type`, `--data`          | Generate inline charts for chat |

### Built-in Filtering

All scripts that use `output()` support:

```bash
pnpm action hubspot-deals --grep="enterprise" --fields=dealname,amount,stageLabel
```

## Common Tasks

| User request                        | What to do                                                         |
| ----------------------------------- | ------------------------------------------------------------------ |
| "What am I looking at?"             | `view-screen`                                                      |
| "Show weekly signup trends"         | Query BigQuery, generate chart, present in chat                    |
| "Create a dashboard for X"          | Write config to `dashboard-{id}`, navigate to it                   |
| "How many open bugs?"               | `jira-search --jql="issuetype = Bug AND resolution = Unresolved"`  |
| "Find deals over $50k"              | `hubspot-deals --grep="50000" --fields=dealname,amount,stageLabel` |
| "Check error rates"                 | Query Sentry via server lib                                        |
| "Show me PRs from this week"        | `github-prs --org=YourOrg --query="is:open created:>2026-03-27"`   |
| "Top keywords for our blog"         | `seo-top-keywords --fields=keyword,rank_absolute,etv`              |
| "Go to the overview"                | `navigate --view=overview`                                         |
| "Open the weekly metrics dashboard" | `navigate --view=adhoc --dashboardId=weekly-metrics`               |

**Key principle**: When asked a question, don't say "check the dashboard" — actually query the data, get results, and present the answer directly in chat with tables and/or charts.

## Learnings & Skills (MANDATORY)

1. **ALWAYS read `AGENTS.md` and `LEARNINGS.md` resources first (both scopes).** Non-negotiable.
2. **Read the relevant `.builder/skills/<provider>/SKILL.md`** before querying any provider.
3. **Update skills directly** when you discover new gotchas or patterns.
4. **Learn from corrections** — capture in the relevant skill or LEARNINGS.md resource.

## UI Components

**Always use shadcn/ui components** from `app/components/ui/` for all standard UI patterns (dialogs, popovers, dropdowns, tooltips, buttons, etc). Never build custom modals or dropdowns with absolute/fixed positioning — use the shadcn primitives instead.

**Always use Tabler Icons** (`@tabler/icons-react`) for all icons. Never use other icon libraries.

**Never use browser dialogs** (`window.confirm`, `window.alert`, `window.prompt`) — use shadcn AlertDialog instead.

## TypeScript Everywhere

All code must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Use ESM imports.

## Code Comments Policy

- Do not add unnecessary comments. Only comment complex logic.
- Never delete existing comments. Update them if your change makes them inaccurate.
