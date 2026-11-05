---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Let the share panel choose what general access allows. Anyone at the organization gets a role picker for Can view, Can comment, or Can edit, and Anyone with the link gets one for Can view or Can comment. `set-resource-visibility` takes an optional `role` with `visibility: "org"` or `"public"`. The organization's role is stored as the share grant to the resource's own organization, and the link's role as a share row for the new `link` principal, which only signed-in callers receive and which is never listed or shared as a person. Each is removed when the resource leaves that visibility, and raising the link role needs the same approval as making a resource public. `list-resource-shares` returns `linkRole` for a public resource. `useShareButtonController` adds `generalAccessRole`, `canSetGeneralAccessRole` and `handleGeneralAccessRole`, and while visibility is `org` its `shares` no longer lists the organization grant. `ShareGeneralAccessRow` takes `roleCopy` and `allowedRoles`.

Going from private to the organization no longer opens a confirmation for every resource type. A registration opts in with `confirmOrgVisibility: true`, which chat threads set; `useShareVisibilityTransition` takes the matching `confirmOrgVisibility` option.
