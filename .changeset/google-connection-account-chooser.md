---
"@agent-native/core": patch
---

Keep the Google account chooser when connecting a managed workspace connection, and pre-select the signed-in identity. Previously the flow sent `prompt=consent` alone, so Google silently reused whichever Google session the browser already had — a user signed in as their work account could grant a Calendar or Gmail connection from a personal account with no picker and no way to switch.
