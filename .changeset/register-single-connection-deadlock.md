---
"@agent-native/core": patch
---

Fix email/password sign-up hanging for about 45 seconds and returning 500 on serverless hosts. Better Auth's database handle now routes `getDbExec()` calls made inside its transaction onto that transaction, a database call that can never get the pool's only connection now fails immediately with `DbPoolSelfDeadlockError`, and on serverless a retry loop gives up before it can outlast the gateway.
