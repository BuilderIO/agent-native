# Draft queue

Teammates (or the user) queue a draft for a named reviewer, who sees it under
`Awaiting approval`, opens it with its context, and edits, discards, or sends
it.

## Sub-features

- `queue-empty` shows `No queued drafts` and `New requests from teammates
  appear here.`
- `queue-request` uses `New draft request` to open the `Queue a draft` dialog.
  The fields are Reviewer, To, Cc, Bcc, Subject, Draft, and Context. To and
  Draft are required.
- `queue-review` lists the draft, opens it, and shows its context.
- `queue-count` adds the pending count to the drawer link (`Draft queue 1`).

## How to get to it (user POV)

- The `Draft queue` link in the `Toggle menu` drawer, or `/draft-queue`.
- The `Awaiting approval` and `Requested by me` filters.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance. The dev user already has a workspace, which the
  queue needs. The draft queue is exempt from the Connect gate.

- **Request, list, open.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-draft-queue.ts [--param "subject=…"]`.
  The recipe:
  - fills To, Subject, Draft, and Context in the dialog, and checks submit is
    disabled until Draft is filled
  - submits and sees the subject listed
  - reads back `list-queued-drafts?scope=review&status=active`
  - opens the draft and sees its context.
- **Proof.** `evidence/mail-draft-queue/01-queue-form-filled.png`,
  `02-queue-listed.png`, `03-queue-detail.png`, and
  `action-list-queued-drafts.json`.

## Gotchas

- Only To has a placeholder. The other fields are unlabeled textboxes, in
  order: To, Cc, Bcc, Subject, Draft, Context. Address them with
  `dialog.getByRole("textbox").nth(i)`.
- The discard (trash) button has no accessible name. Approving means `Send`,
  which needs Gmail.
- Without a workspace, the page shows `Draft queue needs an active
  organization.` instead.
