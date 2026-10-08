---
"@agent-native/core": patch
---

A directory MCP App widget now fills a Codex or ChatGPT side pane that sizes its frame only from the height the widget reports: the shell reports the tallest height the viewer's screen can show instead of the app's content height, tells the nested app the frame has a fixed height so it lifts its inline-card clamp, and asks a host that offers fullscreen for it once on the first click into the app.
