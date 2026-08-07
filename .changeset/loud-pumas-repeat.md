---
"@agent-native/core": patch
---

Accept Client ID Metadata documents that advertise grant types beyond `authorization_code`/`refresh_token`. The MCP OAuth client-metadata validator rejected the whole document when it listed any other grant — so Claude.ai, whose CIMD document also lists `urn:ietf:params:oauth:grant-type:jwt-bearer`, could not connect at all. Only the length/shape of `grant_types` is validated now; the token endpoint already honors just `authorization_code` and `refresh_token` regardless of what the document declares.
