---
"@agent-native/core": patch
---

Composer: pasting an HTML document now behaves like uploading that `.html` file.
Page-sized pastes already convert to a "Pasted text" attachment chip, but the
composer only ever read the clipboard's `text/plain` flavor and labelled the chip
a generic `pasted-text-*.txt`. When a user pasted HTML to host as an extension,
the agent received a nondescript text blob — so instead of reading it verbatim via
`contentFromAttachment`, it re-emitted the markup inline as a tool argument, which
cut off mid-stream on large files and degenerated into a continuation loop (the
chat "spun for a while"). Uploading the same content as a file worked because the
file carried the real HTML with a recognizable name/type.

`TiptapComposer`'s paste handler now captures the clipboard's `text/html` flavor
and, when the pasted content is an HTML document/source, stores it as a real
`pasted-text-*.html` attachment (`text/html`) with the markup preserved verbatim —
so paste and file-upload travel the identical attachment rail. Plain prose and
code stay `.txt` (the detection keys off the pasted content, not the `text/html`
flavor, so editor syntax-highlight markup and Google Docs formatting don't
mis-promote plain code/prose to HTML).
