---
"@agent-native/core": patch
---

Reduce first-request token usage further: recurring jobs and automation triggers now defer framework-addition tools behind tool-search instead of always seeing the full registry; the MCP `ask_app` inner loop now uses the same compact initial-tool surface as interactive chat and A2A; the corpus-tools prompt (provider-api-request/provider-corpus-job/query-staged-dataset/run-code) no longer teaches tools by name that are missing from the first request's active tool set; oversized LEARNINGS.md/MEMORY.md content is capped instead of inlined in full outside lazy-context mode; and the First-Session Personalization block is now gated on the owner's persisted `personalization` flag instead of thread history, so a thread's system prompt stays byte-identical across turns 1 and 2 (fixing a prompt-cache break on every thread's second request).
