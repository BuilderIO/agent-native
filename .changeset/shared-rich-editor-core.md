---
"@agent-native/core": minor
---

Extract the rich markdown editor into ONE shared, configurable core so the plan
and content editors can build on a single surface instead of duplicating the
base Tiptap setup, markdown wiring, collab seed/reconcile logic, and the slash /
bubble menus.

New exports from `@agent-native/core/client`:

- `createSharedEditorExtensions(opts)` — the single extension factory. Assembles
  StarterKit + Placeholder + Link + tasks + tables + a dialect-keyed
  `tiptap-markdown` serializer (`MARKDOWN_DIALECT_CONFIG` for `gfm`/`nfm`), then
  optional Collaboration/CollaborationCaret, then app-injected `extraExtensions`.
  Accepts `{ dialect, preset, placeholder, features, extraExtensions, collab }`,
  plus a `starterKit` override (disable replaced nodes / swap the dropcursor), a
  `markdown` config override, and `features.placeholder` / `features.markdown`
  toggles so an app with a bespoke placeholder resolver or its own serializer
  (Content's NFM converter) can reuse just the StarterKit base + collab wiring.
- `useCollabReconcile(...)` — the seed / reconcile / lead-client / change-origin
  logic extracted into a reusable hook, so the subtle collab behavior is never
  duplicated again. Returns the `onUpdate` guards (`shouldIgnoreUpdate`,
  `registerEmitted`) plus the `isSettingContent` ref. Accepts `getMarkdown`,
  `setContent`, `normalizeValue`, `shouldSeed`, and `initialAppliedUpdatedAt`
  overrides so a non-`tiptap-markdown` serializer (Content's
  `docToNfm`/`nfmToDoc`/`canonicalizeNfm`, sentinel-`<empty-block/>` seed, and
  stale-Y.Doc-on-open reconcile) round-trips byte-identically through the hook.
- `SlashCommandMenu` + `DEFAULT_SLASH_COMMANDS` and `BubbleToolbar` +
  `buildDefaultBubbleItems` — the inline menus promoted to standalone,
  extendable components (apps pass their own `items` / `buildItems`).
- `SharedRichEditor` — the editor component (props: `value`, `onChange`,
  `onBlur`, `contentUpdatedAt`, `editable`, `interactive`, `placeholder`,
  `className`, `editorClassName`, `dialect`, `preset`, `features`,
  `extraExtensions`, `ydoc`, `awareness`, `user`, plus optional `slashItems` /
  `buildBubbleItems` overrides).

`RichMarkdownEditor` and `createRichMarkdownExtensions` remain exported as
back-compat aliases over the shared core, preserving today's GFM/plan behavior
exactly — the round-trip fidelity and collaboration specs stay green and the
plan editor is unchanged. Content-specific Notion/media/comment/database
extensions are injected via `extraExtensions`, never forced into the shared
core.

Phase 2: the Content (Documents) editor now builds on this same shared core. Its
`createVisualEditorExtensions` routes through `createSharedEditorExtensions`
(sharing the StarterKit base + the Collaboration/CollaborationCaret wiring +
ordering), and its inline collab seed/reconcile/lead-client/`onUpdate`-guard
logic is replaced by `useCollabReconcile` with Content's NFM serializer injected.
Content keeps every Notion/media/comment/database/NFM-fidelity behavior as
`extraExtensions` and its own slash/bubble menus, and its NFM round-trip
(`docToNfm(nfmToDoc(x)) === x`) stays byte-identical — so plan and content now
share one editor core.
