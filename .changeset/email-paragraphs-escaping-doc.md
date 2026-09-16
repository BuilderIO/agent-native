---
"@agent-native/core": patch
---

Correct the `renderEmail` `paragraphs` doc comment: the strings are injected verbatim, not escaped, so callers must wrap user-supplied values in `emailStrong`/`emailQuote`.
