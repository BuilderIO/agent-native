---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Start a hinted visitor's action reads while the session still resolves, and refresh only the action queries a write or sync event can affect. `useActionQuery` takes `resources` and `useActionMutation` takes `resources`, so a query tagged for a resource refetches only when a change to that resource lands, and a sync event naming its `resourceType` narrows the same way. Queries and writes without resources keep the broad refresh.
