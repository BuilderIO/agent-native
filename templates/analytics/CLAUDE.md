# Analytics — Agent-Native App

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

---

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

> **CRITICAL: Before doing ANY work, read [docs/learnings.md](docs/learnings.md) first.**
> It contains essential cross-cutting knowledge about agent behavior, customer data, user preferences, and UI patterns.
> **Provider-specific knowledge** (BigQuery tables, API quirks, auth, script usage) lives in `.builder/skills/<provider>/SKILL.md`.
> Read the relevant skill before querying any provider. After completing work, **update the relevant skill or learnings.md** with new discoveries.

Internal analytics dashboard. Built with React + Nitro + TypeScript.

## Skills

Provider-specific knowledge is organized as modular skill files in `.builder/skills/<provider>/SKILL.md`. Each skill contains connection details, exported functions, script usage, and gotchas for that provider. **Always read the relevant skill before querying a provider.**

```
.builder/skills/
  github/SKILL.md       # PR & issue search across your org
  bigquery/SKILL.md     # Analytics events, signups, table maps, SQL patterns
  hubspot/SKILL.md      # CRM deals, contacts, companies
  jira/SKILL.md         # Ticket search, sprint tracking, analytics
  sentry/SKILL.md       # Error tracking across projects
  grafana/SKILL.md      # Prometheus metrics, dashboards, alerts
  gcloud/SKILL.md       # Cloud Run/Functions health, metrics, logs
  pylon/SKILL.md        # Support tickets, account lookup
  gong/SKILL.md         # Sales calls, transcripts
  apollo/SKILL.md       # Contact/company enrichment
  dataforseo/SKILL.md   # SEO keywords, rankings
  slack/SKILL.md        # Channel messages, search
  notion/SKILL.md       # Content calendar, editorial planning
  commonroom/SKILL.md   # Community member engagement
  charts/SKILL.md       # Inline chart generation for chat
  learn/SKILL.md        # /learn command — extract & save learnings from threads
```

Skills should be **continuously improved** based on learnings and feedback. When you discover a new gotcha, pattern, or API quirk for a provider, update that provider's SKILL.md directly. Generic cross-cutting learnings (agent behavior rules, customer data, user preferences) go in `docs/learnings.md`.

## Architecture

```
┌─────────────────────┐       ┌─────────────────────┐
│  Frontend (React/   │◄─────►│   Agent Chat        │
│  Vite)              │       │                     │
│                     │       │  reads/writes files  │
│  reads/writes files │       │  runs scripts        │
│  via backend        │       │  generates code      │
└────────┬────────────┘       └──────────┬──────────┘
         │                               │
         │  fetch /api/*                 │  pnpm script <name>
         │                               │
┌────────▼────────────┐       ┌──────────▼──────────┐
│  Backend (Nitro)  │◄─────►│    scripts/          │
│                     │       │                     │
│  API routes         │       │  standalone TS files │
│  BigQuery, HubSpot, │       │  import server libs  │
│  Jira, Sentry, etc. │       │  auto-discovered     │
└─────────────────────┘       └─────────────────────┘
```

### Core Principles

1. **Everything is files.** All stateful data lives in the filesystem — markdown, JSON, YAML, React code. The UI reads and writes files. The AI agent reads and writes files. This is the shared state mechanism. No special APIs needed for the agent to interact with app state.

2. **Scripts are the backend escape hatch.** Any backend logic the AI needs (BigQuery queries, image generation, API calls) lives as standalone scripts in `scripts/`. The agent runs them via `pnpm script <name> --arg=value`. Scripts can be generated on the fly or committed for reuse.

3. **The UI can delegate to the AI agent.** Use `sendToAgentChat()` from `@agent-native/core` to programmatically submit prompts to the agent chat. This lets UI buttons trigger agentic workflows — the button provides the structured prompt, and the agent does the work. This is vastly more flexible than building custom backend endpoints for every feature.

### File Sync (Multi-User Collaboration)

File sync is **opt-in** — enabled when `FILE_SYNC_ENABLED=true` is set in `.env`.

**Environment variables:**

| Variable                         | Required      | Description                                          |
| -------------------------------- | ------------- | ---------------------------------------------------- |
| `FILE_SYNC_ENABLED`              | No            | Set to `"true"` to enable sync                       |
| `FILE_SYNC_BACKEND`              | When enabled  | `"firestore"`, `"supabase"`, or `"convex"`           |
| `SUPABASE_URL`                   | For Supabase  | Project URL                                          |
| `SUPABASE_PUBLISHABLE_KEY`       | For Supabase  | Publishable key (or legacy `SUPABASE_ANON_KEY`)      |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore | Path to service account JSON                         |
| `CONVEX_URL`                     | For Convex    | Deployment URL from `npx convex dev` (must be HTTPS) |

