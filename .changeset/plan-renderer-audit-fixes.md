---
"@agent-native/core": patch
---

Plan/recap renderer audit fixes: per-block salvage with error boundary (one bad block shows an "Unsupported block" card instead of blanking the document); annotated-code collapse for long unannotated runs; auto-TOC synthesis from block semantics when heading-derived items are sparse; file-tree rows carry data-file-path for recap files-rail scroll; export exceedsPlanBlockDepth from shared plan-content for server-side depth-exceeded detection in salvage path.
