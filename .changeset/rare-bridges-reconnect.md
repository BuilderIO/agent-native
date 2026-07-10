---
"@agent-native/core": patch
---

Give the Design localhost bridge a per-boot `bridgeInstanceId`, exposed on `/health`, the `/live-edit-bridge` registration response, and the `/live-edit` "unknown bridge key" 409 (now carrying a machine-readable `code: "unknown-bridge-key"` and the echoed `bridgeKey`). This lets a client distinguish a bridge process restart — which silently empties the in-memory live-edit bridge script registry — from a genuine registration bug, instead of guessing from free-text error strings.
