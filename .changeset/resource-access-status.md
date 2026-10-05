---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add `get-resource-access-status`, which tells an app what a link the viewer can't open should say: `denied` (it exists, but not for them), `missing`, `trashed` (only to people who could open it), `signed-out`, or `allowed`. It never returns the resource's title, owner, visibility, or workspace, and signed-out callers learn nothing about existence. Shareable resources can declare an `availability` rule, such as not being in the trash, which joins the lightweight access projection. Apps read the status with `useResourceAccessGate` from `@agent-native/core/client/sharing` and render Toolkit's `ResourceAccessScreen`. A registration's `canManageAccess` hook now always receives the whole row, including during lightweight access checks. A registration can also declare a `fallbackAccessContext: { columns, resolve }`, such as the authority a space lends its members, which the status uses when the viewer's own context can't open the resource. Its columns join the lightweight projection, so `resolve` gets the row already loaded; `resolveAccess` and the share actions don't read it.
