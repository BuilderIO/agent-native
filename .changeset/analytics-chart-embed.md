---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add the shared pieces for keeping a copy of another app's resource in a page: the Analytics panel capture contract and link parser, the embed audience check, the `SourceEmbedFrame` that frames such a copy, and the report chart renderer in `@agent-native/toolkit/dashboard`. Share controls take a `confirmVisibility` check so a resource can ask before going public, with detail for the visibility it would save.
