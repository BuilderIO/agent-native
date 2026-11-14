---
"@agent-native/core": patch
---

Let an open tab's change feed catch up when the change log is busy with other people's resources. A poll checked access to them one at a time and stopped at the first unchecked one, so on a busy deployment a tab fell minutes behind and missed new changes, such as an agent's suggested edit, until a reload. A poll now starts the checks its changes need together, as one batch per resource type.
