---
"@agent-native/dispatch": patch
---

Sign Dispatch's own workspace apps gateway read as the signed-in member with the deployment secret, so the receiver keeps the member's identity. Signing it with the organization secret made the registry refuse it, and a Dispatch with no deployment manifest to fall back on showed "Couldn't load data" (`workspace_gateway_rejected`).
