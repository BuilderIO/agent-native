---
"@agent-native/core": patch
---

Share the private-turn assistant-text and UI-completion predicates across `run-manager`, `production-agent`, and `agent-chat-plugin` so completed private turns do not chain `auto_continue` runs.
