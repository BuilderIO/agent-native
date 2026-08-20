---
"@agent-native/core": patch
---

Warn when `GOOGLE_SIGN_IN_CLIENT_ID` and `GOOGLE_CLIENT_ID` name different Google clients. Sign-in silently preferred the sign-in pair, so repairing `GOOGLE_CLIENT_SECRET` on a deploy that also set `GOOGLE_SIGN_IN_CLIENT_SECRET` changed nothing while appearing correct.
