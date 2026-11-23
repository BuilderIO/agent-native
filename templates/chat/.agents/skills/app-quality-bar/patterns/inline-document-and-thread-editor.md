# Inline document and thread editor

Use when people compose structured items while staying close to their context.

- In a block editor, Enter creates a sibling block and Shift+Enter inserts a
  line break. For a thread composer, document the same distinction when Enter
  submits and Shift+Enter inserts a newline. Respect IME composition and keep
  focus on the new block or next draft after success.
- Open a slash menu at the caret where commands are valid. Filter by typed
  text, announce the selected entry, and use Escape to return to the draft.
- Render edits immediately and debounce scoped autosaves with a revision or
  ordering guard. Show saving, saved, offline, and retry states near the
  editor. Preserve dirty input across failures and navigation.
- Publish current document and focused block IDs, selection, and dirty status
  in `view-screen`. Expose bounded unsaved text only where the agent and
  current viewer are entitled to read it. Keep the persisted version separate
  from the current draft and surface intervening edits before overwriting.

Verify paste, undo after autosave, two rapid edits with out-of-order responses,
failed-save recovery, and a chat follow-up about the active unsaved change.
