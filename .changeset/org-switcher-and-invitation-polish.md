---
"@agent-native/core": patch
---

Org polish:

- `InvitationBanner`: while a join-by-domain or accept-invitation request is in flight, render an in-place "Joining {orgName}…" status so the chat panel doesn't look unchanged until the view abruptly swaps.
- `OrgSwitcher`: `settingsPath` is now optional. When unset, "Workspace settings" only opens the in-sidebar settings panel — suitable for templates without a dedicated team page. Templates that mount one (e.g. Dispatch's `/team`) pass it explicitly.
- `useOrgMembers` / `useOrgInvitations`: scope the React Query cache by active `orgId` so switching/creating an org forces a fresh fetch instead of briefly showing the previous org's members.
- `useCreateOrg`: invalidate all queries on success (creating an org switches into it server-side, so every org-scoped query is stale), matching `useSwitchOrg`.
- Create/invite forms: loader uses flex centering so the spinner stays vertically centred inside the button; close the create-org dialog via the unified `handleOpenChange` so cleanup runs.
