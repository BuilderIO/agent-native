---
"@agent-native/core": patch
---

Design exploration now works cleanly from link-only coding agents (Codex, Claude Code CLI, Claude Desktop Code tab): after the user picks a direction in the browser, the editor shows a copyable summary to paste back into chat — matching the Assets picker's standalone handoff. `present-design-variants` now accepts 2–5 directions (3 is the sweet spot) instead of erroring on anything but exactly 3, and its result includes `fallbackInstructions` for the browser path. Docs walk the full install → generate → pick (inline vs link) → apply-to-code flow for both Assets and Design, with the exact paste-back summaries and an install-alias matrix.
