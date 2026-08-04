---
"@agent-native/core": patch
---

Expose the shared automation service and run history so template-native factory surfaces can inspect and edit organization automations without duplicating scheduler behavior. Register Factory in the shared Slack, GitHub, and Sentry connection catalog so Dispatch can surface the same organization-owned credentials to it.
