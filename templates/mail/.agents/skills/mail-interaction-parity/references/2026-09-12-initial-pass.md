# Mail parity pass — 2026-09-12

Status: initial, partial pass; this is not a claim of 1:1 parity or zero bugs.

## Reference and safety boundary

- Compared against the installed Superhuman desktop app and its in-app keyboard
  reference. The app build/version was not exposed in the UI.
- The Mail working tree was based on `2f1c3f6927519873151c322a352b89cb891bb88e`.
- Did not open or inspect message content, create a live draft, or send/receive
  email. The local Mail app showed Google as disconnected. Per-run approved
  addresses are intentionally not copied into this report or test fixtures.

## Executed cases

- **Superhuman / SETTINGS-001 (partial):** `⌘K` opened Superhuman Command;
  searching for “keyboard shortcuts” exposed the Shortcuts entry, which opened
  the in-app reference. Observed Search `/`, Undo `Z`, Mark Done `E`, Remind Me
  `H`, and Compose `C`. `Quick Quote` and `Instant Reply` documentation specifies
  Enter for Reply All, R for Reply, and F for Forward; the corresponding Mail
  feature is not present. See those links in `interaction-matrix.md`.
- **Mail / SEARCH-001, SEARCH-002 (partial):** local browser smoke confirmed `/`
  focuses search and a typed `c` stays in the search field rather than invoking
  Compose. Debounce, remote requests, and route restoration were not measured.
- **Mail / COMPOSE-001, COMPOSE-003 (partial):** Compose opened with an
  accessible recipient combobox. Typing `e` stayed in the recipient field
  instead of invoking Archive; Escape closed the composer. Contact suggestion
  ordering and selection paths were not exercised.
- **Mail / SEND-003 (synthetic):** fake-provider tests verify the 10-second
  deferred-send window, no “sent” success before provider confirmation, Undo
  before dispatch, and that a stale Undo callback cannot reopen after dispatch.
  No live send occurred; provider failure recovery was not exercised in the
  browser.
- **Mail / COMPOSE-012 and draft close (automated, partial):** unit tests cover
  distinguishing saved/unavailable/failed draft results. Regression contract
  tests check honest close feedback and the draft-specific delete endpoint;
  those endpoint behaviors were not verified against a connected mailbox.
- **Mail / LIST-002 and SEARCH-004 (automated contract only):** tests check
  keyboard target classification, stable row/search landmarks, and that
  keyboard scrolling includes local results as well as contact results. These
  are not substitutes for rendered interaction tests.

## Validation

- Mail: 87 test files, 690 tests passed.
- Repository: all 73 guards passed; both i18n guards passed.
- `oxfmt --check`, `git diff --check`, and direct Mail TypeScript checking
  (`tsc --noEmit -p tsconfig.json`) passed.
- `agent-native typecheck` reported that this checkout lacks production
  `BETTER_AUTH_SECRET` and persistent database configuration; no production
  build or connected-mail runtime check was performed.

## Remaining work

The interaction matrix remains mostly unrun. In particular: all viewport/touch/
drag paths; command and keyboard coverage across each view; failure/rollback,
offline and partial-account states; real autosave/reopen/delete; and a live
round-trip through only the current user's explicitly approved addresses.
That round trip is pending because Mail has no Google account connected here.

The audit also identified larger product gaps that this initial bug-fix tranche
does not close: Superhuman-style inline word/phrase autocomplete, offline cached
search, Smart Send, Auto Reminders, broader label management, and Quick Quote /
Instant Reply. Track each as a gap in the matrix until implemented and verified.
