---
"@agent-native/core": patch
---

Stop rejecting saved public custom provider endpoints whose DNS answer lands in the 198.18.0.0/15 benchmark range (Clash/mihomo `fake-ip`'s default pool). Fetch and connect-time SSRF checks still block that range, including when a URL names it literally.
