---
"@agent-native/core": minor
---

Consolidate the plan block set into the shared core block library so any app that
registers the library (plan, content, future templates) gets the same rich blocks
— and cut the redundant `decision` block.

- Moved into the shared library: `callout`, `question-form`, `visual-questions`,
  `diagram`, and `wireframe` (plus the wireframe-kit primitives in
  `library/wireframe-kit.tsx`). Each ships a React-free `*.config.ts` (schema +
  MDX) and a `*.tsx` (`Read`/`Edit` + spec), is registered in both
  `libraryBlockSpecs` (client) and `libraryBlockConfigs` (server), and is exported
  from the blocks entry. They're decoupled from any single app: no shadcn imports
  in core (popovers go through `ctx.renderEditSurface`), and HTML-bearing blocks
  self-sanitize via the shared `library/sanitize-html.ts` (DOM-based in the
  browser, regex fallback on the server).
- The shared block CSS "contract" now lives in core `styles/blocks.css` (imported
  by `agent-native.css`): block label / code-surface / prose / annotation rules,
  the `text/bg/border-plan-*` color utilities, the app-neutral `an-callout` tone
  styling, and the wireframe-kit + inline-diagram styling — all resolving against
  shadcn theme tokens (with plan-var-with-theme-token fallbacks for the migrated
  wireframe/diagram CSS) so blocks render in any app's palette. Because
  `blocks.css` loads before a template's `global.css`, the plan template's
  existing rules still win there, so plan renders unchanged.
- `BlockRenderContext` gains optional `onQuestionFormSubmit(summary)` so the
  shared question-form / visual-questions blocks route answers back to the host
  without app-specific wiring.
- `BlockRegistry.register` now OVERRIDES on a duplicate block `type`/`tag`
  (last-registration-wins) instead of throwing — lets an app override a library
  block and makes module-level registration idempotent under dev HMR (which
  otherwise crashed with "Block type … is already registered").
- Removed the `decision` block (it duplicated a `callout` with `tone:"decision"`
  plus a `columns`/list comparison). It's gone from the registry, agent
  vocabulary, slash menus, and the plan skills (which now steer to callout +
  columns). Because `decision` was also a legacy member of plan's stored-content
  schema, a content migration rewrites any stored decision block into a
  decision-tone `callout` on load (question + options in the body, recommended
  flagged) so existing plans keep loading and rendering. `callout`'s `decision`
  tone is retained.
