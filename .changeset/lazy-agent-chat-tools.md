---
"@agent-native/core": patch
---

Build the agent chat plugin's realtime voice tools, QuickJS runner, database script modules and CLI actions prompt on first use instead of at mount (a failed QuickJS or script load is retried on the next call), and check raw-query input last when choosing an agent card's direct skills.
