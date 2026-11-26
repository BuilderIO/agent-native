# Command palette and keyboard

Use for frequent navigation and operations across multiple work surfaces.

- Open a searchable, accessible command menu with Cmd+K and Ctrl+K.
  Group by destination and operation, show applicable shortcuts, and keep an
  active option in view. Enter invokes it, arrows move selection, and closing
  restores focus. Keep recent commands user-scoped.
- Route Escape to the topmost dismissible layer. A menu closes before its
  dialog, then a detail pane or selection can close on a later keypress.
  Ignore input composition and preserve normal text-editing shortcuts.
- Save drafts through scoped app state. Keep the selected record and active
  filter in routable state or the scoped workspace view. Back, reload, and
  reopening restore the draft, selection, and sensible focus.
- Use accessible app dialogs, popovers, and toasts for confirmation and
  recovery. Native `alert`, `confirm`, and `prompt` interrupt the workflow.

Verify keyboard-only launch and invocation, focus across nested Escape presses,
and draft restoration after navigation and reload.
