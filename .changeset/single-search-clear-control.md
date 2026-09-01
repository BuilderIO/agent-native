---
"@agent-native/toolkit": patch
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Render a single clear control in nav search fields. Settings search, the Agent page search, and Dispatch admin search each paired a custom clear button with the WebKit-native `type="search"` cancel button, so typing showed two stacked "x" icons. They now share a `SearchInput` primitive that suppresses the native affordance.
