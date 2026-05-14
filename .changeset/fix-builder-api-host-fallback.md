---
"@agent-native/core": patch
---

Fix: default the Builder API host fallback to `https://api.builder.io` instead of the unreachable `https://ai-services.builder.io`, so calls succeed when `BUILDER_API_HOST` / `BUILDER_PROXY_ORIGIN` / `AIR_HOST` are unset.
