---
"@agent-native/core": patch
---

Fix Mermaid block runtime loading so Vite rewrites the browser-only Mermaid and
Excalidraw imports instead of leaving unresolved bare module specifiers in the
browser.
