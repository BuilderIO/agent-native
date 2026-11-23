# Dense triage workspace

Use when people decide the fate of many records one at a time.

- Keep filter tabs above a bounded list and show the selected detail beside it.
  Render subject, status, and time in stable columns. Give unread status a
  text or icon cue. On narrow panes, show either list or detail with a Back
  control that restores filter, selection, focus, and scroll.
- Use `j` and `k` for next and previous, `e` for archive, and `#` for
  delete. Ignore these shortcuts in editable controls and while a dialog has
  focus. Document the shortcuts and put destructive actions behind the host's
  confirmation control.
- Anchor a floating bulk-action toolbar to the selection. Announce selection
  count and keep Escape available to clear it.
- Optimistically archive the item and advance to the next visible record.
  Show an Undo toast immediately. Use the same action for click, shortcut,
  and chat. On failure restore the row, active filter, and focus as appropriate.
- Use a shape-matched skeleton while fetching and retain rows on refresh.
  Distinguish an empty filtered list, a disconnected source, and a failed
  sync. Each recoverable state offers its next action.

Verify fast filter switches, keyboard-only triage, last-item archive and undo,
a rejected bulk operation, and returning from detail at 520 px.
