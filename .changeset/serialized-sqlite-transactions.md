---
"@agent-native/core": patch
---

Concurrent top-level async transactions on the better-sqlite3 driver are serialized per connection. Previously a transaction starting while another was open saw `inTransaction` and opened a savepoint inside the other task's transaction, which then committed out from under it ("no such savepoint" 500s under concurrent reads/writes). Same-task nesting is detected via AsyncLocalStorage and keeps the direct savepoint path.
