---
"@agent-native/core": patch
---

Scoped agent-access tokens can carry a signed `agentLabel` claim, so apps can name the agent a link was minted for instead of guessing from the user-agent. Like `viewerEmail`, it is audit/display-only and never consulted for authorisation.
