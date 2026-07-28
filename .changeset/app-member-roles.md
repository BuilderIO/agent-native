---
"@agent-native/core": minor
---

Add per-app member roles: `defineAppRoles`, an `authorize` gate on `defineAction`, and an `appRoles` column on `TeamPage`.

Apps that need permissions of their own no longer have to hand-roll a members table or collapse a rich vocabulary into the org's three roles. `defineAppRoles({ appId, roles })` declares an app's role set; `authorize: myApp.requireAny("admin")` gates an action for every caller (agent tool, HTTP, frontend, MCP, A2A, CLI) because it wraps `run` rather than hanging off a flag the dispatchers each have to remember; `<TeamPage appRoles={descriptor} />` adds the assignment column to the existing roster instead of forcing a second members view.

Org membership stays canonical — an app role only narrows what an existing member may do inside one app. Roles are an unordered set, not a ladder: authorization always names the accepted roles explicitly. `defaultRole` is a display value and never satisfies a guard, membership and assignment resolve in one statement so a stale row cannot authorize, and a failed lookup throws rather than resolving to a deny-shaped status.
