---
"@agent-native/core": patch
---

Reduce serialized tool-schema payload on background agent runs. `webhook-handler.ts` and `google-docs-poller.ts` now defer framework-added tools (integration memory, `call-agent`) behind an attached `tool-search` entry on the first request, keeping only the app's own actions visible up front — `createIntegrationsPlugin` supplies the app action names via a new `initialToolNames` option. `scheduler.ts` (`SchedulerDeps.getInitialToolNames`), `dispatcher.ts` (`TriggerDispatcherDeps.getInitialToolNames`), and `agent-teams.ts` (`AgentTeamRunConfig.initialToolNames`) gained the same opt-in filtering plumbing (tool-search attach + `filterInitialEngineTools` + `availableTools` for mid-run expansion), inactive by default so existing behavior is unchanged until a caller supplies an initial tool list.
