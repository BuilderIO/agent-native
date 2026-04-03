---
name: storing-data
description: >-
  How and where to store application data. Use when adding new data models,
  deciding between settings vs Drizzle tables, reading/writing app config,
  or working with application state.
---

# Storing Data

## Where Data Goes

All persistent data lives in SQL. Issue data comes from the Jira Cloud API — the app proxies requests through the Nitro backend. Agent notes and application state are stored locally in SQL.

### Storage Layers

| Layer | Purpose | API |
|-------|---------|-----|
| Settings | Persistent app config | `getSetting`/`putSetting` from `@agent-native/core/settings` |
| Application State | Ephemeral UI state, agent <-> UI bridge | `readAppState`/`writeAppState` from `@agent-native/core/application-state` |
| OAuth Tokens | Atlassian credentials | `@agent-native/core/oauth-tokens` |

## Related Skills

- **real-time-sync** — Database writes trigger poll events to update the UI
- **scripts** — Scripts read/write data via core SQL stores
