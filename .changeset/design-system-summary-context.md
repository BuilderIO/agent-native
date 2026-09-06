---
"@agent-native/core": patch
---

`loadAgentDesignSystemContext` returns a bounded summary on reads and the full design-system context only when asked (`{ full: true }`); an unreadable link now says whether retrying can help.
