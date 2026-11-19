---
"@agent-native/core": patch
---

When a signed-in user connects a workspace OAuth account already linked to another user, the callback now returns them to the in-app return URL with `oauth_error=account_already_linked` and `oauth_account` instead of a dead-end error page. Added `OAUTH_ACCOUNT_ALREADY_LINKED_ERROR` and `readConnectionOAuthCallbackError` (from `@agent-native/core/connections/oauth-callback-error`) to read it.
