---
"@agent-native/core": patch
---

Route new-user magic-link callbacks before the generic handler so signup links with nested query parameters do not receive a 405.
