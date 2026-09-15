# Content editor Cmd+K contract repair

## Decision

Repair Content's root command-menu shortcut so `Cmd+K` / `Ctrl+K` opens the
command menu while the page editor has an ordinary caret, without stealing the
same shortcut from the editor's selected-text link control.

This is a contract repair for Feature
`content.feature.put-your-organizations-know-how-to-work` and Capability
`content.command.fabric`. It restores the already shipped “Cmd+K opens from the
editor” behavior; it does not change command discovery, ranking, Actions, or
the selected-text link-editing contract.

## Current evidence

Real-interface repro on the local Content app at the current branch:

- With a caret in the page body, `Ctrl+K` is claimed but no command menu opens.
- From non-editable page chrome, `Ctrl+K` opens the command menu and focuses its
  search field.
- With page-body text selected, `Ctrl+K` opens the editor's **Paste link…**
  control. This is intentional and must remain true.

The shared `useCommandMenuShortcut` hook already supports opening from a
`contenteditable` target, but that option listens in capture phase. Restoring
Content's old boolean opt-in unchanged would open the global menu before the
editor can handle selected text. Git history confirms that Content added the
opt-in with the June 30 command-search baseline and removed it on July 27 when
selected text was routed to the link editor.

## Proposed implementation

Keep shortcut ownership in the shared root command-menu hook. Extend its
existing `allowContentEditable` option with a narrowly named predicate for a
contenteditable shortcut collision. When the predicate declines the event, the
hook must return before `preventDefault` or `stopPropagation`, allowing the
focused editor to handle it. Existing callers that omit the predicate retain
their current behavior.

Content should enable `allowContentEditable` and decline only when the event
comes from the page editor and its active DOM selection is a non-collapsed text
selection. A collapsed caret opens the command menu. Other contenteditable
surfaces, a selected node, or state without a DOM text range are not treated as
the link-editing collision.

Do not move the global shortcut into `VisualEditor`, add another command-menu
event listener, change the link shortcut, or broaden this repair to native
`input`, `textarea`, or `select` controls. Those controls remain under the
shared hook's existing policy.

Expected implementation surfaces:

- `packages/core/src/client/CommandMenu.tsx` and its focused shortcut tests.
- `templates/content/app/root.tsx` for the collision-aware opt-in.
- The required Core changeset and Content changelog entry.

No Feature or Capability record changes are needed because the accepted user
promise is unchanged.

## Frozen acceptance story

- **K01 — Caret opens palette:** Given focus in the editable page body with a
  collapsed caret, pressing `Cmd+K` on macOS or `Ctrl+K` elsewhere opens the
  Content command menu and focuses command search.
- **K02 — Selection keeps link shortcut:** Given a non-collapsed page-body text
  selection, the same shortcut opens **Paste link…**, does not open the command
  menu, and leaves the selected text unchanged.
- **K03 — Outside-editor behavior is stable:** From non-editable Content chrome,
  the shortcut continues to open the command menu.
- **K04 — Dismissal restores editing:** Escape closes the command menu and
  returns focus to the connected editor trigger so typing can continue at the
  prior caret.
- **K05 — Native controls stay scoped:** Focused `input`, `textarea`, and
  `select` controls retain the shared hook's current behavior; this repair does
  not make the command menu open from them.
- **K06 — Competing handlers are not swallowed:** When the contenteditable
  collision predicate declines a shortcut, the event is not default-prevented
  or propagation-stopped by the command-menu hook.

## Proof plan

Add focused Core hook coverage for the accepted and declined contenteditable
paths, including K06, while retaining the existing capture-before-editor test.
Retain the existing BubbleToolbar selected-text Mod+K regression and add the
smallest Content wiring coverage available without duplicating the hook tests.
Run the focused Core command-menu and Content editor tests, Content typecheck,
and applicable guards.

Finish with same-context real-interface QA on the final artifact: one coherent
keyboard pass covering K01–K05 on a Page, including visible focus after opening
and after Escape. Desktop is the relevant viewport; this repair has no distinct
responsive layout contract. Independence is preferred but not required, with
same-context custody allowed.

## Work result — 2026-09-14

Implemented the shared collision predicate and Content's page-editor policy.
Focused Core command-menu tests pass (15/15), the Content BubbleToolbar tests
pass (25/25), and both Core and Content typechecks complete successfully.

The final local Content build passed the K01–K05 keyboard story in the real
interface: a caret opens command search, Escape restores the editor caret, a
text selection still opens **Paste link…**, native title input focus does not
open command search, and non-editable chrome still does. K06 is covered by the
focused hook test, which verifies that a declined event remains unclaimed.

The full guard wrapper could not launch on this Windows checkout (`spawn
EINVAL`). Its relevant guards were run directly; the remaining reported guard
failures are pre-existing repository/worktree baselines rather than behavior
gaps in this change.
