---
"@agent-native/toolkit": minor
"@agent-native/core": minor
---

Add opt-in sharing, members and credential options: `ShareButton` takes `autoFocusInvite` (focus the add-people field on open and return focus to the opener on close), `confirmOrganization` (skips only the organization prompt; `confirmVisibility` still asks, and `useShareButtonController` takes the same opt-out as `confirmOrgVisibility: false`) and `onLinkCopied`; `MembersSection` takes `showDisabledInviteForMembers` and `onInvite`; workspace credential services take `allowDraftEdits` so an app can save a disabled, unvalidated draft and activate it after validation; an update that omits `draft` keeps a draft a draft. Defaults are unchanged.
