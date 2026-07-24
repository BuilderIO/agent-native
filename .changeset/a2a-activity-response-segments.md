---
"@agent-native/core": patch
---

Keep delegated agent (A2A) response text visible instead of flashing and
vanishing. Remote response text is now tracked as ordered segments interleaved
with the sub-agent's reasoning and tool calls, so nested "Asking <agent>" output
reads like top-level chat output — markdown text, tools, and thinking in the
order they happened.
