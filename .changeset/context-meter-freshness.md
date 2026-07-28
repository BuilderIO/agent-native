---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Context meter now reports its own freshness. `context-manifest-get` returns the
thread's newest turn id, `writeContextManifest` returns a typed persist outcome
instead of a swallowed rejection, and the meter dims with an explanation when
the manifest trails the running turn or shows an em dash when no usable reading
exists. The meter also refetches while a run is streaming, which is what kept it
frozen on the first turn's percentage.
