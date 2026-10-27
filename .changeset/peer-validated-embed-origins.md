---
"@agent-native/core": patch
---

Bind embed origins to the peer-validated request URL. Forwarded host and protocol are honored only through the shared loopback proxy check; an origin allowlist alone no longer makes forwarded headers authoritative. Hosted proxies must preserve the public request URL.
