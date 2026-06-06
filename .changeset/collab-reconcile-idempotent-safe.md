---
"@agent-native/core": patch
---

Fix a content-corrupting reconcile loop in the shared `useCollabReconcile` hook
(`RichMarkdownEditor` / `SharedRichEditor` for Plans, and the Content editor that
reuses the hook with its NFM overrides).

Two compounding bugs caused a rich-text block to escalate every poll
(`<h1>…</h1>` → `&lt;h1&gt;…` → `&amp;lt;h1&amp;gt;…` …) and fight active typing:

- **Trigger:** the default `setContent` passed
  `parseOptions: { preserveWhitespace: "full" }`. In tiptap v3 that routes the
  command through `insertContentAt`, which tiptap-markdown ALSO overrides to
  re-run its markdown parser — double-parsing the already-parsed doc and
  re-emitting it as escaped HTML. So even a clean heading/list/code block came
  back non-idempotent and drifted on every reconcile. The default now hands the
  markdown string straight to tiptap-markdown's `setContent` override (no
  `parseOptions`); the GFM corpus round-trips byte-stably, code-block and
  empty-line whitespace included.
- **Containment:** the reconcile only skipped re-applying when the editor's raw
  serialization equalled the incoming value, so a NON-idempotent value
  (`serialize(parse(value)) !== value`, e.g. raw HTML stored in a block) was
  re-applied indefinitely. The reconcile now compares by DOC EQUIVALENCE: it
  tracks the raw value it last applied and the editor's serialized output after
  that apply, recognizes both a re-supplied raw value and its own autosaved
  serialized echo as already-applied, and re-checks at apply time. A
  non-idempotent block is now applied AT MOST ONCE and the editor stabilizes
  instead of corrupt-looping. External content is also never applied while the
  user is actively typing.

The idempotent (normal) path, the lead-client election, the `isChangeOrigin`
skip, and Content's NFM `getMarkdown`/`setContent`/`normalizeValue`/`shouldSeed`
overrides are unchanged.
