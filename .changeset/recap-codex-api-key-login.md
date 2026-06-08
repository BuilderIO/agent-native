---
"@agent-native/core": patch
---

PR Visual Recap: authenticate the Codex backend with an explicit API-key login.
The `Run agent (Codex)` step now pipes `OPENAI_API_KEY` into
`codex login --with-api-key` (writing `~/.codex/auth.json`) before `codex exec`,
instead of relying on the bare environment variable. On the `gpt-5.5` WebSocket
transport Codex was dropping the `Authorization` header on the `wss` path and
its HTTPS fallback, so every recap failed with `401 Missing bearer or basic
authentication in header` and the PR comment reported "generation failed". The
fix lands in both the in-repo workflow and the bundled copy the CLI writes into
consumer repos (kept byte-identical by the recap sync test).
