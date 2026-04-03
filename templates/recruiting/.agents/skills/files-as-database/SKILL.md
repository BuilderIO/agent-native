---
name: storing-data
description: >-
  How and where to store application data. Use when adding new data models,
  deciding between settings vs Drizzle tables, reading/writing app config,
  or working with application state.
---

# Storing Data

## Where Data Goes

Recruiting data comes from the **Greenhouse Harvest API**. Agent notes are stored locally in SQL. Application state (navigation, commands) is in the `application_state` SQL table.

### Storage Layers

| Layer | Purpose | API |
|-------|---------|-----|
| Greenhouse API | Jobs, candidates, applications, interviews | Via local API proxy |
| `agent_notes` table | AI analysis notes per candidate | Drizzle ORM |
| Settings | Persistent app config (API key) | `@agent-native/core/settings` |
| Application State | Navigation, agent commands | `@agent-native/core/application-state` |

## Related Skills

- **real-time-sync** — Database writes trigger poll events to update the UI
- **scripts** — Scripts read/write data via core SQL stores
