---
"@agent-native/core": patch
---

Fix blank text in the default social/OG preview image (`/_agent-native/og-image.png`).
Linux serverless runtimes (Netlify/Lambda) ship neither Arial nor Inter, so resvg
had no font to render with and every `<text>` element came out empty — the card
showed only the logo and grid. The renderer now bundles Liberation Sans (a
metric-compatible Arial replacement) embedded as base64 and passes it to resvg via
`fontFiles`, independent of host system fonts. Also fixes the display title
rendering thin: resvg's fontdb maps `font-weight: 850` to Regular, so the title now
uses `800`, which resolves to Bold.
