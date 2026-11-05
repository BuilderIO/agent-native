---
"@agent-native/core": patch
---

The WebMCP manifest now revalidates behind a host that compresses it. A compressed response reaches the browser with `-df` on its tag and the browser sends that tag back, so the server's exact comparison missed and every load downloaded the manifest again. The comparison now ignores that suffix, so a warm load gets the bodyless 304.
