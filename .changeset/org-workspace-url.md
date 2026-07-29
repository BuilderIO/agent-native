---
"@agent-native/core": minor
---

Point org members at their own workspace when they land on a different deployment.

Orgs can now record a `workspaceUrl` (Settings → Team, owner/admin). Members who
open a shared hosted app from the template catalog see a notice offering to take
them to their team's workspace instead of an app that looks empty, and the org
switcher shows which host they are currently on. Opt-in per org — nothing
changes for orgs that don't set it, and it offers a choice rather than
redirecting.
