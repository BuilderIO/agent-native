---
"@agent-native/core": patch
---

Actions report a transaction PostgreSQL rolled back to break a deadlock (`40P01`) or a serialization conflict (`40001`) as a typed, retryable `transaction_conflict` (409) error instead of an untyped "Failed query".
