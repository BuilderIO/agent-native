---
"@agent-native/core": patch
---

Stop telling sibling agents that an app has no callable actions when it does.
The public agent card could only advertise actions with `requiresAuth !== true`,
while `actions/invoke` only ever executes actions with `requiresAuth === true` —
two disjoint sets. Every app whose A2A actions were authenticated therefore
published an empty skills list, and `describe-workspace-apps` reported
"exposes no directly callable actions" about an app the caller could in fact
call directly. Callers took that at face value and fell back to open-ended
`call-agent` delegation, which hands schema discovery to a second model; in
practice that model shelled out through `bash`, failed to find the data, and
looped until the repetition guard stopped the run.

The card now serves the invocable set to a caller with a verified A2A identity,
and sibling capability discovery signs its probe so it sees that set. Anonymous
card fetches are unchanged and still expose only the publicly-safe list, so no
capability is disclosed to an unauthenticated reader that was not disclosed
before.
