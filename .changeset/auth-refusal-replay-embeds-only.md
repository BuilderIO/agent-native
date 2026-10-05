---
"@agent-native/core": patch
---

The client replays a 401 or 403 for a minute only inside an embed, where it stops an expired embed token from setting off a retry storm. Outside an embed every read reaches the server, so a page shared with someone mid-session loads all of its reads as soon as access arrives instead of failing one of them with the earlier refusal. When a link's status turns `allowed`, `useResourceAccessGate` also forgets replayed refusals, so a tab that still holds an embed token after leaving the embed reads the page again instead of replaying the old refusal.
