---
"@agent-native/core": patch
---

`pnpm action`, `agent-native agent` and SQL queries through the dev server now act in the same org the app uses for the signed-in user (their active org, else their first membership) when `AGENT_ORG_ID` is not set. Before, they ran with no org and saw only the user's personal rows, so the agent reported empty lists for rows the UI showed. An explicit `AGENT_ORG_ID` still wins, and a command the agent runs for a personal request stays personal (`AGENT_ORG_SCOPE=personal`).
