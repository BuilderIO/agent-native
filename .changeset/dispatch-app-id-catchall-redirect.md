---
"@agent-native/dispatch": patch
---

fix: bounce `/dispatch/<workspace-app-id>` to `/<workspace-app-id>` so Builder.io's "navigate to /<id>" calls — and any OAuth round-trip whose callbackURL captured that wrong path — land on the actual workspace app instead of a 404 inside Dispatch's chrome.
