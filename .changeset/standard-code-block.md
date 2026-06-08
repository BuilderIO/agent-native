---
"@agent-native/core": minor
---

Add a standard `code` dev-doc block: a single syntax-highlighted snippet
(Notion-style — one border, hover-revealed language switcher + copy button,
collapse-to-N-lines) with an optional filename header. It is the primitive code
block; a multi-file "rail" is just a `tabs` block containing `code` blocks, so
there is no bespoke container. The legacy `code-tabs` block stays renderable for
stored documents but is no longer authored. The pure schema/MDX config lives in
`code.config.ts` (React-free, safe for the server MDX adapter and SSR bundle).
