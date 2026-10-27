---
"@agent-native/toolkit": patch
---

Show what the agent is doing when you are not looking at its chat:

- While a run is active in the tab, the page title starts with "Working ·" and the favicon gets a small dot. When a reply finishes while the tab is hidden, the title starts with "Reply ready ·" until you come back. The app's own title and favicon are restored exactly when the run ends.
- A chat whose reply finished while you were viewing something else shows an unread dot in the chat history list and rail until you open it. Unread chats are kept per user in `application_state` (`chat-unread`), so the dot follows you across tabs, reloads and devices.
