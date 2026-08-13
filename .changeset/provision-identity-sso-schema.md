---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Provision cross-app SSO state and authorization-code tables during release migrations so production serverless requests never perform schema DDL.
