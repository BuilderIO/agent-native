---
"@agent-native/code-agents-ui": patch
---

Detect missing-provider-credential transcript events using the shared `isCredentialGapCodeAgentEvent` helper from `@agent-native/core/client` instead of a locally duplicated regex, so the Agent tab's "hide resolved credential prompts" behavior stays in sync with the rest of the code-agent transcript pipeline.
