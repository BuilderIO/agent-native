---
"@agent-native/core": patch
---

Prebundle `diff-match-patch` so the collab text-to-Yjs path loads in the browser.

`diff-match-patch@1.0.5` ships one CJS file with no ESM entry. It is reached from
`collab/text-to-yjs.ts`, which in monorepo dev mode is a source-aliased core
module excluded from dep prebundling, so Vite never scanned the import and served
the dependency verbatim — its trailing `module.exports` lines threw in the
browser. It now has a default `optimizeDeps.include` entry like the other CJS
dependencies core reaches from client code.
