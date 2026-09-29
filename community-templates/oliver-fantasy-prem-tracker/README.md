# Oliver Fantasy Prem Tracker

A live Fantasy Premier League dashboard: the Premier League table, top goal
scorers, top assisters, top clean sheets, top FPL point scorers, FPL news, and
rule-based transfer/tip recommendations, refreshed live from public football
data sources. Built on the agent-native framework, so the same data is also
available to the in-app agent.

## Features

- Live Premier League table (rank, played, W/D/L, goal difference, points).
- Leaderboards for goals, assists, clean sheets, and total FPL points.
- Player recommendations and tips, scored from current form, points per game,
  and upcoming fixture difficulty.
- Latest FPL news headlines.
- Everything refreshes on a timer — no manual reload needed.

## Data sources

- Fantasy Premier League public API (`fantasy.premierleague.com/api`) for
  player stats, fixtures, and fixture difficulty.
- ESPN's public soccer standings API for the live Premier League table.
- Fantasy Football Scout's RSS feed for news.

All three are public, unauthenticated endpoints — no API keys required. See
`server/lib/fpl.ts` for the fetch + cache layer and `actions/get-fpl-*.ts` for
the actions that expose this data to the UI and the agent.

## Develop locally

```bash
cd community-templates/oliver-fantasy-prem-tracker
pnpm install
pnpm dev
```
