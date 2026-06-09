---
"@agent-native/core": patch
---

PR Visual Recap: make the Codex backend actually work in CI. Two fixes:

1. **Auth.** The `Run agent (Codex)` step now pipes `OPENAI_API_KEY` into
   `codex login --with-api-key` (writing `~/.codex/auth.json`) before
   `codex exec`, instead of relying on the bare environment variable. On the
   `gpt-5.5` WebSocket transport Codex was dropping the `Authorization` header on
   the `wss` path and its HTTPS fallback, so every recap failed with `401 Missing
bearer or basic authentication in header` and the PR comment reported
   "generation failed".

2. **Sandbox + approvals.** `codex exec` now runs with
   `--dangerously-bypass-approvals-and-sandbox` instead of
   `--sandbox workspace-write`. Codex's bundled bubblewrap sandbox cannot
   initialize on the GitHub runner, so every shell command failed at startup and
   the agent could not read `recap.diff`; and under an approval gate the
   write-side plan MCP call (`create-visual-recap`) was auto-cancelled. The
   runner is itself an ephemeral throwaway sandbox, so this is the documented CI
   invocation.

Both fixes land in the in-repo workflow and the bundled copy the CLI writes into
consumer repos (kept byte-identical by the recap sync test).
