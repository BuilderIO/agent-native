---
"@agent-native/core": minor
---

Add optional real-time multi-user editing to the shared `RichMarkdownEditor`.

`RichMarkdownEditor` (and the `createRichMarkdownExtensions` factory) now accept
optional `ydoc`, `awareness`, and `user` props. When a `ydoc` is supplied the
editor binds the framework's existing collaboration stack — `Collaboration` over
the shared `Y.Doc`, plus a `CollaborationCaret` for live cursors when an
`Awareness` is present — and disables StarterKit's built-in undo/redo so Yjs owns
history. The lead client (elected via `isReconcileLeadClient`) seeds the empty
shared doc once from the markdown `value`, `onChange` skips remote-origin
transactions before serializing, and external markdown is reconciled only by the
lead client when it is genuinely newer. Markdown (GFM) stays the canonical
emitted/saved representation — the `Y.Doc` is transient live state and is never
written into stored content.

With no `ydoc`, the editor is byte-for-byte the same controlled `value`/`onChange`
single-user editor as before, so existing embedders are unaffected. This lets a
template wire per-block collaborative prose editing by pairing the editor with
`useCollaborativeDoc` and a `createCollabPlugin` mount, reusing the shared collab
backend instead of reimplementing CRDT sync. New exports:
`createRichMarkdownExtensions`, `RichMarkdownCollabUser`, and
`CreateRichMarkdownExtensionsOptions` from `@agent-native/core/client`.
