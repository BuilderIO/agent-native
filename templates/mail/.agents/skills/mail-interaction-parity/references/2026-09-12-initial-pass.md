# Mail parity pass — 2026-09-12

Status: initial, partial pass; this is not a claim of 1:1 parity or zero bugs.

## Reference and safety boundary

- Compared against the installed Superhuman desktop app and its in-app keyboard
  reference. The app build/version was not exposed in the UI.
- The Mail working tree was based on `2f1c3f6927519873151c322a352b89cb891bb88e`.
- Did not open or inspect message content or send/receive email. Opened an empty
  Superhuman compose only to compare layout, then discarded it and verified the
  discard toast. The local Mail app showed Google as disconnected; a temporary
  local compose smoke draft was also discarded. Per-run approved addresses are
  intentionally not copied into this report or test fixtures.

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
  tests check honest close feedback, waiting for close-time persistence, and
  account-aware deletion. The endpoints were not verified against a connected
  mailbox.
- **Mail / COMPOSE-013 (automated, partial):** regressions cover the close-time
  save result, exact secondary-account deletion, local fallback deletion, and
  retaining Cc/Bcc-only drafts in close recovery. Slow provider behavior and
  rendered toast actions remain untested in a connected mailbox.
- **Mail / LIST-002 and SEARCH-004 (automated contract only):** tests check
  keyboard target classification, stable row/search landmarks, and that
  keyboard scrolling includes local results as well as contact results. These
  are not substitutes for rendered interaction tests.

## Validation

- The initial complete Mail run passed 735 tests across 92 files. The focused
  `ComposeModal` suite passes all 6 tests, including expanded new-message and
  unchanged compact-reply defaults.
- Repository: all 73 guards and both i18n guards pass after the latest review
  follow-up.
- `oxfmt --check`, `git diff --check`, and direct Mail TypeScript checking
  (`tsc --noEmit -p tsconfig.json`) pass after the latest review follow-up.
- Repository-wide `pnpm run prep` was attempted but is not a clean gate in this
  checkout: all 73 guards completed, while workspace typechecking reports
  missing unrelated package/type dependencies. The Core suite reported 14,939
  passing tests and two failures because `katex` is unavailable; further
  workspace tests also hit missing Vitest package links and were stopped after
  those environment failures. This does not replace the passing full Mail suite.
- `agent-native typecheck` reported that this checkout lacks production
  `BETTER_AUTH_SECRET` and persistent database configuration; no production
  build or connected-mail runtime check was performed.
- The PR preview build, deploy, and smoke check passed; the preview opens to its
  sign-in screen. PR-preview OAuth was not used. Local account-backed access is
  blocked by missing Google OAuth client credentials (see the 2026-09-13
  follow-up below).

## Draft lifecycle review follow-up — 2026-09-12

A fresh review found five concrete mailbox/persistence gaps: reopening a saved
draft did not preserve its selected sender account; delete and delete-all could
use the default instead of saved mailbox metadata; local saved drafts could be
re-routed to Gmail after connection state changed; autosave and close could race
and create/overwrite the wrong draft; and discard could leave a late autosave
behind. The implementation now carries backend/account metadata through open,
save, and delete; serializes saves and compose-state deletion; and waits for an
in-flight save before deleting its resulting mailbox copy. COMPOSE-014 through
COMPOSE-017 were added to the matrix. These are automated contract/regression
checks; they do not count as the still-missing rendered side-by-side cases.

## Draft ownership, close-all, and Send Undo follow-up — 2026-09-12

A fresh review found five additional lifecycle gaps: legacy drafts without
backend metadata could be routed according to current Gmail connection state;
agent updates did not honor an explicitly local saved draft; close-all could
delete a compose tab opened while its writes were pending; and Send Undo could
lose the saved mailbox copy while asynchronous discard was still running. The
HTTP and agent paths now verify legacy ownership against the exact local draft
or a Gmail draft lookup, and fail without mutating when ownership is unknown.
Local agent updates stay in the local mailbox under its mutation lock. Close-all
queues deletion for only the IDs it captured. Deferred Send hides its compose
tab during Undo, keeps both copies intact until provider success, then discards;
Undo and provider failure restore the same draft.

