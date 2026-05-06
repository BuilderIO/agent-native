---
"@agent-native/core": minor
---

Workspace settings reachable from the org switcher in every template, plus admin-vs-member roles, bulk invite (typed list, paste-many, CSV upload) with per-row role selection, and stricter auto-join domain validation (must match the admin's own email domain; free email providers like gmail.com are blocked).

- `OrgSwitcher` exposes a "Workspace settings" link (configurable via `settingsPath`, default `/team`).
- `useInviteMember` accepts `{ email, role }`; new `useBulkInviteMembers` and `useChangeMemberRole` hooks.
- New `PUT /_agent-native/org/members/:email/role` endpoint; only owners can promote/demote admins.
- `org_invitations` gains a `role` column so invites land at the assigned role on accept.
- `OrgPendingInvitation` type now includes `role`.
- New `isFreeEmailProvider` export with a curated blocklist used by `setDomainHandler`.
