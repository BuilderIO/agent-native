---
"@agent-native/core": patch
---

Actions now accept a boolean for a parameter declared as the strings `"true"` and `"false"`. Models read a flag like `compact` as a boolean and send `false`; that call used to fail validation, and it now runs as `"false"`.
