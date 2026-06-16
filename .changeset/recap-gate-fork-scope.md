---
"@agent-native/core": patch
---

PR Visual Recap workflow reliability + clarity:

- Scope the self-modifying-code skip guard to fork PRs only. A same-repo PR
  comes from a write-access author who already holds the secrets, so skipping it
  for merely touching `AGENTS.md`/`CLAUDE.md`/`.claude`/`.mcp.json` was a false
  positive (it blocked legitimate recaps in private repos). Fork PRs stay guarded.
- Surface the skip reason via `core.notice` so it appears as a run-summary
  annotation, not just a buried log line.
- Retry the agent once when it exits without writing `recap-source.json` (a
  transient miss that previously failed the whole recap with an ENOENT).
- Upload the agent transcript (`claude-result.json`/`codex-events.jsonl` + stderr)
  alongside `recap-source.json` on failure, so a recap that fails because the
  agent produced no/invalid output is debuggable instead of a black box.
