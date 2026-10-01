---
"@agent-native/core": patch
---

Persist first-touch utm_source, utm_medium, utm_campaign, utm_term, gclid, msclkid, vector_source, and referring host on the Better Auth user row at signup (additive nullable columns), for every signup path that carries browser attribution.
