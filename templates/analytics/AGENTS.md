# Analytics — Agent-Native App

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules:

- **storing-data** — All state is SQL-backed. Settings via `getSetting`/`putSetting`, structured data via Drizzle ORM.
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

---

> **CRITICAL: Before doing ANY work, read `AGENTS.md` and `LEARNINGS.md` resources first (both personal and shared scopes).**
> They contain essential context: contacts, preferences, agent behavior rules, customer data, and UI patterns.
> **Provider-specific knowledge** (BigQuery tables, API quirks, auth, script usage) lives in `.builder/skills/<provider>/SKILL.md`.
> Read the relevant skill before querying any provider. After completing work, **update the relevant skill or LEARNINGS.md resource** with new discoveries.

Analytics dashboard template. Built with React + Nitro + TypeScript.

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

Skills should be **continuously improved** based on learnings and feedback. When you discover a new gotcha, pattern, or API quirk for a provider, update that provider's SKILL.md directly. Generic cross-cutting learnings (agent behavior rules, customer data, user preferences) go in the `LEARNINGS.md` resource.

## Architecture

```
┌─────────────────────┐       ┌─────────────────────┐
│  Frontend (React/   │◄─────►│   Agent Chat        │
│  Vite)              │       │                     │
│                     │       │  reads/writes data   │
│  reads/writes data  │       │  runs scripts        │
│  via backend        │       │  generates code      │
└────────┬────────────┘       └──────────┬──────────┘
         │                               │
         │  fetch /api/*                 │  pnpm script <name>
         │                               │
┌────────▼────────────┐       ┌──────────▼──────────┐
│  Backend (Nitro)    │◄─────►│    scripts/          │
│                     │       │                     │
│  API routes         │       │  standalone TS files │
│  BigQuery, HubSpot, │       │  import server libs  │
│  Jira, Sentry, etc. │       │  auto-discovered     │
└─────────────────────┘       └─────────────────────┘
```

### Core Principles

1. **Everything is SQL-backed.** All stateful data lives in the SQL database — settings, application state, configurations. The UI reads and writes data via API routes. The AI agent reads and writes data via scripts and SQL helpers. This is the shared state mechanism. Using `DATABASE_URL`, the same database can be accessed locally or from a cloud provider.

2. **Scripts are the backend escape hatch.** Any backend logic the AI needs (BigQuery queries, image generation, API calls) lives as standalone scripts in `scripts/`. The agent runs them via `pnpm script <name> --arg=value`. Scripts can be generated on the fly or committed for reuse.

3. **The UI can delegate to the AI agent.** Use `sendToAgentChat()` from `@agent-native/core` to programmatically submit prompts to the agent chat. This lets UI buttons trigger agentic workflows — the button provides the structured prompt, and the agent does the work. This is vastly more flexible than building custom backend endpoints for every feature.

### Data Storage

Dashboard configs, explorer configs, and theme settings are stored in SQL via the settings API:

| Key Pattern       | Contents                           |
| ----------------- | ---------------------------------- |
| `dashboard-{id}`  | Dashboard configuration and layout |
| `config-{id}`     | Explorer/tool configuration        |
| `analytics-theme` | Theme settings (colors, dark mode) |

Use `getSetting(key)` / `putSetting(key, value)` from `@agent-native/core/settings` to read/write these.

### Multi-User Collaboration

For multi-user access, set `DATABASE_URL` to a cloud database provider (Turso, Neon, etc.). The SQL database handles remote access natively — no separate file sync system needed.

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
    "The TierBreakdownCharts component at app/pages/adhoc/tier-breakdown/TierBreakdownCharts.tsx is throwing a BigQuery byte limit error. Switch from @app_events to the Amplitude table.",
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

- Simple CRUD that the UI can handle directly via API calls
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
pnpm script hubspot-deals --grep="enterprise" --fields=dealname,amount,stageLabel
pnpm script seo-top-keywords --grep=remix --fields=keyword,rank_absolute,etv
```

### AI Agent Script Usage

The AI agent should:

1. Use `--grep` and `--fields` to narrow output — never pipe raw JSON through grep
2. Reuse existing scripts when possible
3. Generate new scripts in `scripts/` when needed for new backend functionality
4. For one-off tasks, generate a script, run it, and clean it up
5. For reusable tasks, generate a script and keep it

## Learnings & Skills (MANDATORY)

Knowledge is stored in two places:

1. **`.builder/skills/<provider>/SKILL.md`** — provider-specific knowledge (tables, API quirks, auth, scripts, gotchas). This is the primary knowledge store for each integration. Read the relevant skill before querying any provider.

2. **`AGENTS.md` + `LEARNINGS.md` resources** — cross-cutting knowledge (contacts, preferences, agent behavior rules, customer data, UI patterns). Read both (personal and shared scopes) before doing any work.

### Rules

1. **ALWAYS read `AGENTS.md` and `LEARNINGS.md` resources first (both scopes).** Non-negotiable. Before any work.
2. **Read the relevant skill** before querying a provider. It tells you table names, column names, join paths, auth, and patterns.
3. **Update skills directly.** When you discover something new about a provider, update that provider's SKILL.md. Skills should be continuously improved.
4. **Learn from corrections.** If the user corrects you, capture it in the relevant skill or LEARNINGS.md resource.
5. **Keep it concise.** Each learning should be actionable — what to do, what not to do, and why.

### What belongs where

| Content                                             | Location                |
| --------------------------------------------------- | ----------------------- |
| BigQuery table names, column mappings, SQL patterns | `bigquery/SKILL.md`     |
| API quirks for a specific provider                  | `<provider>/SKILL.md`   |
| Customer data (IDs, deal info, stakeholders)        | `LEARNINGS.md` resource |
| User preferences, UI patterns                       | `LEARNINGS.md` resource |
| Agent behavior rules                                | `LEARNINGS.md` resource |
| Chart styling preferences                           | `charts/SKILL.md`       |

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
pnpm script pylon-issues --account="Example Corp" --state=open

# Sales: recent calls
pnpm script gong-calls --company="Example Inc" --days=30

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
