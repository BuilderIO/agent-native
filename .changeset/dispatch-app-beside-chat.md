---
"@agent-native/dispatch": patch
"@agent-native/toolkit": patch
---

Dispatch now shows the app beside the chat when the agent works in it. An app opened beside a chat is visible instead of sitting in a hidden panel, the panel keeps its width when the width utility is missing, an open requested before a new chat has an id is kept until it has one, and delegating to an app's agent opens that app. The agent is told to open the screen for show and open requests and to send follow-ups on an open app to that app's own agent.
