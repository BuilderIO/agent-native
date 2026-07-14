---
"@agent-native/core": patch
---

Derive workspace-shared secret encryption material from A2A_SECRET on hosted workspace deploys so vault keys decrypt across sibling apps, and stop serving stale shared ciphertext after a value is updated without shared key material.
