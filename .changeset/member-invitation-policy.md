---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Add an opt-in policy for who may invite organization members. Apps keep owner/admin-only invitations by default; server code can set `access.memberInvitations` to `members` or `org-setting` (members invite until an admin turns on only-admins-can-invite through `PUT /_agent-native/org/invitation-policy`). The invitation route, batch invites, and the `invite-organization-member` action share one org-scoped authorizer; members can never grant admin or app roles, delegated peer-app identities cannot invite as members, a corrupt stored setting fails closed while `/org/me` still reports it so admins can reset it from the new Members toggle, and `OrgInfo.canInviteMembers` carries the resolved permission to `useOrgRole()` and the Members UI.

Add an optional `onAgentShareHandoff` callback to `ShareButton`, `AgentPanel`, and `AgentSidebar` so an app can receive the Send to menu's agent prompt instead of launching a native app.
