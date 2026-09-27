---
"@agent-native/core": minor
---

Add the Organization General, Members, Authentication, and Apps pages to the redesigned Settings (behind the `settings-redesign` flag), exported as `OrgGeneralPage`, `OrgMembersPage` (takes `appRoles`), `OrgAuthenticationPage`, and `OrgAppsPage` from `@agent-native/core/client/org`. `GET /_agent-native/org/me` now returns `signInMethods` (email and password, Google, GitHub) to owners and admins, and the new `list-sign-in-methods` action gives the agent the same view.

Permission change: the cross-app (A2A) secret is now owner-only on the server. Admins get a 403 from reveal, set, and sync, and `org/me` omits `a2aSecretSet` for them, matching the UI. `canManageOrgDomain` now allows admins, matching the server, which already let admins set email domain auto-join. New `canManageOrgA2ASecret` helper. The legacy `auth` settings section now opens Organization › Authentication.
