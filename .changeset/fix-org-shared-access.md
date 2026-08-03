---
"@agent-native/core": patch
---

Grant org-visibility access on shareable resources based on the caller's real organization membership, instead of only their currently active organization. Fixes real org members being denied access to org-shared resources (e.g. recordings) when a different org happened to be active in their session.
