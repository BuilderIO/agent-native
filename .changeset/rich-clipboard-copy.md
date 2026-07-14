---
"@agent-native/core": patch
---

Copying an assistant message now preserves formatting when pasting into apps
that read rich clipboard content (e.g. Slack), while still pasting as markdown
in editors like Notion. Falls back to plain-text copy where the browser does
not support rich clipboard writes.
