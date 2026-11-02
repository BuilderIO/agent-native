---
"@agent-native/core": patch
---

A file path that isn't an upload reference, or no path at all, is now a normal tool error the agent corrects instead of a stop that ends the run. Stops for a missing, expired or inaccessible upload now say to attach the file again instead of listing credentials, roles, connected accounts or approvals.
