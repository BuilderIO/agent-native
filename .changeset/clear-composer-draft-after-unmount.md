---
"@agent-native/toolkit": patch
---

Clear a submitted prompt composer's persisted localStorage draft even when the host closes or unmounts the composer before the submit promise resolves, so an abandoned draft no longer resurfaces on the next mount. Also guard against a late-resolving submit from an unmounted composer clearing a newer draft that a fresh instance persisted under the same scope in the meantime.
