---
"@agent-native/dispatch": patch
---

Keep the Apps page readable when the hosted workspace registry denies a read. A
gateway authorization denial now falls back to the deployment-owned manifest
without persisting or reconciling unverified access rows.
