---
"@agent-native/core": patch
---

Actions report a transaction PostgreSQL rolled back to break a deadlock (`40P01`) or a serialization conflict (`40001`) as a typed `transaction_conflict` (409) error instead of an untyped "Failed query". The message tells the caller to read the current state and redo only what is missing, since anything the action saved outside that transaction stays saved.
