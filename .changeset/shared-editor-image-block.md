---
"@agent-native/core": minor
---

Add a shared block-level image node to the rich markdown editor core so every
embedder gets an uploading image block — improve it once, both apps improve.

- **`features.image` + `onImageUpload`** on `createSharedEditorExtensions` /
  `SharedRichEditor`. When enabled, the editor mounts a block-level image node
  (`@tiptap/extension-image`) that serializes to standard markdown image syntax
  `![alt](src)` for the `gfm` dialect — byte-stable and source-syncable (no
  `<img width>` HTML, so the GFM `html:false` contract and the plan round-trip
  corpus are preserved). The node ships a block-aware markdown serializer so an
  image followed by prose keeps its blank-line separator.
- **Injectable upload contract** `ImageUploadFn = (file: File) => Promise<{ src;
alt? }>`. A self-contained ProseMirror plugin wires paste-image and
  drag-drop-image to the injected uploader (insert placeholder → upload → patch
  `src`), and `createImageSlashCommand(upload)` adds a `/image` file-picker
  command. With no uploader the block still renders and round-trips pasted image
  URLs / `![](url)` markdown.
- **`uploadEditorImage`** (exported from `@agent-native/core/client`): the
  default uploader. Reads the File as a data URL and calls the framework
  `upload-image` action, returning the hosted CDN URL — so any consumer gets a
  real uploading image block with no per-app upload code.

Plans now support inserting images via `/image`, paste, and drag-drop; each
image autosaves as `![alt](url)` markdown through the existing
`update-rich-text` path. The Content editor keeps its own richer image block
(Assets picker, AI alt-text, resize, NFM serialization) unchanged — it leaves
`features.image` off and injects its own image node, so the two never collide
and Content's NFM image round-trip stays byte-identical.
