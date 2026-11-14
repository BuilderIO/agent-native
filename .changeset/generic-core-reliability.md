---
"@agent-native/core": minor
---

Framework reliability improvements: agent runs, run recovery and tool approvals report failures instead of settling as empty successes; actions, the action query cache and session hooks handle cold starts, retries and mounted base paths; sign-in, organization context and workspace connections resolve the right org and credential; provider API calls are metered per app and operation; deploy builds bundle the optional ingestion parsers; and MCP `tool-search` can recommend tools for a short task summary.
