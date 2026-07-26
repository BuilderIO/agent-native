---
"@agent-native/core": patch
---

Warn before accepting an org invitation silently repoints your credentials.
Accepting force-sets the active org, and because vault keys are per-org, a user
who joins a second org can find apps that worked yesterday reporting a saved key
as missing — with nothing in the flow having said an org boundary existed. The
org switcher's invitation rows now carry one inline line naming the consequence:
connected apps will switch to the new organization's vault keys.

Shown only when the user already has an active org. The no-active-org gate
(`RequireActiveOrg`) reaches the same accept action, but a user with no current
org has no credentials to be moved away from, so the line would be noise there.
