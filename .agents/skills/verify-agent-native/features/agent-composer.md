# Agent composer

Every template has an agent sidebar with a `Message agent...` composer. With
no model connected, the sidebar shows a **Connect AI** card and the composer
is disabled. With a model connected, the composer accepts input.

## Sub-features

- `toggle` opens the sidebar with the `Toggle agent` button.
- `connect-gate` shows the Connect AI card (`Use Builder.io`, `Custom keys`)
  and disables the composer when no model is connected.
- `ready` enables the composer when a model is connected.

## How to get to it (user POV)

- The `Toggle agent` button in an app header.
- The app's `Ask <App>` page (for example `/ask` in Forms), which embeds the
  composer full-page.

## Driving it with drive.ts

Preconditions:

- Any running instance. An isolated one is preferred:
  `launch.ts --app forms --run <run-id>`.

- **Open and classify.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/agent-composer.ts [--param path=/ask]`.
  The recipe toggles the sidebar if needed and waits for either `Use
  Builder.io` or an enabled composer. It fails if the card and the composer
  state disagree.
- **Proof.** `evidence/agent-composer/01-agent-composer.png`. The `drive.log`
  note states which state was observed.

## Gotchas

- For about a second the composer is disabled under a placeholder model name
  (for example `Model: GPT-6 Luna`) before engine status loads. Do not classify
  from the model button.
- In the sidebar, `Connect AI` is plain text. It is a heading only on the
  `Ask` page. Key off the `Use Builder.io` button.
- Sending a message is out of scope without a connected model. Never connect
  keys just to make a proof pass.
