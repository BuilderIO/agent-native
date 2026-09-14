---
"@agent-native/core": patch
---

Pin the command menu's Ask AI fallback row to a stable cmdk selection value. The row's visible text embeds the live query, so cmdk re-derived its selection identity from the text on every keystroke and the selection went stale mid-search, leaving the palette with no highlighted item right as async results arrived.