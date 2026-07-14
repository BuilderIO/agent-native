---
name: draft-queue
description: Use when queuing, reviewing, editing, opening, or sending email drafts requested by organization teammates, including Slack @agent-native intake.
---

# Draft Queue

The draft queue is for teammate-requested emails that need the owner to review before sending. It is durable SQL data in `queued_email_drafts`, not compose application state.

## Rules

- Use `queue-email-draft` when a teammate asks the agent to prepare an email for an organization member.
- The requester and reviewer must both be members of the active organization.
  `requireQueueContext` throws if there's no active org, or if the caller isn't
  a member — both surface as plain errors, not empty results.
- Slack requests should queue drafts, not send raw emails.
- `queue-email-draft` returns `reviewUrl`; include that URL when replying to Slack so the owner can open the exact draft.
- Slack intake verifies the sender email via Slack `users.info` when the app has `users:read.email`, and passes verified sender name/email into the agent context. If that scope is missing, Slack intake cannot resolve a real email and will not queue anything — tell the requester to ask an admin to grant `users:read.email` rather than guessing their address from their Slack display name.
- `ownerEmail` accepts more than an exact email: `resolveOrgMemberEmail` also
  matches an unambiguous local-part prefix (e.g. `"jane"` matches
  `jane@co.com` if she's the only `jane*` member). If more than one member
  matches the prefix, the action throws listing all org member emails instead
  of guessing — pass the full email in that case.
- Use `send-queued-drafts` only when the queued draft owner explicitly asks to send.
- Use `open-queued-draft` when the user wants to manually tweak a queued draft in the compose panel.

## Status Lifecycle And Access

A queued draft moves through `queued -> in_review -> sent`, or `-> dismissed`
at any point before `sent`. Rules enforced in `server/lib/queued-drafts.ts`:

- **Ownership is strict.** Only the `ownerEmail` (or an org `owner`/`admin`
  role) can call `update-queued-draft`, `open-queued-draft`, or
  `send-queued-drafts` for a given draft — `requireQueuedDraft(id, {ownerOnly:
  true})` rejects the original requester from editing or sending it, even
  though they created it.
- **Sent drafts are frozen.** `updateQueuedDraft` throws
  `"Sent queued drafts cannot be edited."` if `status` is already `sent` and
  the caller isn't also setting it to `sent` again. Don't retry an edit on a
  sent draft — create a new `queue-email-draft` instead.
- **`open-queued-draft` transitions status to `in_review`** and copies the
  draft into a real `compose-{id}` application-state entry (auto-appending the
  *owner's* configured signature, not the requester's). It also blocks
  opening a draft that is already `sent` or `dismissed`.
- **`send-queued-drafts --all=true`** sends every `queued` or `in_review` draft
  assigned to the caller (default limit 50, capped 50) by delegating to the
  real `send-email` action per draft — each send still requires the standard
  approval gate. Partial failures are reported per-draft in `{ sent, failed }`
  rather than aborting the whole batch; report both lists back to the user.
- Queueing a draft for someone else fires a best-effort in-app notification to
  the owner (skipped when self-queuing); a failed notify does not fail the
  queue action itself.

## Actions

| Action                        | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `list-org-members`            | Resolve valid organization members for `ownerEmail`                     |
| `queue-email-draft`           | Create a queued draft for a member to review                            |
| `list-queued-drafts`          | List active, sent, dismissed, review, or requested drafts               |
| `update-queued-draft`         | Edit queued draft fields or set status                                  |
| `open-queued-draft`           | Open a queued draft as `compose-{id}`                                   |
| `send-queued-drafts`          | Send one queued draft or all active drafts assigned to the current user |
| `navigate --view=draft-queue` | Open the queue UI                                                       |

## Typical Flow

1. Resolve the target reviewer with `list-org-members` if the user gave a name.
2. Call `queue-email-draft` with `ownerEmail`, recipients, subject, body, and context.
3. Tell the requester it was queued and include the returned `reviewUrl`.

For review:

1. Call `list-queued-drafts --scope=review --status=active`.
2. Use `update-queued-draft` for tone/content changes.
3. Use `open-queued-draft` for manual compose edits, or `send-queued-drafts` when the owner asks to send.
