---
"@agent-native/recap-cli": minor
"@agent-native/core": patch
---

Accept `CLAUDE_CODE_OAUTH_TOKEN` as an alternative to `ANTHROPIC_API_KEY` for the PR visual recap claude backend, so recaps can bill a Claude subscription instead of API credits. `recapRequiredSecrets` now returns interchangeable secret names, and `recap setup` / `recap doctor` accept either credential.
