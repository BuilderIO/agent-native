---
"@agent-native/core": patch
---

Answer a request for a missing file with `Cache-Control: no-store`, so a browser behind Cloudflare no longer keeps the 404 for four hours and asks for the file again on the next load.
