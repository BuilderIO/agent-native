---
"@agent-native/core": patch
---

Fix authenticated dynamic imports with comments before literal paths, preserve local resource URLs with spaces, and avoid adding preview tokens to escaped, control-bearing, or entity-encoded external URLs. Anchor runtime preview authentication to the bridge origin when the document base changes, and avoid credentialing ambiguous resource URLs.
