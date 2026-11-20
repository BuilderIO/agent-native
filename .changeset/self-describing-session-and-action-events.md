---
"@agent-native/core": patch
---

The `session status` event now says what made the tab read the session in a new `trigger` property: `load` for the page's first read, `focus` for a return to a tab whose answer was stale, `expired`, `auth_change`, `unauthorized`, or `transport_change`. Actions can declare `automatic` (or a predicate of the input) for writes the app makes with no user gesture, such as on load, on a timer, or for experiment bookkeeping; their `action_started`, `action_completed`, and `action_failed` events then carry `action_kind: "automatic"`, and a call an action's `planMode` declares a read carries `action_kind: "read"`. Other writes keep `"write"`.
