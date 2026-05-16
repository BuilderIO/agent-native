---
name: brain
description: Work with the Brain institutional-memory template, including importing captures, validating quote evidence, writing knowledge, and reviewing proposals.
---

# Brain Template

Use Brain actions rather than raw SQL.

1. Call `get-brain-settings` before answering, searching broadly, or distilling when current settings are not already in context. Apply the returned guidance for assistant name, company name, tone, source policy, citation requirements, publish tier, redaction, and distillation instructions.
2. Import raw material with `import-capture` or `import-transcript`.
3. Call `enqueue-distillation` when a capture needs distillation.
4. Before writing knowledge, call `get-capture` and copy short exact quotes.
5. Call `write-knowledge` with `evidence` entries whose `quote` fields are exact capture substrings.
6. If `write-knowledge` returns `mode: "proposal"`, leave it in review unless the user asks to approve.

Search starts with `search-everything` when available and uses `search-knowledge` for distilled knowledge only; there is no vector index. Follow `sourcePolicy`: `strict` means reviewed knowledge only, `balanced` means raw captures are labeled fallback context, and `exploratory` means raw captures and sources can be labeled leads.

For "ask across everything" requests, follow the `ask-across-everything` skill:
search Brain first, inspect `federatedCoverage`, delegate live/app-owned data
requests with `call-agent`, and never claim Brain searched sibling app databases
directly.
