---
"@agent-native/core": patch
---

MCP user-turn grants: an action can declare `userTurn: "read" | "approval"` so a verified MCP user's call that carries a grant minted by the signed-in app page (`mint-turn-grant`, sent in the `x-agent-native-turn-grant` header) runs as that person's foreground turn. Declared kinds are advertised as `_meta["agent-native/userTurn"]` in the tool listing; `"approval"` writes are approved on the app's own review page, and `requiresUserTurn: true` refuses an MCP call that carries no grant. `registerMcpChatTurnApps()` lets `ask_app` attach a signed chat-turn proof for the named apps. Apps that declare none of these behave as before.
