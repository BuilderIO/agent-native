# Mail Connect Google gate

With no Google account connected and no local mail, every mailbox view in Mail
is replaced by a full-page "Connect your Google account" screen. Settings and
the draft queue stay usable, and unknown paths reach a 404 page.

## Sub-features

- `gate-hero` shows `Connect your Google account` with a `Connect Google`
  button on mailbox views (`/inbox`, `/sent`, `/drafts`, …).
- `gate-exempt` renders `/settings/*` and `/draft-queue` normally.
- `gate-lift` removes the hero as soon as any local mail exists (for example,
  a saved draft).
- `not-found` shows `Page not found` and `Go to Inbox` for unknown paths.

## How to get to it (user POV)

- Open Mail at `/` or `/inbox` before connecting Gmail.
- Open any mailbox view from the `Toggle menu` drawer.
- Type an unknown path.

## Driving it with drive.ts

Preconditions:

- A **fresh** isolated Mail instance (`launch.ts --app mail --run <run-id>`)
  with no local mail. Run this before any compose, send, or schedule recipe.

- **Gate, exemptions, 404.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-connect-gate.ts`.
  It sees the hero on `/inbox`, `/sent`, and `/drafts`, the `Autocomplete`
  switch on `/settings/app/drafting`, the `Draft queue` heading on
  `/draft-queue`, and `Page not found` on `/definitely-not-a-view`.
- **Gate lift.** Covered by
  [Compose and reopen a draft](./mail-compose-draft.md), which asserts `/drafts`
  is no longer gated.
- **Proof.** `evidence/mail-connect-gate/01-gate-hero.png` through
  `04-not-found.png`.

## Gotchas

- `failedResponses` always contains `404 GET …/definitely-not-a-view`. That is
  expected.
- The gate never comes back on that instance once local mail exists. Relaunch
  to re-check it.
- `Connect Google` starts a real OAuth flow. Never click it in a proof.
