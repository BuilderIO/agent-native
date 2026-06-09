---
"@agent-native/core": patch
---

Plan/editor block drag-handle menu now uses real Tabler icons instead of
hand-drawn CSS pseudo-element glyphs. The Delete item rendered a malformed,
oversized trash shape; Duplicate, Delete, and Insert-block-below now inline the
verbatim Tabler `copy`, `trash`, and `plus` outline SVGs (matching the
framework-wide `@tabler/icons-react` set), and the left-margin grip uses Tabler
`grip-vertical`. The editor is plain DOM (not React), so the markup is inlined
rather than imported. Removed the now-unused `--duplicate`/`--delete`/`--insert`
pseudo-element drawing rules from the injected menu stylesheet.
