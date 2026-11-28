---
"@agent-native/core": patch
---

Google Calendar connections no longer ask for the calendar list scope. Google hasn't verified that scope for Builder's sign-in app, so asking for it made Google refuse new Google Calendar connections with `Error 401: disabled_client`. Calendar colors changed in an app stay in that app until the scope is verified and requested again.
