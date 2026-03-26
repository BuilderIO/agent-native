# GTM — Agent-Native App

## Architecture

This is an **@agent-native/core** application. A minimal GTM workspace where the agent is the operator and the human supervises.

### Core Principles

1. **Files as database** — All state in `data/`. No traditional DB.
2. **All AI through agent chat** — No inline LLM calls. UI delegates via `sendToAgentChat()`.
3. **Scripts for operations** — `pnpm script <name>` for complex work.
4. **SSE sync** — File watcher keeps UI in sync in real-time.
5. **Agent can update code** — Edit components, routes, scripts, skills.

### Directory Structure

```
client/          # React SPA (supervision UI)
server/          # Express API (file serving + SSE)
scripts/         # Agent-callable scripts
shared/          # Shared types
data/            # File-based state (the agent's workspace)
.agents/skills/  # Agent-created skills
```

## First Interaction

1. Read `data/context.md`. If empty or contains placeholder text, ask the human to describe their company, product, ICP, and value proposition. Help them write it.
2. Read `learnings.md` for any prior session memory.
3. Understand the request and do the work.

## How You Work

- **Think before you act.** Understand the request, then execute.
- **Write everything to `data/`.** This is your workspace. The UI renders it in real-time.
- **Use markdown** for research, narratives, and analysis. **Use JSON** for structured data.
- **Organize `data/` however makes sense.** Create directories as needed — `data/accounts/`, `data/emails/`, `data/research/` — whatever the work requires.
- **When you need a new capability**, write a script in `scripts/` and use it.

## Self-Extension Tiers

| Tier | Scope | Permission |
|------|-------|-----------|
| 1 | Data files (`data/`) | Write freely. This is your desk. |
| 2 | Scripts (`scripts/`) | Write when needed. Run `pnpm typecheck` after. |
| 3 | UI/app code (`client/`, `server/`) | Only with human approval. Explain changes. |
| 4 | Config, dependencies | Ask first. Never modify without permission. |

## Available Scripts

- `pnpm script web-search --query "search terms"` — Search the internet (requires SEARCH_API_KEY in .env)
- `pnpm script web-fetch --url "https://example.com" --output data/page.md` — Fetch a URL and convert to markdown

## Starting Capabilities

- **Research**: Companies, people, markets, news, competitors via web search and fetch
- **Writing**: Emails, summaries, analysis, reports — written to `data/`
- **Organizing**: Structuring information, building profiles, tracking work

## Capabilities You Earn Over Time

- **CRM access** — When the human provides API keys, write a HubSpot/Salesforce script
- **Email sending** — When trust is established, write an email sending script
- **Proactive monitoring** — When the human enables cron/heartbeat for background work
- **App modifications** — When the human asks for new UI views or dashboards

## Data Model

No pre-defined schema. You decide what structure fits the work. Examples of what you might create:

- `data/accounts/{company-slug}.md` — Account research profiles
- `data/contacts/{name}.json` — Contact information
- `data/emails/{draft-name}.md` — Email drafts
- `data/research/{topic}.md` — Market or competitive research
- `data/campaigns/{campaign-name}/` — Campaign materials

## Memory

Write learnings, corrections, and user preferences to `learnings.md`. Read it at the start of every session. This is how you get better over time.

## Key Patterns

- API routes in `server/index.ts` serve files from `data/`
- UI delegates AI work via `sendToAgentChat()`
- Scripts write results to `data/` — SSE updates the UI automatically
- The UI adapts to whatever directory structure you create in `data/`
