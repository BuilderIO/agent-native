# Mail navigation, tabs, and notifications

The Mail header carries inbox tabs, a `Toggle menu` drawer that links to every
mailbox view, a `Configure tabs` popover, and a `Notifications` bell.

## Sub-features

- `inbox-tabs` shows `All`, `Important`, and `Other` links in the header.
- `drawer` lists `Inbox`, `Unread`, `Starred`, `Snoozed`, `Sent`, `Draft
  queue`, `Scheduled`, `Drafts`, `Archive`, and `Trash`, plus `Labels`.
- `drawer-nav` navigates to the chosen view (for example `Sent` → `/sent`).
- `configure-tabs` opens a dialog of tab switches. Without an account, only
  `All tab` is listed.
- `notifications` opens a panel. When empty it shows `No app notifications
  yet.`

## How to get to it (user POV)

- The header `Toggle menu`, `Configure tabs`, and `Notifications` buttons.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance with local mail, so views render past the Connect
  gate. Run [Compose and reopen a draft](./mail-compose-draft.md) first.

- **Read-only tour.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-navigation.ts`.
  The recipe checks the three header tabs and every drawer link, then follows
  `Sent` to `/sent`. It opens `Configure tabs` and expects the `All tab`
  switch, then opens `Notifications` and expects the empty text.
- **Proof.** `evidence/mail-navigation/01-nav-drawer.png`,
  `02-configure-tabs.png`, and `03-notifications-empty.png`.

## Gotchas

- Close the drawer before using header buttons. While it's open it covers
  them; the recipe re-opens `/inbox` instead.
- The draft queue link's name includes its count. Match it with
  `/^Draft queue/`.
- Changing which tabs show isn't covered. With no account there is only one
  tab to toggle.
