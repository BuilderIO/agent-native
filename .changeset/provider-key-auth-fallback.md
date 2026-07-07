---
"@agent-native/core": patch
---

Skip saved model provider keys after auth failures so chats can fall back to Builder credentials instead of repeatedly retrying rejected BYO keys.
