---
"@agent-native/core": patch
---

Add a structured `signal: "credential-gap"` marker to code-agent transcript events and export a shared `isCredentialGapCodeAgentEvent` helper so history builders (`thread-data-builder.ts`, `code-agent-transcript.ts`) detect the "no LLM provider key" condition from the executor's structured field instead of regex-matching the hint text. The regex remains only as a fallback for already-persisted transcripts that predate the field.
