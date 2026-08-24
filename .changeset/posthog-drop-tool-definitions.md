---
"@agent-native/core": patch
---

Stop sending the app's tool definitions to PostHog. `$ai_tools` shipped the whole catalogue — for a large app, dozens of tools with full descriptions — on every generation, and it is identical on every call. The calls that actually happened are already named in `$ai_output_choices` and carry their own spans.