**How sync works:**

- `createFileSync()` factory reads env vars and initializes sync
- Files matching `sync-config.json` patterns are synced to/from the database
- Sync events flow through SSE (`source: "sync"`) alongside file change events
- Conflicts produce `.conflict` sidecar files and notify the agent

**Checking sync status:**

- Read `data/.sync-status.json` for current sync state
- Read `data/.sync-failures.json` for permanently failed sync operations

**Handling conflicts:**

- When `application-state/sync-conflict.json` appears, resolve the conflict
- Read the `.conflict` file alongside the original to understand both versions
- Edit the original file to resolve, then delete the `.conflict` file

**Scratch files (not synced):**

- Prefix temporary files with `_tmp-` to exclude from sync

## Tech Stack

- **Frontend**: React 18 + React Router 6 (SPA) + TypeScript + Vite + TailwindCSS 3
- **Backend**: Nitro (via @agent-native/core) — file-based API routing
- **Testing**: Vitest
- **UI Components**: Radix UI + TailwindCSS 3 + Lucide React icons
- **Package Manager**: pnpm

## Project Structure

```
client/                   # React SPA frontend
├── pages/                # Route components
├── components/ui/        # Pre-built UI component library
├── lib/                  # Client utilities (auth, query helpers)
├── App.tsx               # App entry point with SPA routing
└── global.css            # TailwindCSS 3 theming and global styles

server/                   # Nitro API server
├── index.ts              # Server setup (route handlers)
├── lib/                  # Shared server libraries (BigQuery, HubSpot, etc.)
└── routes/               # API route handlers

scripts/                  # CLI scripts for backend automation
├── run.ts                # Universal script runner
├── helpers.ts            # Shared arg parsing & output utilities
└── *.ts                  # Individual scripts (auto-discovered by filename)

shared/                   # Types shared between client & server
└── api.ts                # Shared API interfaces

docs/                     # Documentation and accumulated knowledge
└── learnings.md          # Cross-cutting patterns, customer data, user prefs

.builder/skills/          # Provider-specific knowledge (one per integration)
└── <provider>/SKILL.md   # Connection, functions, scripts, gotchas
```

Path aliases: `@/*` → `client/`, `@shared/*` → `shared/`

## Agent Chat Bridge

The `sendToAgentChat()` function from `@agent-native/core` lets the app programmatically submit prompts to the agent chat. This is the primary way UI features should delegate complex or generative work to the agent. Use `useAgentChatGenerating()` to track whether the agent is currently processing.

### Usage

```typescript
import { sendToAgentChat, useAgentChatGenerating } from "@agent-native/core";

// Auto-submit a prompt to the agent
sendToAgentChat({
  message: "Create a new dashboard showing weekly signup trends by channel",
  submit: true,
});

// Prefill without submitting (let user review first)
sendToAgentChat({
  message: "Analyze the top 10 blog posts by conversion rate",
  submit: false,
});

// Include hidden context the agent can use but the user doesn't see
sendToAgentChat({
  message: "Fix the chart rendering",
  context:
    "The TierBreakdownCharts component at client/pages/adhoc/tier-breakdown/TierBreakdownCharts.tsx is throwing a BigQuery byte limit error. Switch from @app_events to the Amplitude table.",
  submit: true,
});

// Track generating state in a component
const isGenerating = useAgentChatGenerating();
```

### When to Use This

Use `sendToAgentChat()` when:

- A UI action is best handled by the AI (e.g., "New Dashboard" → agent creates it from a prompt)
- You want to trigger a multi-step workflow (e.g., "lint this article with Vale rules")
- The task requires reading/writing multiple files intelligently
- You'd otherwise need to build a complex custom backend endpoint

Do NOT use it for:

- Simple CRUD that the UI can handle directly via file read/write
- Deterministic operations with no AI judgment needed

## Scripts System

All backend automation lives as standalone TypeScript scripts in `scripts/`. Each script is auto-discovered by filename — no registration needed.

### Running Scripts

```bash
pnpm script <script-name> [--arg=value ...]
```

### Built-in Filtering

All scripts that use `output()` automatically support:

- **`--grep=<term>`** — case-insensitive search across all values
- **`--fields=<a,b,c>`** — pluck specific fields from results

```bash
pnpm script hubspot-deals --grep="Acme" --fields=dealname,amount,stageLabel
pnpm script seo-top-keywords --grep=remix --fields=keyword,rank_absolute,etv
```

### Creating Scripts

