---
"@agent-native/core": patch
---

A write that is rejected before it writes no longer stops the agent run with "interrupted N time(s)". Actions can throw the new `NoWriteError` for a rejection raised before their first write; the framework accepts it only when no nested write ran, and the agent retries with corrected arguments. An MCP tool's `isError` result is a known failure. After a write whose outcome is really unknown, only an exact repeat stops the run; another call of that tool is declined and the turn goes on. Tool spans gain `outcome` and a finer `error_class`, and `agent_run_terminal` gains `blocked_tool` and `blocked_by`.
