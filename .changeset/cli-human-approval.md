---
"@agent-native/core": patch
---

Enforce `needsApproval` for local CLI action calls using parsed arguments and schema defaults. Require interactive confirmation or a person-approved rerun with `--approved`, carry approval metadata through the local dev bridge, which runs the call the person reviewed, and record how each gated CLI call was approved (`cli-prompt` or `cli-flag`) on the action's own audit row.
