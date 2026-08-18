---
"@agent-native/core": patch
---

`useSemanticNavigationState` no longer reports an unserializable navigation state
once per render. The write-dedup token fell back to a fresh symbol, and
`navigationKeys` is typically a new array each render, so every re-render issued
another failing write and another `onError`. It now falls back to the state's own
identity, which still lets a genuinely different unserializable state reach the
write path and surface its real error.
