# Send an email

The user sends from compose. After a 10 s undo window, a `Message sent.` toast
appears and the message is listed in Sent. With no Gmail account, the send is
synthetic: it is stored locally and never delivered.

## Sub-features

- `send-no-recipient` refuses with `Please add at least one recipient`.
- `send-undo-window` holds the send for 10 s before committing.
- `send-commit` shows `Message sent.` and stores the message in Sent.
- `sent-view` lists the message on `/sent`.

## How to get to it (user POV)

- The `Send` button in compose.
- The `Sent` link in the `Toggle menu` drawer.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance with no Gmail account, so nothing is delivered.

- **Reject, send, read back.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-send-local.ts [--param "subject=…"]`.
  The recipe:
  - clicks `Send` on an empty compose and expects the `Please add at least one
    recipient` toast
  - fills a new compose and sends it
  - waits up to 30 s for `Message sent.`
  - reads back `list-emails?view=sent&compact=false`
  - finds the subject on `/sent`.
- **Proof.** `evidence/mail-send-local/01-message-sent-toast.png`,
  `02-sent-view.png`, and `action-list-emails.json`.

## Gotchas

- Use `{ name: "Send", exact: true }`. Without `exact`, the locator also
  matches `Schedule send`.
- The toast text has no trailing period (`Please add at least one recipient`),
  while the success toast does (`Message sent.`).
- Real delivery, replies, and forwards need a connected Gmail account and an
  existing thread, so they can't be verified here.
