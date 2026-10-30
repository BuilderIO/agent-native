# Schedule send

From compose, the user picks a later time under `Schedule send`. The compose
window closes and the message appears in Scheduled until it is due.

## Sub-features

- `schedule-picker` opens a `Schedule send` dialog with a `Date and time`
  combobox. Presets are `Tomorrow morning`, `Tomorrow afternoon`, and
  `Monday morning`, plus `Pick date & time...`.
- `schedule-commit` stores a scheduled job and closes compose.
- `scheduled-view` lists the message on `/scheduled`.

## How to get to it (user POV)

- The `Schedule send` button next to `Send` in compose.
- The `Scheduled` link in the `Toggle menu` drawer.

## Driving it with drive.ts

Preconditions:

- An isolated Mail instance.

- **Pick a preset and read back.** Run
  `node .agents/skills/verify-agent-native/scripts/drive.ts --run <run-id> --recipe .agents/skills/verify-agent-native/recipes/mail-schedule-send.ts [--param "subject=…"]`.
  The recipe fills compose, chooses the `Tomorrow morning` option, and waits
  for compose to close. It reads back `list-scheduled-jobs`, then finds the
  subject on `/scheduled`.
- **Proof.** `evidence/mail-schedule-send/01-schedule-picker.png` and
  `02-scheduled-view.png`.

## Gotchas

- **Currently fails: product bug.** `create-scheduled-send` returns 500 with
  `value "<ms>" is out of range for type integer`. `scheduled_jobs.run_at` and
  `created_at` are 32-bit `INTEGER`
  (`templates/mail/server/plugins/db.ts:75-77`,
  `templates/mail/server/db/schema.ts:31,47`), but they store millisecond
  timestamps. Snooze writes the same table. The recipe asserts the intended
  behavior, so it passes once the columns are widened to `BIGINT`. Don't
  weaken it.
- The picker options include the date in their names (`Tomorrow morning Wed,
  Oct 21, 8:00 AM`). Match with `/^Tomorrow morning/`.
