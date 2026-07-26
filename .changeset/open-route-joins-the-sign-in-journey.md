---
"@agent-native/core": patch
---

`/_agent-native/open` validates its redirect target with the shared sign-in
primitive

`safeRelativePath` in the deep-link route was the last surviving return-path
validator outside `normalizeAppPath`, and the weakest: prefix checks only, with
no WHATWG reparse and no auth-entry rejection. It now delegates, so
`?to=/_agent-native/sign-in` falls back to the app home instead of deep-linking
a visitor at a login form, and anything the URL parser normalises past `//` is
rejected rather than passed through. No base-path containment is applied here —
the base is added afterwards by `withConfiguredRedirectBasePath`, so the value
is still base-relative at validation time.

Deprecation shims left in place by the sign-in unification, for the record:

- `safeReturnPath()` (`@agent-native/core/server`) — `@deprecated`, a one-line
  delegate to `normalizeAppPath`, kept for eight provider-OAuth call sites.
- `/_agent-native/sign-in?return=<path>` — not deprecated and never removable.
  Generated apps in the wild hand-write it. Only new producers are forbidden
  (`guard:one-sign-in`); the consumer is permanent API surface.
