---
"@agent-native/core": patch
---

MCP Apps outside a directory listing now open embed tools as the full app in the host's side panel: the server keeps the session an action minted, or mints a full-app session for the page the result links to, instead of falling back to a plain link. Directory listings still mount only scoped widgets.

A full-app panel acts as its verified owner, as a signed-in browser does: it runs actions, including UI-only ones, through the app's own UI. It cannot reach MCP or A2A approvals, sign-in and account changes, connections, or developer routes; those still need a browser login.
