---
"@agent-native/core": patch
---

Emit PostHog-compatible `$ai_generation` tracking events from instrumented agent runs so LLM cost, latency, tokens, and errors can flow through configured tracking providers, and expose the shared database admin page through the client barrel for app-owned admin surfaces.
