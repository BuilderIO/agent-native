---
"@agent-native/core": minor
---

Builder.io connections are now explicit: the organization's and a member's personal connection. Builder status reports `grants` (OAuth grants and stored key pairs, told apart by `kind`), `effective`, and `canConnect`; `/builder/connect?scope=org|personal` and `/builder/disconnect` with `{ scope }` act on one connection, with owner/admin enforced for the organization's. `useBuilderConnectFlow` exposes the new fields and `start({ scope })`, and `BuilderConnectionMenu` and `BuilderConnectCard` take a `scope`, so a member riding the organization's connection no longer sees a Reconnect that would shadow it.
