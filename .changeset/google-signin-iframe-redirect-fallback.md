---
"@agent-native/core": patch
---

Fix Google sign-in inside an embedded iframe (e.g. the Design app's local visual-edit canvas): when the popup flow fails to open, the redirect fallback now checks for any iframe embedding instead of only Builder's own preview iframe, avoiding the same-frame redirect that Google always rejects with a 403 for framed requests.
