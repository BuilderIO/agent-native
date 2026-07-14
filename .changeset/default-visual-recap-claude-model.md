---
"@agent-native/recap-cli": patch
---

Default the Claude backend of the PR Visual Recap workflow to `claude-sonnet-5` when `VISUAL_RECAP_MODEL` is unset, instead of falling through to the Claude Code CLI's own (expensive Opus-tier) default — keeping automated recaps on a cost-efficient model by default. The Codex and openai-compatible backends are unaffected.
