---
"@agent-native/core": minor
---

feat(auth): when `COOKIE_DOMAIN` is set (e.g. `.agent-native.com` for first-party deploys where each app is its own subdomain), the framework session cookie is shared across every subdomain. The cookie name becomes the unsuffixed `an_session` and a `Domain=<COOKIE_DOMAIN>` attribute is added on every set/clear, so signing into one app signs the user into every sibling app under the same parent domain.

Falls back to the existing per-app and workspace-mode cookie naming when `COOKIE_DOMAIN` is unset, so non-first-party deploys keep their origin-scoped cookies.
