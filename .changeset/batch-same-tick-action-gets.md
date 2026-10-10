---
"@agent-native/core": patch
---

Coalesce action GET calls made in the same tick into one `get-actions-batch` request, so a page's queries share a round trip. Each item still runs through its own route, auth, and access checks, and one failing item does not fail the others.
