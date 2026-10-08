---
"@agent-native/core": patch
---

A collaborator's resource event that names its sending tab (for example Slides deck saves and deletions) now wakes the shared polling transport when no event stream is connected, so an open deck learns it was deleted within seconds instead of at the 1-5 minute idle cadence. A tab's own saves and unnamed server events still do not boost polling.
