---
name: plan-hosted-writes
description: >-
  Preconditions and protocol for writing hosted plans: real user session,
  `expectedUpdatedAt` revision guard on destructive writes, post-write
  verification, and when feedback may be resolved or consumed. Use when
  performing any hosted plan write.
---

# Hosted Plan Writes

## Session Requirement

Current app actions require a real user session so plans stay scoped and
shareable. Local development can use the framework's auto-created dev account;
hosted persistence, private sharing, reviewer links, and cross-device/team
workflows use account login, with Google sign-in shown when the standard
Google OAuth env vars are configured.

## Revision Guard Before Destructive Writes

Before any destructive hosted-plan write (`replace-blocks`, a top-level
`content` replacement, or a source `replace-file`), call `get-visual-plan`
immediately before the write and pass its `plan.updatedAt` as
`expectedUpdatedAt`. Never reuse a revision from an earlier read. Prefer
targeted content or source patches whenever they can express the edit.

## Verify After Every Write

After every hosted-plan write, call `get-visual-plan` again and verify the
persisted text, blocks, canvas, and prototype before claiming success. If the
write addressed agent-targeted feedback, call `resolve-plan-comment` and
`consume-plan-feedback` only after this verification; addressed feedback must
be both resolved and consumed so it neither remains visibly open nor returns
as pending work.

## Related Skills

- **plan-comments-and-feedback** — what `get-plan-feedback` returns and how to
  interpret anchors before and after a write.
- **plan-source-sync** — `replace-file` and other source-level writes.
- **plan-version-history** — snapshots taken before meaningful writes.
