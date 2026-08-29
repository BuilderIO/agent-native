---
"@agent-native/core": patch
---

Keep a signed-in visitor from being stranded on the login form when the session
endpoint is briefly unreachable. The login document's probe read any non-ok
status, unparseable body, or failed fetch as "signed out" — the signed-out
answer is a 200 carrying `{ error }`, so those all mean the question went
unanswered — and nothing retried it.
