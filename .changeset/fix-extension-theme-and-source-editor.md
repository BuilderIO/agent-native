---
"@agent-native/core": patch
---

Fix extension iframe theme inheritance and add source-code editor. Extensions now correctly inherit the host app's dark/light theme and CSS custom properties instead of rendering with a white background. Adds a raw HTML/Alpine.js source editor dialog to ExtensionViewer so extensions can be edited directly without going through the AI chat.
