---
name: plan-browser-editing
description: >-
  Which browser surfaces are directly editable and which patch op each one
  autosaves through — inline prose, local plan folders, review annotation mode,
  canvas/design elements, and branding. Use when changing plan prose, styles, or
  wireframe/prototype HTML.
---

# Browser Editing

- Prose in `rich-text` blocks is edited inline with the shared
  `RichMarkdownEditor`, autosaved through `update-visual-plan` with
  `contentPatches: [{ op: "update-rich-text", blockId, markdown }]`.
- The single-document editor saves the whole block list with `replace-blocks`
  and `expectedUpdatedAt`. The live Yjs document `plan:<planId>` is the source of
  truth for text: autosave sends pending Yjs updates first (`flushUpdates`), then
  reads the blocks from the document, not from the last keystroke. A
  `plan_revision_conflict` three-way merges those blocks onto the newest saved
  ones by block id (`shared/plan-blocks-merge.ts`) and retries; only overlapping
  edits reach the "Couldn't save" pill. `seed-plan-collab` seeds the empty live
  document once, so two editors opening together cannot duplicate the content.
- Local `/local-plans/:slug` folders opened from `PLAN_LOCAL_DIR` or a
  repo-relative `?path=...` use the same Notion-style browser editor, but
  autosave through `update-local-plan-folder` so changes are written to
  `plan.mdx`, `canvas.mdx`, and `prototype.mdx` without touching the Plan
  database.
- Review annotation mode makes prose temporarily read-only so clicks can pin
  feedback. Leaving review mode restores inline prose editing.
- Canvas, artboard, wireframe, diagram, and custom visual edits remain driven by
  comments, source patches, or structured content patches rather than direct
  rich-text editing.
- Design-mode artboards can be element-edited with `update-visual-plan`
  `contentPatches: [{ op: "update-design-element-style", frameId, blockId,
elementId, styles }]`. Elements must have `data-design-id` or
  `data-plan-design-id`; use `patch-wireframe-html` / `patch-prototype-html` for
  structural or text changes.

## Branding

- The sidebar brand header has a `Customize branding` popover. Treat it as a
  source-code request, not plan data: local Code mode edits `templates/plan`
  source directly, while hosted/live surfaces route people to Desktop or
  Builder for code customization.

## Related Skills

- **plan-comments-and-feedback** — the review/annotation side of these surfaces.
- **plan-source-sync** — the MDX files local folder autosave writes to.
- **plan-hosted-writes** — verification required after each hosted write.
