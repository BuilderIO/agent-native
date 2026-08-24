---
"@agent-native/core": patch
---

Restore the loud failure when an unresolved `getDb()` query chain is embedded as a raw value instead of being awaited. drizzle duck-types SQL entities by reading `getSQL`/`shouldOmitSQLParens` synchronously, so the lazy cold-start proxy answering that probe with another proxy produced `RangeError: Maximum call stack size exceeded` deep inside drizzle instead of naming the misuse. The guard was lost as collateral in a wholesale revert of `packages/core/src/db`.
