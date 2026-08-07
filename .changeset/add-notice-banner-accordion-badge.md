---
"@agent-native/core": patch
---

Add four new docs MDX components — `Notice`, `Banner`, `Accordion`, `Badge` — for content that doesn't belong in a `Cards` grid: a bold alert card, a page/section-top announcement strip, collapsed-by-default FAQ items, and a small status chip. Also fixes the `Steps`/`Cards`/`Comparison`/`Accordion` markdown parser to be fence-aware (a `###` inside a code sample no longer splits into a new item) and to round-trip items with a genuinely empty body, and teaches the docs' crawlable markdown mirror to render all seven docs-only block types as readable text instead of a raw JSON fence.
