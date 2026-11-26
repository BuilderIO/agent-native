---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Slack's channel status now asks Slack whether the saved bot token still works, at most once every five minutes per token. When Slack refuses it (`invalid_auth`, `token_revoked`, `token_expired` or `account_inactive`), the status reports the token as rejected with Slack's reason, and Dispatch's Messaging page shows "Token rejected" with what to do, instead of "Connected" and "Messages are flowing".
