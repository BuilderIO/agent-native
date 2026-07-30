---
"@agent-native/toolkit": patch
---

Fix `VisualInspectorPanel` clipping its own scroll area instead of scrolling. The panel body was capped by a viewport-derived `max-height`, so when a host laid the panel out shorter than the viewport — for example a style dock sharing vertical space with an expanded notes panel — overflowing content was hidden by the panel's `overflow-hidden` with no way to reach it. The body now flexes within the panel's actual height and keeps the cap as an upper bound.
