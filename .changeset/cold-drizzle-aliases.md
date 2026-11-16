---
"@agent-native/core": patch
---

Fix cold database handles returning unusable aliased select subqueries and CTEs, including set operations, preserve Drizzle field-order validation in nested set helpers, and clarify how to construct unsupported write CTEs after the database is ready.
