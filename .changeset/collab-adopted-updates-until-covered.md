---
"@agent-native/core": patch
---

`useCollaborativeDoc` with `durableUpdates` keeps another tab's stored updates that a doc took up until the server acknowledges them or the doc's own rebuild keeps their content, instead of removing them once the doc stored its own entry. A page whose update the server then refused no longer lost the other tab's text on reload, and a page that closes mid-rebuild leaves that text stored once.
