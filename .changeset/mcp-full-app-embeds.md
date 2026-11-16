---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

MCP Apps outside a directory listing now open embed tools as the full app in the host's side panel: the server keeps the session an action minted, or mints a full-app session for the page the result links to, instead of falling back to a plain link. Directory listings still mount only scoped widgets.

A full-app panel acts as its verified owner, as a signed-in browser does: it runs actions, including UI-only ones, through the app's own UI. It cannot reach MCP or A2A approvals, sign-in and account changes, connections, OAuth starts, stored secrets and provider keys, or developer routes; those still need a browser login. Actions declare the same with `requiresSignedInBrowser: true`, which the framework sets on its credential, member, service-token and key-policy actions.

Dispatch's `open_app` asks the target app for an embed session whenever an MCP host calls it, so the full app opens in the host's side panel without the caller passing `embed: true`.