```typescript
#!/usr/bin/env tsx
import { parseArgs, output, fatal } from "./helpers";

const args = parseArgs();
if (!args.myArg) fatal("--myArg is required");

const result = await doSomething(args.myArg);
output(result);
```

Conventions:

- Import `parseArgs`, `output`, `fatal` from `./helpers`
- Import server libs directly (e.g., `../server/lib/bigquery`)
- Output JSON via `output()` for automatic `--grep`/`--fields` support
- Use `fatal()` for required arg validation
- `helpers.ts` loads `dotenv/config` so env vars are available

### AI Agent Script Usage

The AI agent should:

1. Use `--grep` and `--fields` to narrow output — never pipe raw JSON through grep
2. Reuse existing scripts when possible
3. Generate new scripts in `scripts/` when needed for new backend functionality
4. For one-off tasks, generate a script, run it, and clean it up
5. For reusable tasks, generate a script and keep it

## Development

```bash
pnpm dev        # Start dev server (frontend + backend, port 8080)
pnpm build      # Production build
pnpm typecheck  # TypeScript validation
pnpm test       # Run Vitest tests
```

## Routing

Routes are defined in `client/App.tsx`:

```typescript
<Route path="/" element={<Index />} />
<Route path="/adhoc/:id" element={<AdhocRouter />} />
```

- `client/pages/Index.tsx` — home/overview page
- `client/pages/adhoc/` — dashboard pages, registered in `registry.ts`

### Tools vs Dashboards

The sidebar has two sections: **Dashboards** and **Tools**. Use the right one:

- **Dashboards** — data visualizations, charts, metrics, time-series. Things people look at to understand trends. Add to `dashboards` array in `registry.ts` and `dashboardComponents` map.
- **Tools** — functional utilities with inputs/actions (e.g. look up a customer, search Stripe, run a query). Things people _use_ to get specific answers. Add to the `defaultTools` array in `client/components/layout/Sidebar.tsx`.

When a user asks for a **new feature, lookup tool, or interactive utility** → add it to **Tools**.
When a user asks for a **chart, metrics view, or data breakdown** → add it to **Dashboards**.

### Adding a Dashboard

**IMPORTANT**: When creating a new dashboard, YOU (the creator) must provide your name or email as the author. Do NOT pull this from git logs or other sources.

1. Create component in `client/pages/adhoc/my-dashboard/index.tsx`
2. Use `<DashboardHeader />` component at the top to display metadata
3. Add entry to `dashboards` array in `client/pages/adhoc/registry.ts` with **REQUIRED fields**:
   - `id`: kebab-case identifier
   - `name`: Display name
   - `author`: **YOUR name or email** - the person creating this dashboard (e.g., "jane@example.com" or "Jane Doe")
   - `lastUpdated`: Today's date in YYYY-MM-DD format
4. Add lazy import to `dashboardComponents` in the same file

**Example:**

```typescript
{
  id: "my-dashboard",
  name: "My Dashboard",
  author: "jane@example.com",  // REQUIRED: Your name/email as the creator
  lastUpdated: "2026-03-12"    // REQUIRED: Today's date
}
```

**The UI will prompt for author name when using "New Dashboard" button.**

### Adding a Tool

**IMPORTANT**: When creating a new tool, YOU (the creator) must provide your name or email as the author.

1. Create component in `client/pages/adhoc/my-tool/index.tsx`
2. Use `<DashboardHeader />` component at the top to display metadata
3. Add entry to `dashboards` array in `client/pages/adhoc/registry.ts` (for routing) with **REQUIRED fields**:
   - `author`: **YOUR name or email** - the person creating this tool
   - `lastUpdated`: Today's date in YYYY-MM-DD format
4. Add lazy import to `dashboardComponents` in the same file (for routing)
5. Add entry to `defaultTools` array in `client/components/layout/Sidebar.tsx` (for sidebar placement)

## Styling

- **TailwindCSS 3** utility classes for all styling
- **Theme tokens** in `client/global.css`
- **`cn()`** utility combines `clsx` + `tailwind-merge` for conditional classes

## Learnings & Skills (MANDATORY)

Knowledge is stored in three places:

1. **`.builder/skills/<provider>/SKILL.md`** — provider-specific knowledge (tables, API quirks, auth, scripts, gotchas). This is the primary knowledge store for each integration. Read the relevant skill before querying any provider.

2. **[docs/learnings.md](docs/learnings.md)** — cross-cutting knowledge (agent behavior rules, customer data, user preferences, UI patterns). Read this before doing any work.

### Rules

1. **ALWAYS read learnings.md first.** Non-negotiable. Before any work.
2. **Read the relevant skill** before querying a provider. It tells you table names, column names, join paths, auth, and patterns.
3. **Update skills directly.** When you discover something new about a provider, update that provider's SKILL.md. Skills should be continuously improved.
4. **Learn from corrections.** If the user corrects you, capture it in the relevant skill or learnings.md.
5. **Keep it concise.** Each learning should be actionable — what to do, what not to do, and why.

