---
"@agent-native/core": patch
---

Stabilize the system-prompt prefix for Anthropic prompt caching: the runtime-context block now carries only day-granular date info (precise current time moved to a per-turn <current-time> block in the user message), system prompts assemble stable-first with runtime context appended last, and the direct Anthropic engine now sets a moving cache breakpoint on the last user message so growing conversation history is cached turn-over-turn.
