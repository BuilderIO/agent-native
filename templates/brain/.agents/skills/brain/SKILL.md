---
name: brain
description: Work with the Brain institutional-memory template, including importing captures, validating quote evidence, writing knowledge, and reviewing proposals.
---

# Brain Template

Use Brain actions rather than raw SQL.

1. Import raw material with `import-capture` or `import-transcript`.
2. Call `enqueue-distillation` when a capture needs distillation.
3. Before writing knowledge, call `get-capture` and copy short exact quotes.
4. Call `write-knowledge` with `evidence` entries whose `quote` fields are exact capture substrings.
5. If `write-knowledge` returns `mode: "proposal"`, leave it in review unless the user asks to approve.

Search uses `search-knowledge`; there is no vector index.
