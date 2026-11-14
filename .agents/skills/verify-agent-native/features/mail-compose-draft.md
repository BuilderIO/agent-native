# Compose and reopen a draft

A Mail user opens compose, fills in recipient, subject, and body, and closes
the window. The draft is saved and can be reopened from Drafts with its
content intact. With no Gmail account, drafts are stored locally.

## Sub-features

- `compose-open` opens the compose window from the header.
- `compose-fields` takes a committed recipient chip, a subject, and a body.
- `draft-save` autosaves the draft about 3 s after the last edit, and again
  on close.
- `draft-reopen` reopens the draft from `/drafts` with the same subject.

## How to get to it (user POV)

- The header `Compose email` button (text "Compose").
- Pressing `c` with focus outside any text field.
- Clicking a draft row in `/drafts`.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance. No Gmail account is needed.

- **Compose, close, reopen.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-compose-draft.ts [--param "subject=…"]`.
  The recipe:
  - fills `To recipients` (Enter commits the chip), the `Subject` textbox, and
    the `.compose-editor` body
  - waits 3.5 s, then clicks `Close all drafts`
  - reads back `list-emails?view=drafts&compact=false`, which must contain the
    subject
  - opens `/drafts`, which must not show the Connect gate, and clicks the row
  - checks that the reopened `Subject` matches.
- **Proof.** `evidence/mail-compose-draft/01-compose-filled.png`,
  `02-draft-reopened.png`, and `action-list-emails.json`.
- **Keyboard entry.** Pressing `c` is not covered by the recipe. To check it,
  press `c` on `/inbox` with nothing focused and expect the `Subject` textbox.

## Gotchas

- Compose is not a `dialog` role. Scope locators to the page.
- The body editor has no accessible name. Use
  `locator('[contenteditable="true"].compose-editor')`.
- Open compose windows persist in application state and come back on the next
  load. Recipes call `resetCompose` first, so a failed run doesn't leave a
  stray window for the next one.
- Typing an address without pressing Enter leaves uncommitted text, and Send
  then refuses with `Finish adding or clear the recipient text before sending.`
