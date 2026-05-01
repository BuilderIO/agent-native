---
name: draft-queue
description: Use when queuing, reviewing, editing, opening, or sending email drafts requested by organization teammates, including Slack @agent-native intake.
---

# Draft Queue

The draft queue is for teammate-requested emails that need the owner to review before sending. It is durable SQL data in `queued_email_drafts`, not compose application state.

## Rules

- Use `queue-email-draft` when a teammate asks the agent to prepare an email for an organization member.
- The requester and reviewer must both be members of the active organization.
- Slack requests should queue drafts, not send raw emails.
- Use `send-queued-drafts` only when the queued draft owner explicitly asks to send.
- Use `open-queued-draft` when the user wants to manually tweak a queued draft in the compose panel.

## Actions

| Action | Purpose |
| --- | --- |
| `list-org-members` | Resolve valid organization members for `ownerEmail` |
| `queue-email-draft` | Create a queued draft for a member to review |
| `list-queued-drafts` | List active, sent, dismissed, review, or requested drafts |
| `update-queued-draft` | Edit queued draft fields or set status |
| `open-queued-draft` | Open a queued draft as `compose-{id}` |
| `send-queued-drafts` | Send one queued draft or all active drafts assigned to the current user |
| `navigate --view=draft-queue` | Open the queue UI |

## Typical Flow

1. Resolve the target reviewer with `list-org-members` if the user gave a name.
2. Call `queue-email-draft` with `ownerEmail`, recipients, subject, body, and context.
3. Tell the requester it was queued.

For review:

1. Call `list-queued-drafts --scope=review --status=active`.
2. Use `update-queued-draft` for tone/content changes.
3. Use `open-queued-draft` for manual compose edits, or `send-queued-drafts` when the owner asks to send.
