---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Starting an app branch for an email Builder does not recognize now retries with the connected account's user id whatever status Builder answers with. When there is no account to fall back to, the failure says the email is not a member of the connected Builder space instead of calling it temporary.