### What belongs where

| Content                                             | Location              |
| --------------------------------------------------- | --------------------- |
| BigQuery table names, column mappings, SQL patterns | `bigquery/SKILL.md`   |
| API quirks for a specific provider                  | `<provider>/SKILL.md` |
| Customer data (IDs, deal info, stakeholders)        | `docs/learnings.md`   |
| User preferences, UI patterns                       | `docs/learnings.md`   |
| Agent behavior rules                                | `docs/learnings.md`   |
| Chart styling preferences                           | `charts/SKILL.md`     |

## Answering Data Questions in Chat

When the user asks a data question, **query real data first**, then present the answer directly in chat.

### How to answer questions

1. **Read the relevant skill** — check `.builder/skills/<provider>/SKILL.md` for the right functions, scripts, and patterns
2. **Use existing scripts** — run `pnpm script <name> --arg=value`. All scripts support `--grep` and `--fields`.
3. **Write ad-hoc scripts** — if no existing script covers the question, create one in `scripts/`
4. **Use BigQuery directly** — for analytics/metrics questions, write SQL and run via `runQuery()`
5. **Include charts** — generate charts using the `generate-chart` script (see `charts/SKILL.md`)
6. **Cross-reference sources** — combine data from multiple sources for complete answers

### Available Data Sources

| Source                 | Server Lib                 | Scripts                         | Use For                                                        |
| ---------------------- | -------------------------- | ------------------------------- | -------------------------------------------------------------- |
| **BigQuery**           | `server/lib/bigquery.ts`   | ad-hoc via `runQuery()`         | Analytics events, signups, pageviews, subscriptions, user data |
| **GitHub**             | `server/lib/github.ts`     | `github-prs`                    | PR search, issue tracking, code reviews across your org        |
| **HubSpot CRM**        | `server/lib/hubspot.ts`    | `hubspot-deals`                 | Deals, pipelines, contacts, sales metrics                      |
| **Jira**               | `server/lib/jira.ts`       | `jira-search`, `jira-analytics` | Ticket search (JQL), duplicate detection, sprint tracking      |
| **Sentry**             | `server/lib/sentry.ts`     | —                               | Error tracking, unresolved issues, error trends                |
| **Grafana/Prometheus** | `server/lib/grafana.ts`    | —                               | Service health, LLM latency, request rates, alerts             |
| **Google Cloud**       | `server/lib/gcloud.ts`     | —                               | Cloud Run/Functions health, request counts, latencies, logs    |
| **Pylon**              | `server/lib/pylon.ts`      | `pylon-issues`                  | Support tickets, account lookup, issue history                 |
| **Gong**               | `server/lib/gong.ts`       | `gong-calls`                    | Sales call recordings, transcripts, participants               |
| **Apollo**             | `server/lib/apollo.ts`     | `apollo-search`                 | Contact/company enrichment, prospecting                        |
| **DataForSEO**         | `server/lib/dataforseo.ts` | `seo-top-keywords`              | Keyword rankings, search volume, SEO metrics                   |
| **Notion**             | `server/lib/notion.ts`     | —                               | Content calendar, editorial planning                           |
| **Slack**              | `server/lib/slack.ts`      | —                               | Channel messages, search across workspaces                     |
| **Twitter/X**          | (via API routes)           | —                               | Tweet engagement, social metrics                               |
| **Common Room**        | `server/lib/commonroom.ts` | `commonroom-members`            | Community engagement, member lookup                            |

### Example script usage

```bash
# GitHub: search open PRs in your org
pnpm script github-prs --org=YourOrg --query="is:open label:bug"

# Jira: search tickets
pnpm script jira-search --jql="summary ~ SSO ORDER BY created DESC" --fields=key,summary,status,assignee

# Support: open tickets for a customer
pnpm script pylon-issues --account="Acme Corp" --state=open

# Sales: recent calls
pnpm script gong-calls --company="Globex Inc" --days=30

# CRM: deals
pnpm script hubspot-deals --fields=dealname,amount,stageLabel

# SEO: top keywords
pnpm script seo-top-keywords --grep=remix --fields=keyword,rank_absolute,etv
```

**Key principle**: When asked a question, don't just say "you can check the dashboard" — actually run the query, get the data, and present the answer directly in chat with tables and/or charts.

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Code Comments Policy

- Do not add unnecessary comments. Only comment complex logic that isn't self-evident.
- Never delete existing comments. Update them if your change makes them inaccurate.
