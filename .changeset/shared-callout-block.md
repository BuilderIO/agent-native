---
"@agent-native/core": minor
---

Move the full plan-specific block set into the shared core block library so any
app that registers the library (plan, content, future templates) gets every rich
block — not just plan.

- New shared library blocks: `callout`, `decision`, `question-form`,
  `visual-questions`, `diagram`, and `wireframe` (plus the wireframe kit
  primitives in `library/wireframe-kit.tsx`). Each ships a React-free
  `*.config.ts` (schema + MDX) and a `*.tsx` (`Read`/`Edit` + spec), is added to
  both `libraryBlockSpecs` (client) and `libraryBlockConfigs` (server), and is
  exported from the blocks entry. They are decoupled from the plan app: no
  `@/components/ui` / shadcn imports (popovers go through `ctx.renderEditSurface`),
  and HTML-bearing blocks self-sanitize via the new
  `library/sanitize-html.ts` (DOM-based in the browser, regex fallback on the
  server) instead of relying on a host-wired hook.
- The shared block CSS "contract" now lives in core `styles/blocks.css`
  (imported by `agent-native.css`): the generic block label/columns/code-surface/
  prose/annotation rules, the `text/bg/border-plan-*` color utilities, the
  app-neutral `an-callout` tone styling, and the wireframe-kit + inline-diagram
  styling. Colors resolve against shadcn theme tokens (`--foreground`,
  `--muted-foreground`, `--border`, `--muted`) — or, for the migrated wireframe/
  diagram CSS, against plan vars with theme-token fallbacks — so the blocks render
  in any app using that app's palette. Because `blocks.css` loads before a
  template's `global.css`, the plan template's existing rules still win there, so
  plan renders unchanged.
- `BlockRenderContext` gains an optional `onQuestionFormSubmit(summary)` hook so
  the shared question-form/visual-questions blocks can route answers back to the
  host without importing app-specific submit wiring.

Plan's local registration of these blocks (client + server) is removed in favor
of the shared library copies; plan now registers no app-only blocks.
