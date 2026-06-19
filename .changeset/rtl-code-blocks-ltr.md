---
"@agent-native/core": patch
---

Keep code-like blocks left-to-right inside RTL plans. Code, code-tabs, diff,
file-tree, annotated-code, API endpoint, OpenAPI spec, JSON explorer,
data-model, schema-editor, diagram, mermaid, and wireframe blocks now pin their
outermost element to `dir="ltr"` (via a shared `ltrCodeBlockProps` helper) so
they no longer inherit a Persian/Arabic plan document's RTL direction and render
reversed. Prose, rich-text, and callout blocks intentionally stay RTL.
