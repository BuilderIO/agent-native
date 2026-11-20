---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add the Design screen capture contract and link parser, for keeping a picture of a Design screen in another app's page: the request and the capture Design answers with (the screen's picture as a PNG at one width, its fingerprint and its design's sharing), the status read that reports each screen's fingerprint and open comments, and `parseDesignScreenLink`, which reads a screen's copied link (`/design/<designId>?screen=<fileId>`) and tells a whole board's link apart.

`SourceEmbedFrame`'s header now wraps on a narrow page: its actions move under the title instead of squeezing it, and the source line wraps instead of being cut off.
