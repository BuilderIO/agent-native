---
"@agent-native/core": patch
---

Preserve prior continuation tool results when final-response guards validate a multi-chunk agent turn, recover failed durable handoffs through the client continuation path, and retain completed-side-effect metadata for journal-recovered writes. Successful data queries and dashboard mutations are no longer reported as missing after a background boundary.
