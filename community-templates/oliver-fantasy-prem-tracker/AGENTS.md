# Oliver Fantasy Prem Tracker — Agent Guide

A live Fantasy Premier League (FPL) dashboard. The main screen is `/dashboard`
(also the redirect target for `/home`): the live Premier League table,
leaderboards (goals, assists, clean sheets, points), FPL news, and rule-based
player recommendations. Chat threads (`/chat/:threadId`) are still available
from the sidebar for follow-up questions.

## Data And Actions

All football data comes from public, unauthenticated APIs fetched live and
cached briefly in-memory — no credentials needed. The fetch + cache layer is
`server/lib/fpl.ts`:

- Fantasy Premier League API (`bootstrap-static`, `fixtures`) for player stats
  and fixture difficulty.
- ESPN's public soccer standings endpoint for the real Premier League table
  (the FPL API's own team `played`/`points` fields are placeholders, not live
  results — do not use them for the table).
- Fantasy Football Scout's RSS feed for news.

Actions (all read-only `GET`, all agent-callable tools):

| Action | Purpose |
| --- | --- |
| `get-fpl-table` | Live Premier League table. |
| `get-fpl-leaders` | Leaderboard for one category: `goals`, `assists`, `clean_sheets`, or `points`. |
| `get-fpl-fixtures` | Upcoming fixtures with FPL difficulty ratings. |
| `get-fpl-recommendations` | Players to sign / tips, scored from form, points per game, and upcoming fixture difficulty. Optional `position` filter. |
| `get-fpl-news` | Latest FPL news headlines. |

The recommendation scoring in `get-fpl-recommendations` is deterministic
(form, points-per-game, and fixture difficulty combined into a number), not an
LLM call — keep it that way. If the user wants free-form analysis or
comparisons beyond what these actions return, that's a job for the agent in
chat, not a new heavyweight action.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work. This app
  has no durable app-owned tables — all data is live/cached, not persisted.
- Never hardcode API keys or tokens. The data sources here are public and need
  none; if a future data source needs a credential, use secrets/OAuth
  primitives instead of `process.env`.
- Keep actions deterministic and focused. Research, analysis, and synthesis
  beyond the fixed leaderboards/recommendations start in the AgentSidebar.
- Never fabricate stats. If a fetch fails, surface the failure — don't invent
  numbers.
- Use `view-screen` or application state when the active page/selection is
  unclear.

## Application State

- `navigation` describes the current view. `/dashboard` is the default
  landing view; `/chat/:threadId` is a conversation.
- `navigate` moves the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
