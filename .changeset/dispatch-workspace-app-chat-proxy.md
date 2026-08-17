---
"@agent-native/dispatch": minor
---

Point the chat beside an open workspace app at that app's own agent. Dispatch now proxies `/_agent-native/workspace-app-chat/<appId>/**` to the app's `/_agent-native/agent-chat`, authenticated with the app's own embed session, so the rail has the app's tools, AGENTS.md, skills, app-scoped resources, and dev-mode surface instead of Dispatch's. When the proxy cannot be established the rail shows a retryable error rather than silently answering from Dispatch's agent, and workspace-level chat with no app open is unchanged.
