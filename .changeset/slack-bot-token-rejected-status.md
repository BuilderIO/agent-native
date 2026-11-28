---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Slack's channel status now asks Slack whether the saved bot token still works. It asks at most once every five minutes per token, or 30 seconds after a check that couldn't reach Slack. When Slack refuses the token (`invalid_auth`, `token_revoked`, `token_expired` or `account_inactive`), the status reports the token as rejected with Slack's reason. Dispatch's Messaging page then shows "Token rejected" with what to do, instead of "Connected" and "Messages are flowing". When a managed Slack workspace is connected, its status stands and only the legacy token row shows "Rejected".
