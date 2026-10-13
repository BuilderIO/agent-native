---
name: mail-interaction-parity
description: >-
  Exhaustively test Mail against Superhuman Mail interaction-by-interaction.
  Use when changing Mail UX, validating keyboard/gesture/autocomplete behavior,
  or running a side-by-side parity pass.
---

# Mail Interaction Parity

Use this as the acceptance workflow for Mail behavior. The target is observable
interaction parity: the same intent, focus transition, visible state, keyboard
result, optimistic feedback, and recovery path. Do not claim product parity from
static inspection alone.

## Before testing

1. Read `mail-backends`, `inbox-reads-and-triage`, `email-drafts`, and
   `context-awareness` before touching connected mail or application state.
2. Run the app with deterministic synthetic mail when Gmail credentials are not
   available. Synthetic mail is not a live Gmail mailbox.
3. Open Mail and Superhuman side by side at the same viewport size. Record the
   exact Superhuman build/date and the Mail commit under test.
4. Seed or choose disposable messages that cover: one message, multi-message
   thread, unread, starred, labelled, draft, scheduled, attachment, HTML body,
   failed mutation, and partial account coverage.
5. Never send during the default pass. If a live round trip is explicitly
   approved, use only addresses the current user explicitly allowlisted for
   that run; use an exact user-approved subject/body and verify both Sent and
   Inbox afterward. Do not persist private addresses in fixtures or docs.

## Side-by-side protocol

For every case in `references/interaction-matrix.md`:

1. Reset both products to the same starting state.
2. Perform the numbered Superhuman steps and record the resulting URL, focused
   element, visible rows, toast/banner, network state, and elapsed feel.
3. Repeat the exact intent in Mail, including the same alternate input paths
   (mouse, keyboard, touch, drag, paste, blur, reopen, refresh, and failure).
4. Mark `match`, `partial`, or `gap`. A `partial` requires a concrete next
   action; a `gap` must name the missing product capability or state.
5. Re-run the case after each fix, then run its neighboring cases. A fix is not
   complete until success, cancellation, loading, empty, error, rollback, and
   refresh/deep-link states remain distinguishable.

Use stable Mail landmarks where present: `[data-mail-email-row]`,
`[data-thread-key]`, `#mail-search`, `#mail-search-suggestions`,
`[data-search-item]`, `[data-mail-compose]`, and the application-state keys
described in `context-awareness`.

## Safety and truthfulness

- Draft, queue, and inspect by default. A click, shortcut, or agent action that
  sends is an external side effect and needs explicit approval.
- Do not use random recipients, generated addresses, or third-party inboxes for
  round-trip tests. The user's per-run allowlist is hard, not a suggestion.
- Treat a local fallback as local. Treat a failed or incomplete account read as
  an error/partial result, never as an empty or successful mailbox.
- Do not report “bug free” or “1:1” globally. Report the tested case IDs,
  evidence, and remaining gaps.

## Verification

Run focused unit/action tests first, then a browser pass at 1440×900, 1024×768,
768×1024, and 390×844 when the browser harness is available. Check mouse,
keyboard, touch, focus, loading, empty, error, undo, deep link, and refresh.
Capture console errors and failed requests. For action changes, call the action
and read the result back. For UI changes, exercise the exact broken path in a
real browser or clearly record why the browser was unavailable.

The exhaustive cases are in
`references/interaction-matrix.md`; official comparison anchors are linked
there so the behavior baseline can be revisited when Superhuman changes.
