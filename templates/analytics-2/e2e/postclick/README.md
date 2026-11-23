# Post-click checks for a dashboard chart cell

One bounded journey, executed against the served app: open a seeded project, reach a cell
whose kind is Chart, open that cell's "More actions" menu, close it with the control that
opened it, re-open it, and record what happened at each step. Read-only: nothing is renamed,
deleted or saved, and no record is created.

```
node e2e/postclick/selftest.mjs                                  # offline controls, no browser
node e2e/postclick/matrix.mjs [--app <name>] [--project <id>] [--cell <label>] \
  [--allow-red <check-id>]... [--json <path>]                    # live run against served
```

`matrix.mjs` prints every check with its status, the overall verdict, and exits non-zero when
a check fails. `--allow-red` names a check that is known to fail today so a fix can flip it
green while the run still gates the rest.

## Files

| file           | what it is                                                               |
| -------------- | ------------------------------------------------------------------------ |
| `checks.mjs`   | the assertions: a pure `evaluate(observation)`, no browser               |
| `matrix.mjs`   | the collector: drives the served app and feeds `checks.mjs`              |
| `selftest.mjs` | offline controls: one clean observation plus five mutants that must fail |
| `heldout.json` | the frozen case, written as behaviour rather than a literal item list    |

## What the statuses mean

- `PASS` / `FAIL` — observed and decided.
- `NOT_ESTABLISHED` — the check needs a _trusted_ input event (a real click or key) and the
  collector had none. A programmatic `.click()` or a synthetic `keydown` is not evidence, so
  these are reported, never counted as a pass. They do not fail the run, and a green run with
  unestablished checks says so in its output.

## Deliberate limits

- No screen is compared against another product's capture here. There is no reference capture
  for this journey, so nothing in this folder is a visual or fidelity claim.
- `heldout.json` freezes stability, not contents: the menu's items must be identical before
  and after a close and re-open, so the check survives the menu being corrected.
- `--project` / `--cell` select a different seeded project or cell. The runner takes its
  settings from arguments only: the app build refuses environment reads outside its allowlist.
