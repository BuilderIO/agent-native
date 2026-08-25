# Clips Existing Share Role Design

## Goal

Let a recording owner or share administrator change the permission level of an existing user from the Clips share dialog.

## UI and architecture

Keep the existing Clips share surface and styles. Replace each manageable grant's static role label with the same compact role selector used by the invite row. Keep the owner row read-only, keep the remove button separate, and keep static role text for users without permission to manage shares.

The selector exposes the existing Viewer, Commenter, Editor, and Admin roles with the current localized labels and optional recording-specific descriptions.

## Data flow

Selecting a role calls the existing `share-resource` action with the grant's current `principalType`, `principalId`, and new role. The action already updates matching grants. After success, refetch `list-resource-shares` so the server result is authoritative. Disable role controls while the mutation is pending.

## Failure behavior

Do not change the displayed role before the write succeeds. Route failures through the share dialog's existing error callback with a permission-change action type, leaving the prior role visible.

## Verification

Add focused coverage for the existing-grant selector and mutation path. Run formatting, the targeted Clips share-dialog test, Clips type checking, and i18n guards. Exercise the recording share dialog in the running app for manager and read-only states.
