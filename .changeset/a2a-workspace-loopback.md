---
"@agent-native/core": patch
---

Allow agent-to-agent calls between apps in a locally running workspace. The gateway serves every app on loopback, so sibling A2A targets are private addresses by construction and `ssrfSafeFetch` rejected them as SSRF — making cross-app delegation fail locally with "refusing to fetch private/internal address". `ssrfSafeFetch` now accepts an `allowedPrivateOrigins` list and the A2A client passes the deployment's own gateway origin (never a request-supplied value).
