---
"@agent-native/core": patch
---

Harden agent tool dispatch with abort propagation, zombie-completion ledger, and scheduler resilience rail:

- **Abort signal into tools**: `ActionRunContext` gains an optional `signal?: AbortSignal` field (backward-compatible). The run's abort signal is now threaded through to every `actionEntry.run()` call so well-behaved actions can cancel in-flight work instead of waiting for the 60-second hard timeout.

- **Tool-call result ledger**: A new `agent_tool_ledger` table persists zombie completions (write-tool promises that resolve after `Promise.race` abandoned them on soft-timeout/abort). On continuation, when a write tool with the same `(threadId, toolName+inputHash)` key has a ledger entry, the continuation returns the ledger result without re-executing the side effect and without counting it toward the `MAX_WRITE_TOOL_INTERRUPTIONS` give-up budget. Ledger entries are cleared when a turn completes normally.

- **Scheduler through the resilience rail**: Recurring jobs now route through `startRun` from run-manager instead of a bare `runAgentLoop` call. This adds a heartbeat row in `agent_runs` so a serverless kill is detected by `reapAllStaleRuns` on the next startup — no more permanently stranded `lastStatus:"running"` in job frontmatter. The soft-timeout wrapper is also applied so hosted jobs checkpoint cleanly before the function hard-kill boundary.
