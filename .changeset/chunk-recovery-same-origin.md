---
"@agent-native/core": patch
---

Stale-chunk recovery now reacts only to the app's own module files. A module script or modulepreload that fails on another origin, such as an analytics beacon a CDN injects and a content blocker stops, no longer sends the page through a recovery reload. Inline module scripts and same-origin chunks, including apps under a base path, recover as before. Inside an MCP App embed, the app's files on the app's own origin still report recovery as exhausted, and another site's blocked script no longer does.