The focused regressions and complete Mail suite pass, and Mail TypeScript
checking passes. The close-all race, saved-draft ownership, local agent update,
and Send Undo lifecycle still need the rendered side-by-side browser cases
described in COMPOSE-014–016; the connected preview remains at sign-in pending
explicit OAuth approval.

## Rendered compose smoke — 2026-09-12

- **Superhuman / COMPOSE-001 (partial):** clicking Compose opened a new-message
  workspace with To focused and a draft-specific route. No recipient, subject,
  or body was entered; Discard draft returned to the inbox and showed a
  “Draft discarded” confirmation.
- **Mail / COMPOSE-001, COMPOSE-003 (partial):** on local `/inbox` with Google
  disconnected, Compose opened with the To combobox focused. Enter committed a
  reserved synthetic recipient as a chip; Cc/Bcc revealed separate fields and
  focus remained in the recipient controls. No contact suggestions were
  available in the empty local mailbox. The test draft was discarded; Send was
  never activated.
- The first rendered Mail pass showed a bottom-right 540×520 compose window,
  unlike Superhuman's main-workspace new-message flow. Mail now opens a new
  compose draft expanded by default. The browser smoke verified the expanded
  state and that Mail stays on `/inbox`; Superhuman changes to a draft route.
  Exact size parity remains partial because the native Superhuman window and
  local browser could not be held at the same viewport. The reference build
  and browser dimensions were not available as stable metadata.
- COMPOSE-001 is therefore still partial: Mail's draft state stays over the
  inbox route, and width/centering were not verified at a matched viewport.
- This smoke did not inspect message content, send or receive mail, or authorize
  Google OAuth. It does not cover reply/forward, autocomplete ordering, keyboard
  compose shortcuts, or the send-validation path.

## Remaining work

The 84-case interaction matrix remains mostly unrun. In particular: all viewport/touch/
drag paths; command and keyboard coverage across each view; failure/rollback,
offline and partial-account states; real autosave/reopen/delete; and a live
round-trip through only the current user's explicitly approved addresses.
That round trip is pending because local Mail's Google OAuth route currently
reports missing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
COMPOSE-014 through COMPOSE-017 have automated regression coverage but still
need the matrix's rendered side-by-side steps when both products are available.
SEARCH-011 now guards combobox active-descendant references against closed or
stale suggestion lists; the fix is unit/contract tested but its rendered rapid-
filter transition still needs side-by-side browser coverage.

The audit also identified larger product gaps that this initial bug-fix tranche
does not close: Superhuman-style inline word/phrase autocomplete, offline cached
search, Smart Send, Auto Reminders, broader label management, and Quick Quote /
Instant Reply. Track each as a gap in the matrix until implemented and verified.

## PR review and local OAuth follow-up — 2026-09-13

- The latest complete Mail suite passes 742 tests across 92 files. Mail
  TypeScript checking, all 73 repository guards, both i18n guards, `oxfmt
  --check`, and `git diff --check` pass.
- Regression coverage now includes late autosave metadata after close, save-first
  close-all for captured compose IDs, retaining a recoverable draft and its last
  confirmed mailbox ID on save failure, deleting the last saved copy on discard
  even when a pending save rejects, a 409 for a missing explicitly saved local
  draft, SVG/text-node keyboard targets, Tab/Shift+Tab cycling, and conditional
  combobox `aria-controls` references.
- The local Mail app started at `http://localhost:8080/inbox`. Selecting
  **Connect Google** reached
  `/_agent-native/connections/oauth/gmail/start?appId=mail&scope=user&return=%2Finbox`
  and displayed “Gmail OAuth client credentials are not configured.” The app's
  supported flow requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; no
  OAuth consent or account grant occurred. No live mailbox content was opened,
  and no messages or drafts were sent or changed. Read-only provider-backed
  mailbox/search/thread verification remains incomplete until local Mail has
  its OAuth client credentials configured.
