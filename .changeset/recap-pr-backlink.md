---
"@agent-native/core": patch
---

Add PR back-link to visual recap: `buildRecapPrompt` now deterministically threads `sourceUrl` (derived from repo + PR number) into the `create-visual-recap` tool call so the hosted recap page can link back to its source PR.
