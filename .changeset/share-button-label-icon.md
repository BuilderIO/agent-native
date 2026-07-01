---
"@agent-native/core": patch
---

Add a `trigger="label-icon"` option to `ShareButton` that renders a leading
share glyph alongside the "Share" label, so the trigger matches adjacent
icon+label buttons (e.g. an Upload button). The default `"label"` trigger stays
text-only and `"icon"` stays icon-only.
