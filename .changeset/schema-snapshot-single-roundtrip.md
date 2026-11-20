---
"@agent-native/core": patch
---

A fresh database now installs the framework schema snapshot in one statement instead of one round trip per statement. On hosted Postgres the per-statement install took about 26s of a first publish.
