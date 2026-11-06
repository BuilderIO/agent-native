---
"@agent-native/toolkit": patch
"@agent-native/core": patch
"@agent-native/agentkit": patch
---

Separate app context from scoped workspace integration contributions in the shared composer, preserve references through app handoffs, and revalidate integration access before engine dispatch. Preserve bounded app-owned source identifiers in composer draft metadata. Support transport-owned binary uploads in AgentKit and provide the native file-storage upload lifecycle across shared composers.
