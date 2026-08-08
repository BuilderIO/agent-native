---
"@agent-native/core": patch
---

Stop MCP hydration from running on every serverless cold start. Eager
initialization now only happens on long-lived runtimes; serverless functions
initialize on first use from the agent-chat handler, the MCP management routes,
and the recurring-jobs sweep. The 60-second MCP config refresh timer is gated by
`shouldDisableInProcessSweeps()` like the other in-process sweeps, and an
unreadable settings table now rejects with `McpConfigUnreadableError` instead of
being coerced into "no MCP servers configured".
