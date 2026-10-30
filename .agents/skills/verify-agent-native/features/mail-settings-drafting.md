# Drafting settings

On Settings → Drafting, the user sets a signature and writing style and turns
`Autocomplete` and `Send + Mark Done` on or off. Changes persist across reloads.

## Sub-features

- `signature-save` saves the `Signature` textbox with `Save drafting
  settings`. The button is disabled until something changes.
- `autocomplete-toggle` saves the `Autocomplete` switch immediately.
- `send-and-done-toggle` does the same for the `Send + Mark Done` switch.
- `writing-style` is the `Writing style` textbox, saved with the same button.

## How to get to it (user POV)

- Settings → the Mail `Drafting` section, at `/settings/app/drafting`.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance. Settings is exempt from the Connect gate.

- **Save and reload.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-settings-drafting.ts [--param "signature=…"]`.
  The recipe:
  - checks that Save starts disabled
  - fills `Signature`, saves, and waits for Save to disable again
  - flips `Autocomplete`
  - reads back `get-mail-preferences` (`signature`, `autocompleteEnabled`)
  - reloads and checks both values are still shown
  - flips `Autocomplete` back.
- **Proof.** `evidence/mail-settings-drafting/01-drafting-changed.png`,
  `02-drafting-after-reload.png`, and `action-get-mail-preferences.json`.

## Gotchas

- `Import from Gmail` needs a connected account. Don't click it.
- `Send + Mark Done` and `Writing style` aren't covered by the recipe. They use
  the same switch and save patterns.
