---
"@agent-native/core": patch
---

Collaborators editing different docs of one shared resource (two screens of a design, two slides of a deck) now keep each other's changes flowing: a resource-scoped action event from another tab or an agent boosts polling to 2.5 s for a minute when no realtime stream is connected, instead of falling back to the 1-5 minute idle cadence once presence on the same doc lapses. The history replayed by a tab's first poll does not count.
