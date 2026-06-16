---
"@agent-native/core": patch
---

PR Visual Recap workflow reliability + clarity:

- Narrow the self-modifying-code skip guard so it only false-skips legitimate
  recaps: it still fires for fork PRs and for all public-repo PRs (where an
  author could rewrite loaded `AGENTS.md`/`CLAUDE.md`/`.claude`/`.mcp.json` to
  exfiltrate the secret-backed agent run), but is skipped for private-repo
  same-repo PRs whose authors are trusted org members.
- Surface the skip reason via `core.notice` so it appears as a run-summary
  annotation, not just a buried log line.
- Retry the agent once when it exits without writing `recap-source.json` (a
  transient miss that previously failed the whole recap with an ENOENT).
- Upload the agent transcript (`claude-result.json`/`codex-events.jsonl` + stderr)
  alongside `recap-source.json` on failure, so a recap that fails because the
  agent produced no/invalid output is debuggable instead of a black box.
