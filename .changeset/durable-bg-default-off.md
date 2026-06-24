---
"@agent-native/core": patch
---

Make durable background agent runs opt-in (default-off) again. Both the runtime
gate (`isFlagEnabled` in durable-background.ts) and the deploy-time `-background`
emit gate (`isDurableBackgroundDeployEnabled` in deploy/build.ts) now default to
OFF when `AGENT_CHAT_DURABLE_BACKGROUND` is unset; an app opts in only with an
explicit truthy value (`true`/`1`/`yes`/`on`). A premature fleet-wide default-on
caused real-user incidents (apps hit "Failed to dispatch background run" + chat
stalls) because the async background-function worker path is not yet proven
end-to-end and the deploy-time env opt-out is not reliably baked into a given
deploy. Re-enable default-on only after the 15-min background-function worker is
verified live in production.
