---
"@agent-native/core": patch
---

Expose `@agent-native/core/client/clipboard` as a public subpath so apps can use
`writeClipboardText` (desktop bridge + `execCommand` fallback, returns whether
the write landed) instead of hand-rolling `navigator.clipboard` calls that fail
silently on insecure origins or an unfocused document.
