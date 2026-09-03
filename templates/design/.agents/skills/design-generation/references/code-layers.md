# Code Layers — Deterministic Edits vs. Coding-Agent Handoff

Full mechanics for how selected-element edits get from a canvas selection to a
persisted change, for both inline HTML/Alpine designs and localhost React/TSX
screens. See the `design-generation` SKILL.md for when to reach for this vs.
`edit-design`/`generate-design`, and the `visual-edit` skill for the localhost
bridge itself.

## Reading layer structure

`get-code-layer-projection` reads inline HTML/JSX and returns selectable layer
nodes, selectors, names, and edit intents for agent and UI workflows. This is
the read side of the same model `apply-visual-edit` writes to.

## Inline HTML/Alpine — deterministic edits

`apply-visual-edit` supports deterministic local edits for HTML-backed code
layers: text, classes, styles, attributes, source order, and small structural
changes. Use it for selected-element edits before falling back to full
`update-design` / `generate-design` rewrites.

## Localhost React/TSX — narrow deterministic slice

`apply-visual-edit` also supports a narrow deterministic slice for localhost
JSX/TSX: single-instance leaf text, literal `className`/`class`, and flat
literal `style={{ ... }}` properties. Pass `source.kind: "local-file"`,
`designId`, `connectionId`, the verified project-relative `path`, and
`intent.target.sourceAnchor`. Call once without `persist` and inspect
`proposedDiff`; call again with `persist: true` only when it is exact. The
action reads the current bridge version and writes through `write-local-file`,
so human consent and compare-and-swap remain mandatory.

For localhost React/TSX screens, treat compiler/debug metadata
(project-relative source file, line, column, component, and runtime
multiplicity) as evidence for locating source, not as permission to run a
generic AST transform. Compiler tooling may verify an anchor, classify a
literal edit, and validate syntax. Reparenting, grouping/ungrouping,
wrappers, dynamic expressions, repeated `.map()` instances, shared
components, and cross-file changes must be handed to the coding agent with
both runtime relationships and exact source anchors so it can inspect the
surrounding program semantics.

### The coding-agent handoff contract

A localhost React handoff must:

1. Read each source file first.
2. Write with the exact returned `versionHash` as `expectedVersionHash` and
   `requireExpectedVersionHash: true` — this is a compare-and-swap: the write
   is rejected if the file changed since the read.
3. Re-read and re-plan on a version conflict rather than forcing the write.
4. Leave the optimistic canvas preview in place until the dev server/HMR
   confirms the runtime result.

Never report a semantic canvas change as persisted merely because it was
submitted to the coding agent — persistence is confirmed by the dev
server/HMR picking up the change, not by the handoff call returning.

## Layer naming

Prefer `data-agent-native-layer-name="Readable name"` on meaningful elements.
The projection uses it before semantic/text fallbacks, and layer renames
should persist by updating that attribute. `data-code-layer-id` and similar
ids are for selection stability, not display naming.

## Node id stamping

For inline/Alpine screens, stamp and preserve unique
`data-agent-native-node-id` attributes on selectable DOM nodes. Treat
generated CSS selectors as a compatibility fallback only. For localhost React
screens, resolve through build-time source/debug metadata (stable generated
ids, component name, file, and line) before falling back to selectors.

## Summary of the split

- Inline/Alpine screens continue to use deterministic HTML code-layer edits.
- Localhost React/TSX screens use the semantic coding-agent handoff above;
  deterministic direct React writes remain intentionally limited to the leaf
  literal slice above and never include generic structural transforms,
  breakpoint writes, dynamic expressions, repeated renders, shared component
  definitions, generated/out-of-root paths, or remote URLs.
