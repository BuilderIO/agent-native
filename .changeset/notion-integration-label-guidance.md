---
"@agent-native/core": patch
---

Teach the provider API substrate that a Notion token's `/users/me` name is a Notion-side integration label, not the caller's workspace, so agents stop reporting an unrelated product name when a page was simply never shared. Provider presets can now declare `accessErrorGuidance`, which is appended to request guidance on 401/403/404 responses.
