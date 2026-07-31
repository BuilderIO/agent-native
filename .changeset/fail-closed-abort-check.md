---
"@agent-native/core": patch
---

Fail closed instead of silently ignoring a broken cross-isolate Stop check: a rejected abort-state read in the agent run manager no longer gets coerced into "not aborted" forever — sustained read failures now self-abort the run with a distinct, typed error. Also add the same fail-closed handling to two `isTurnAborted` call sites in the background-dispatch path that were missing it, matching the existing sibling call sites.
