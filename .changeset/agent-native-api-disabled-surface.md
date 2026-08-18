---
"@agent-native/core": patch
---

Add `setAgentNativeApiDisabled(reason)` for surfaces framed by a host with no
agent-native session, so the client stops calling `/_agent-native/*` instead of
401-ing on every poll. Action queries do not fire, action fetches and
application-state reads/writes throw `AgentNativeApiDisabledError`, session reads
resolve as signed out, and the runtime-config ping is skipped.
