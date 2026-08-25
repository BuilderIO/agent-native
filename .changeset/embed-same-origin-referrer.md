---
"@agent-native/core": patch
---

Keep a same-origin Referer on validated embed responses so an embedded Dispatch can open workspace apps. Embed responses previously used `Referrer-Policy: no-referrer`, which stripped the Referer from every same-origin request the page made for the life of the document, so `create-workspace-app-embed-session` rejected Dispatch itself with "Workspace app sessions must be requested by Dispatch." Cross-origin referrers stay fully suppressed.
