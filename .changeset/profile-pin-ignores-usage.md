---
"@agent-native/core": patch
---

Reading a workspace credential profile no longer refuses with `forbidden` when a concurrent successful use only updated the connection's or grant's last-used time. Label, config, grant, credential-reference and updated-at changes still refuse.
