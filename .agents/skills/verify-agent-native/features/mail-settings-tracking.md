# Tracking settings

On Settings → Tracking, the user turns open tracking and click tracking for
outgoing mail on or off. Each switch saves immediately.

## Sub-features

- `track-opens` controls the `Track email opens` switch.
- `track-clicks` controls the `Track link clicks` switch.

## How to get to it (user POV)

- Settings → the Mail `Tracking` section, at `/settings/app/tracking`.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance.

- **Toggle, read back, reload.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-settings-tracking.ts`.
  The recipe flips `Track email opens`, then checks `get-mail-preferences`
  (`tracking.opens`). It reloads, checks the switch kept its state, and flips
  it back.
- **Proof.** `evidence/mail-settings-tracking/01-tracking-after-reload.png`
  and `action-get-mail-preferences.json`.

## Gotchas

- Whether tracking actually changes outgoing mail can only be seen with real
  delivery, which needs Gmail. Only the stored preference is verified here.
- `Track link clicks` isn't covered by the recipe. It's the same switch
  pattern under `tracking.clicks`.
