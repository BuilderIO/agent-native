---
"@agent-native/core": patch
---

The client replays a 401 or 403 for a minute only inside an embed, where it stops an expired embed token from setting off a retry storm. Outside an embed every read reaches the server, so a page shared with someone mid-session loads all of its reads as soon as access arrives instead of failing one of them with the earlier refusal.
