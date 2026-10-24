---
"@agent-native/core": patch
---

Enforce `needsApproval` for local CLI action calls using parsed arguments and schema defaults. Require interactive confirmation or a person-approved rerun with `--approved`, carry approval metadata through the local dev bridge, and record approved gated CLI calls without full arguments in the approval record.
