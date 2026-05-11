---
"@agent-native/core": patch
---

Restrict extensions to private/org sharing only — extensions execute code in
the viewer's authentication context, so they must never be `visibility: "public"`
and user shares must target someone already in (or invited to) the org.

- Added `allowPublic` and `requireOrgMemberForUserShares` flags to
  `registerShareableResource()`. Defaults match prior behavior; extensions
  opt into both.
- `set-resource-visibility` rejects `"public"` for any resource registered
  with `allowPublic: false`. `accessFilter` and `resolveAccess` treat any
  stored `'public'` row as private for those resources (defense in depth).
- `share-resource` verifies the principal email against `org_members` and
  pending `org_invitations` when `requireOrgMemberForUserShares: true`. The
  same flag also pins `principalType: "org"` shares to the resource's own
  org — cross-org org-principal shares would otherwise let an outside org's
  members run extension code in the viewer's auth context (same threat
  model as a public extension).
- `updateExtension` and the extension `PUT` route refuse `visibility: "public"`
  directly. `list-resource-shares` returns a `policy` block so the share
  popover hides the "Public" option and shows server errors inline.
- New `scripts/guard-extension-no-public.mjs` (wired into `pnpm guards` /
  `pnpm prep`) statically enforces that the extension registration keeps
  both flags set, and refuses `visibility: "public"` literals inside
  `packages/core/src/extensions/`.
