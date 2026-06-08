---
"@agent-native/core": minor
---

PR Visual Recap is now LLM-driven. Instead of a deterministic diff→MDX
generator, the `pr-visual-recap` GitHub Action runs the repo's `visual-recap`
skill via a real coding agent (Claude Code by default, or Codex — selected with
the `VISUAL_RECAP_AGENT` repo variable), which publishes the plan through the
plan MCP tools. The workflow screenshots the published plan in headless Chrome,
uploads it to the new signed `recap-image` route, and posts the screenshot
inline in the sticky PR comment.

New CLI surface backing the action:

- `agent-native recap <scan|build-prompt|shot|comment>` — the helper commands
  the workflow calls (no helper scripts are copied into the consuming repo).
- `agent-native skills add visual-plan --with-github-action` — installs the PR
  Visual Recap workflow into a repo and prints the secrets/variables to set.

The agent-produced plan URL is treated as untrusted throughout: the screenshot
CLI only forwards the publish token to requests whose origin matches the plan
app (so a poisoned `recap-url.txt` can't exfiltrate it to a third party or via
cross-origin subresources), and the workflow passes the URL through the
environment rather than `${{ }}` shell interpolation. The workflow runs on PRs
into any base branch (not just `main`) so the generated workflow works in repos
with a different default branch.
