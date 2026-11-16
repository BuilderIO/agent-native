---
"@agent-native/core": patch
---

Organizations: a member can leave the active organization (`POST /_agent-native/org/leave`, `useLeaveOrg`), and removing a member with `deactivate` keeps a Deactivated record that `GET /_agent-native/org/members/deactivated` and `useOrgDeactivatedMembers` list. `sendOrgInvitationEmail` is exported. Apps can veto an event automation per event owner with `setAutomationEventGate`. A sharing `assertSharingChange` hook now receives the grant's `principalType` and `principalId`, and the share controller's `handleAdd` accepts an email to share directly.
