---
"@agent-native/core": minor
---

Notion-style code blocks for the shared editor and plan surfaces. The rich
markdown editor's fenced code blocks now render through a shared
`createCodeBlockNode` node view with a language picker header (Auto-detects by
default) instead of a bare highlighted `<pre>`, and the editor code surface
follows the app's light/dark `--muted`/`--foreground`/`--border` tokens instead
of a hardcoded dark navy. The read-side `CodeSurface` (code tabs, API specs,
markdown read view) gains a language label and collapses long snippets behind a
"Show N more lines" toggle (default 30 lines, configurable per code tab via the
new `maxLines` field, `0` to disable) rather than scrolling a fixed-height box.
New exports: `createCodeBlockNode`, `DEFAULT_CODE_LANGUAGES`, `CodeSurface`,
`HighlightedCode`, `prettyLanguageName`, `DEFAULT_CODE_MAX_LINES`.
