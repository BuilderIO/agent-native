---
"@agent-native/core": patch
---

`fingerprintMedia` no longer imports `node:crypto`. It is re-exported from the
`ingestion` barrel, so that one import made the whole barrel — the Figma
converters included — fail to load in a browser. It now uses `@noble/hashes`,
verified to produce the same SHA-256 digest.
