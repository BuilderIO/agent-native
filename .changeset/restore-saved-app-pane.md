---
"@agent-native/dispatch": patch
---

Restore the last app pane after a reload when its saved state is valid. The pane read no longer gets dropped when the first mount is discarded, and a saved pane that is malformed is reported as unreadable instead of being treated as never saved.
