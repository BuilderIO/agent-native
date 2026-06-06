---
"@agent-native/core": minor
---

Syntax-highlight code blocks in the shared rich markdown editor. When an embedder
enables `features.codeBlock` (Plans today), the editor now uses
`CodeBlockLowlight` with a curated lowlight grammar set (js/ts/tsx, json, css,
html, bash, python, yaml, sql, markdown) and a github-dark token theme, instead
of a plain monospace block. Inline code keeps its own background; block code no
longer leaks the inline-code background over the dark surface. Apps that ship
their own code node (Content's NFM editor disables `features.codeBlock`) are
unaffected.
