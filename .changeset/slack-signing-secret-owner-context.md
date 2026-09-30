---
"@agent-native/core": patch
---

Allow the deployed Slack app's signing secret to verify webhooks under the integration owner's credential context while preserving scoped overrides and synthetic-request isolation. Keep unreadable hosted credential stores from falling through to deployment credentials.
