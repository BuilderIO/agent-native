---
"@agent-native/core": minor
---

Agent Teams completion loop, stop affordances, and orphan sweep

- **Completion loop (P0)**: `finalizeAgentTeamRun` now appends a durable `parent-completion` injection to the parent thread's app-state queue and writes a NotificationsBell entry. The orchestrator chat's `prepareRequest` drains these injections and prepends them to the next user message so sub-agent results surface automatically without manual polling.

- **Sub-agent tab read-only (P1)**: Sub-agent tabs in `MultiTabAssistantChat` now disable the composer (`composerDisabled`) with a descriptive placeholder. Sending from a sub-agent tab would start a new run on that thread and kill the in-flight team chunk; the disabled composer prevents this without touching `AssistantChat.tsx`.

- **Stop affordances (P1)**: Added `POST /runs/:id/stop` route in agent-chat-plugin that delegates to `stopAgentTeamBackgroundRun`. `RunsTray` now shows a stop button (Tabler `IconPlayerStop`) for running agent-team rows. `AgentTaskCard` shows a Stop button in its footer while the task is running. Both use optimistic UI.

- **Orphan sweep (P2)**: A server-side sweep runs every 2 minutes (via a 30s check interval + 2-min throttle) to reconcile all owners with active queue rows. Re-fires stuck/queued dispatches when the browser is closed and no RunsTray poll triggers.
