---
"@agent-native/core": patch
---

Fix the chat "Revert to here" action doing nothing when clicked. The menu item
was shown whenever Code mode was on, regardless of whether a checkpoint had
actually been saved for that turn, and every failure path reset the button to
idle without any feedback. The action now only appears for turns that have a
real checkpoint, restores by run id in a single request, and surfaces the
server's error instead of failing silently.
