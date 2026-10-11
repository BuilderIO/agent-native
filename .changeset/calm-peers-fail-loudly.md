---
"@agent-native/core": patch
"@agent-native/agentkit": patch
"@agent-native/toolkit": patch
---

Fix chat turns that died or looked broken for recoverable reasons. A turn that yields to a connection request is recorded as awaiting input instead of a truncated run (no synthetic auto-continue, no chained successor), and automations record the yield as a typed connection_required failure and pause. Stale connection cards retire with their run, and a chat that does not own a pending connection resume no longer shows a stuck "Connection failed" banner. A failed peer-app call shows the app name once with a short reason and keeps its participant after the run finishes. Peer-app failures carry typed codes so the caller stops retrying an unfixable peer, and a peer that needs a connection returns a do-not-retry result. An org A2A secret equal to the deploy secret is refused, and the resulting identity demotion is logged.
