---
"@agent-native/core": patch
---

Derive Builder design-system readiness from the indexed document count instead of the drifting `builderStatus` field. `hydrateBuilderDesignSystemReference` now reads `docCount` from `/design-systems/v1/:id?includeDocumentCount=true`, and a count that cannot be read fails loudly instead of being reported as zero. Adds `fetchBuilderDesignSystemDocumentCount` and `isBuilderDesignSystemReadyByCount`.
