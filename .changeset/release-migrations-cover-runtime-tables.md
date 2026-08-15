---
"@agent-native/core": patch
---

Create framework chat, agent-run, harness-session, and usage-alert tables in release migrations so production request functions do not fail on missing schema. Upgrade Better Auth to the newest mature 1.6.x release for the Drizzle adapter stack-overflow fix.
