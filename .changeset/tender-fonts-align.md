---
"@agent-native/core": minor
---

Export `OG_FONT_FAMILY` from `@agent-native/core/server` alongside `resolveOgFontFiles`. Server-side SVG rasterization needs the family name and the bundled font files to agree — serverless runtimes have no system fonts, so a mismatch renders every `<text>` blank. Callers previously had to hardcode the family name to keep it in sync.
