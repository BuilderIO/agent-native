# Add colored text highlighting to the Content editor

## Summary

Content writers need Notion's familiar selected-text color interaction: one `A`
control containing named text and background colors, with the formatting
remaining part of the document after save, reload, collaboration, and canonical
serialization. The smallest useful slice exposes the editor's existing
persistent `notionSpan` mark through the existing selection bubble toolbar. It
does not create a second highlight object, reuse comment decorations as document
content, or add a new editor abstraction.

Source task: Bowerbird ID `69a7e1cf-249f-43c6-97a0-c14455c836d6`, supplied
title “Add colored text highlighting to Content editor.” The exact live task
record could not be recovered on 2026-08-18: the local vault returned no matching
note, Content's indexed read found neither the ID nor title, and its live lookup
was unavailable because of an A2A delegation cycle. The title and ID are direct
evidence from Alice's delegated Shape request; no unavailable task body, status,
or acceptance notes are inferred.

## Notion parity audit status

On 2026-08-18 Alice authorized a read/write audit in the logged-in Codex in-app
browser, then explicitly authorized Notion desktop as the fallback. Shape
created Notion page
`3c0ccf6483ce808b8198d1a8ba36e519` at
`https://app.notion.com/p/tempoimmaterial/3c0ccf6483ce808b8198d1a8ba36e519`
and entered test text. The in-app browser connection then reset, so the audit
resumed in the logged-in Notion desktop app on the same page.

Directly observed in Notion desktop:

- Selecting `bravo` opens one floating selection toolbar and retains the exact
  selection while its color UI is open.
- The toolbar's color entry is an `A` button. Activating it expands the color UI
  inside that same floating toolbar rather than opening an unrelated document
  or block-level control.
- The expanded UI contains, in order, a single-row **Recently used** area,
  **Text color**, then **Background color**.
- Text color and background color each show a default choice followed by the
  same nine hue families: gray, brown, orange, yellow, green, blue, purple,
  pink, and red. The UI is a compact unlabeled swatch grid; color identity is
  visual in the screenshot and therefore requires accessible names in Content.
- The same toolbar also exposes text style, bold, italic, underline,
  strikethrough, Clear format, link/comment, and other selection operations.
  Color is therefore one member of Notion's existing selection-formatting
  interaction, not a separate highlight-only toolbar.

The desktop accessibility bridge exposed the selection and the color-panel
structure, but its coordinate action backend returned `noWindowsAvailable` for
the swatches. Applying a swatch, replacing it, selecting a mixed-color range,
and exercising default/clear and collapsed-caret behavior could not be directly
completed. Shape therefore treats those transition details as explicit Content
product decisions below rather than claiming they were observed Notion facts.
They are frozen for Work and must be proved in Content's real interface.

## WORK PAUSED — RETURNING TO SHAPE

Work inspection found a material contradiction in the frozen architecture.
`notionSpan` can hold `color` and `bgColor` simultaneously in ProseMirror, but
`docToNfm` currently serializes `a.color || a.bgColor` into one `color`
attribute. When both are present, foreground wins and background is silently
lost on save. The existing NFM parser likewise derives foreground versus
background from one `_bg`-suffixed `color` value. Therefore the frozen combined
Notion interaction cannot satisfy its save/reload acceptance story by merely
exposing the existing mark.

This is direct source evidence from `templates/content/shared/nfm.ts`, not a
test failure or implementation preference. Shipping edits remain paused.

### Material delta and options

1. **Return to background-only highlighting.** Keep the existing NFM contract
   unchanged and expose only background swatches. This is smallest, but it no
   longer matches the observed combined Notion `A` interaction Alice requested.
2. **Expose both palettes but make them mutually exclusive.** Choosing a text
   color would clear background and vice versa. This preserves current NFM but
   invents destructive behavior that is neither Notion-like nor humane.
3. **Add backward-compatible dual-color NFM serialization. Recommended.** Keep
   the existing single `notionSpan` mark and existing one-color spellings, while
   adding an explicit background attribute only when needed so foreground and
   background can coexist. Parsing accepts both old documents and the new
   dual-color spelling; no database schema, second mark, or migration is added.

### Old fingerprint

- Outcome: match Notion's combined selected-text color interaction.
- Governing architecture: expose existing `notionSpan.color` and
  `notionSpan.bgColor` without changing canonical representation.
- Acceptance story: both attributes survive canonical save/reload.

### Proposed replacement fingerprint

- Outcome and shipping surface remain unchanged.
- Governing architecture changes: the combined toolbar still updates the one
  `notionSpan` mark, and NFM gains a backward-compatible dual-color spelling
  that preserves both attributes while continuing to parse and emit established
  one-color documents unchanged.
- Replacement acceptance story: the frozen combined interaction passes all
  prior assertions, and additionally proves old foreground-only and
  background-only NFM fixtures remain byte-stable while a dual-color fixture
  round-trips both attributes without silent loss.
- Risk strategy remains `system-ready` without a feature flag because the
  representation change is additive, locally reversible, and gated by focused
  compatibility plus real-interface save/reload evidence.

Smallest decision required: approve option 3 and replacement story, or choose
option 1. Option 2 is not recommended.

### Approval and Work restoration

Alice approved option 3 and invoked `$work` in the calling Codex task on
2026-08-18. That exact user message approves the proposed replacement
fingerprint and acceptance story. The additive dual-color NFM architecture is
therefore frozen; the prior return-to-Shape pause is resolved and Work may
resume within the replacement envelope below.

## Context and constituency

The constituency is signed-in Content writers editing the canonical rich-text
body of a Page in `BuilderIO/agent-native`, specifically
`templates/content`'s visual document editor. Today, selecting text opens a
bubble toolbar with persistent marks for bold, italic, strike, code, and link,
plus a comment command. There is no user-facing command in that toolbar for
persistent named text or background color.

The word “highlight” is overloaded in the current editor:

- Comment highlights are ProseMirror decorations derived from SQL-backed
  comment anchors. Their source explicitly says they are presentation overlays,
  not document marks, and they never enter NFM serialization.
- Selection fill and recent-edit highlights are also transient presentation.
- `notionSpan` is an existing inline document mark with `color`, `bgColor`, and
  underline attributes. NFM serializes a background as
  `<span color="yellow_bg">…</span>` and parses `_bg` values back into
  `bgColor`; the editor renders the mark as `background-color`.

This shape uses “colored text highlighting” to mean the third behavior plus its
observed Notion companion: durable foreground and background attributes owned
by the document body through one combined color control.

## Desired outcome

A signed-in writer selects ordinary inline text, opens one `A` color control,
and chooses a named text or background color. The exact selected characters
change immediately, the mark composes with existing inline formatting, and the
result remains equivalent through ordinary save, reload, collaboration,
copy/serialization, and parse paths. The writer can independently return text
or background color to Default without removing the other color or unrelated
marks.

## Recommended behavior

### Selection semantics

- The entry point appears in the existing bubble toolbar, which already opens
  only for a non-empty text selection and excludes media, registry blocks, and
  other atom-like nodes.
- Choosing a text or background color applies the existing `notionSpan` mark to the current
  selection. It does not color an entire block merely because part of the block
  is selected.
- A selection crossing compatible inline text in multiple ordinary text blocks
  applies the mark to each selected text range using TipTap/ProseMirror's normal
  mark semantics. Excluded nodes remain unchanged.
- This first slice does not expose a collapsed-caret command or set a stored mark
  for future typing. With no non-empty selection, no color control is
  shown.
- Applying a text color replaces only the selection's existing
  `notionSpan.color`; applying a background replaces only `notionSpan.bgColor`.
  Both preserve underline and all unrelated supported attributes. Choosing
  Default clears only the attribute for that section; if the resulting
  `notionSpan` has no remaining meaningful attributes, the empty mark may be
  removed.

### Color semantics

- Match Notion's observed combined color entry rather than inventing a separate
  highlight-only control. The `A` panel contains Recently used, Text color, and
  Background color in that order.
- Offer the existing bounded Notion-compatible foreground vocabulary and its
  background counterpart:
  `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, and
  `red`, plus Default; backgrounds use
  `gray_bg`, `brown_bg`, `orange_bg`, `yellow_bg`, `green_bg`, `blue_bg`,
  `purple_bg`, `pink_bg`, and `red_bg`.
- Display the choices as named, theme-legible swatches with accessible text
  labels and selected state. Match the observed default-plus-nine order in both
  sections; no color is silently applied before the writer chooses one.
- Store named tokens, not arbitrary CSS, hex, RGB, theme variables, or recent
  custom colors. The existing NFM `_bg` token is the canonical serialized
  value; rendering may map it to theme-appropriate visual colors.
- Default in the Text color section clears only foreground color. Default in the
  Background color section clears only background color. The toolbar's existing
  Clear format command remains broader and is not relabeled as highlight clear.
- Recently used shows the last named text or background color applied in the
  current editor session. It is a convenience mirror of the palette choice, not
  document content, user settings, or a new persisted preference.
- A uniform selection identifies its active text and background swatches. A
  mixed selection identifies no single active swatch; choosing a color
  normalizes only that color attribute across the selection.

### Toolbar entry point

Add one compact `A` color control to `BubbleToolbar` in the existing inline
formatting group. Its expanded panel follows the observed Notion ordering:
Recently used, Text color, then Background color. Reuse the current shadcn
`Popover` pattern already used by the toolbar's text-style menu, Tabler
iconography, selection-preservation behavior, and focus restoration.
Opening the popover must not collapse the editor selection before the mark
command runs. Choosing a swatch applies immediately, closes the color panel,
and leaves the formatted text selected so the result and other toolbar commands
remain available.

No slash command, top-level document toolbar item, keyboard shortcut, raw-source
editor, Action, or agent-specific command is added in this slice. Agents already
edit the canonical NFM body through the ordinary document action surface; this
work does not add a parallel highlighting mutation API.

### Persistence and serialization

- Keep `notionSpan` as the one inline fidelity mark; do not introduce a TipTap
  Highlight extension or a second ProseMirror mark with overlapping meaning.
- Persist through the existing `VisualEditor` path:
  ProseMirror document -> `docToNfm` -> canonical document save, and
  NFM -> `nfmToDoc` -> ProseMirror document on load/reconciliation.
- Canonical NFM keeps the established single-attribute spellings: foreground is
  `<span color="<name>">…</span>` and background-only is `<span
color="<name>_bg">…</span>`. When both coexist, foreground remains in `color`
  and the background is added as `bg_color="<name>_bg"`.
- The result must remain stable across `docToNfm(nfmToDoc(value))` and through a
  real editor save/reload. Unsupported or malformed color values must not be
  coerced into a plausible supported highlight.
- Existing collaboration remains authoritative. Because the mark is document
  content, it travels in the same ProseMirror/Yjs updates and save reconciliation
  as bold, italic, links, and other inline marks.

### Interoperability with existing marks

- Coloring composes with bold, italic, strike, code, underline, and link.
  Applying, changing, or defaulting either color must not remove those marks.
- Link identity and destination survive coloring or defaulting a linked
  selection. The canonical serializer's existing nesting remains authoritative.
- Foreground and background attributes imported from Notion remain independent:
  changing or defaulting one preserves the other on the same span.
- Comment anchors and their decoration overlays remain independent. Applying a
  durable background within commented text must not create, resolve, move, or
  delete a comment. The UI must keep the comment's active/pending state legible
  when both visual layers overlap.
- Inline atom nodes, code blocks as block nodes, media, registry blocks, and
  locked/source components are not recolored by this command.

## Options considered

1. Add TipTap's Highlight extension. Rejected: Content already has a persistent
   inline background representation and serializer. A second mark would create
   two meanings and require a migration or normalization rule.
2. Reuse `CommentHighlight`. Rejected: it is intentionally a transient
   decoration derived from comment state and cannot represent canonical document
   formatting.
3. Add arbitrary color picking in the first slice. Deferred: it expands
   validation, accessibility, theme, and portability without matching the
   observed bounded Notion palette. Foreground named colors are included because
   Notion exposes them in the same `A` interaction and Content's existing mark
   already represents them.
4. Expose the existing `notionSpan.color` and `notionSpan.bgColor` attributes
   through one selection-toolbar control. Recommended: it matches the observed
   Notion interaction while remaining the thinnest path to durable canonical
   content.

## Product classification

- Lane: contract fulfillment / local UI exposure of existing substrate.
- Feature: `content.feature.durable-foundations`.
- Capability: `content.author.document-editor`.
- Existing promise: the visual editor preserves canonical document content
  through edits, reloads, collaboration, comments, authorized agent changes,
  and export.
- Record change: none expected. The feature fulfills the existing rich-document
  promise without changing Page, Blocks-field, Comment, or Action identity.

## Explicit non-goals

- Gradients, opacity, custom colors, eyedroppers, organization palettes, or
  theme authoring. A one-item Recently used presentation is in scope only to the
  extent required for Notion parity; persistent cross-document color history is
  not introduced without an existing local primitive.
- Whole-block background/color controls or changes to existing imported block
  colors.
- PDF/EPUB research annotations, annotation rails, source-revision anchors, or
  promotion between formatting and annotations.
- Comment highlighting behavior, anchor repair, comment color choice, or comment
  schema changes.
- Search-result, collaborator-presence, recent-edit, or temporary selection
  highlights.
- New database schema, migration, Action, API route, server contract, source
  adapter, Notion sync policy, shared toolkit abstraction, or provider work.
- A slash command, keyboard shortcut, mobile long-press redesign, or agent-only
  tool.
- Retrofitting arbitrary HTML/CSS colors or rewriting existing canonical NFM.
- Claiming the entire Document editor Capability or Durable foundations Feature
  complete.

## Architecture grounding and fit

Architecture grounding is **required and grounded** because the visible control
touches the editor's canonical serialization seam and must not accidentally
create a competing rich-text representation.

### Demonstrated caller and exact request

A signed-in Content writer selects text in a Page's visual document editor and
asks to give that exact selection a durable colored background, change it, or
clear it.

### Existing primitives

- `BubbleToolbar.tsx`: non-empty selection entry point; existing inline mark
  commands; selection-preserving shadcn popover behavior.
- `VisualEditor.tsx`: Content-specific editor extensions, collaboration, and the
  canonical persistence calls to `docToNfm`/`nfmToDoc`.
- `NotionSpanMark` in `NotionExtensions.tsx`: existing inline mark with
  `color`, `bgColor`, underline, link metadata, parsing, and rendering.
- `shared/nfm.ts`: canonical `_bg` token parsing and serialization for inline
  backgrounds.
- `CommentHighlight.ts`: explicit counterexample proving comment highlights are
  decorations, not persistent marks.
- `content.author.document-editor`: the accepted canonical-content and
  collaboration promise for the visual document surface.

### Ownership boundaries

- The bubble toolbar owns the human gesture and accessible color chooser.
- TipTap/ProseMirror owns selection and mark application.
- `notionSpan` owns inline foreground/background/underline fidelity.
- NFM owns canonical text serialization and parsing.
- `VisualEditor` plus the existing collaboration/save stack owns persistence,
  reconciliation, and reload.
- Comments continue to own anchor-backed annotation overlays separately.

### Legacy contracts that remain unchanged

- Bold, italic, strike, code, underline, link, comments, text-style conversion,
  selection fill, and excluded-node behavior.
- Existing foreground and block colors imported from Notion.
- Canonical NFM spelling and round-trip behavior.
- Collaboration, save/reconcile, Action parity, access, history, export, and
  source truth boundaries.

### Smallest compatible delta

Expose one combined palette command in `BubbleToolbar` that independently
updates or clears `notionSpan.color` and `notionSpan.bgColor` for the retained
non-empty text selection, add only the minimal theme-aware presentation and
session-local recent choice required for the existing named tokens, and prove
mark composition plus NFM and real save/reload behavior. No new persistent
document or settings primitive is warranted.

### Deferred capabilities and reversibility

Arbitrary palettes, block color UI, keyboard/slash entry, annotation workflows,
persisted color history, and shared editor generalization are deferred. The slice
is reversible because it is a bounded TypeScript/CSS/test exposure of an
existing mark and serialization contract, with no schema, data migration,
provider, or public protocol change.

### Evidence classification

Direct evidence:

- Alice's delegated title and stable Bowerbird ID.
- Current `BubbleToolbar` shows only for non-empty compatible selections and
  already applies inline marks.
- Current `NotionSpanMark` supports foreground `color` and `bgColor`, rendering
  both on the same inline mark.
- Current NFM serializer/parser encodes inline foreground colors and named `_bg`
  backgrounds.
- Current `CommentHighlight` states that comment ranges are decorations and do
  not enter document serialization.
- The product catalog places this work in
  `content.feature.durable-foundations` / `content.author.document-editor`.

Inference frozen by this shape:

- The task title's “colored text highlighting,” reconciled with Alice's Notion
  parity request, means Notion's combined named text/background color control,
  not research annotations.
- The nine existing Notion-compatible hue families plus Default are the intended
  first palette because they match the observed menu and already have canonical
  representation; exact theme mapping remains an implementation detail so long
  as token identity, contrast, and accessibility are preserved.

Unresolved product judgment:

- None that changes the first slice. Notion's palette, ordering, combined `A`
  entry point, toolbar composition, and selection retention are direct evidence.
  Apply/replace, mixed-state, Default, collapsed-caret, close/selection-retention,
  and keyboard behavior were not directly observable, so this shape freezes the
  explicit Content behavior above and does not claim exhaustive Notion parity.

## Risk strategy

Use `system-ready`, with no feature flag and no production-validation-after-
merge plan. This is a bounded, reversible editor-formatting exposure with no
schema or remote-provider mutation. Work may not call it complete until the
exact review artifact passes focused automated checks and the frozen real-
interface save/reload story. If the existing mark cannot preserve combined
attributes or public/export rendering requires a new representation, Work
returns to Shape rather than merging an unproved or parallel model.

## Successful-user story acceptance plan

Story `content-inline-color-v2`:

> A signed-in Content writer selects a phrase, uses one Notion-like `A` menu to
> apply and independently change or default its named text and background
> colors, combines them with ordinary inline formatting and a comment, then
> saves and reloads without losing colors, marks, link identity, comment state,
> or surrounding content.

Required assertions:

1. Selecting ordinary inline text opens the existing bubble toolbar and exposes
   one accessible `A` color control; a collapsed caret and an excluded
   atom/node do not expose or apply the command.
2. The panel presents Recently used, Text color, and Background color in the
   frozen order, with Default plus the same nine named hue families and an
   accessible name for every swatch.
3. Each named text or background color applies only to selected compatible text.
   Replacement and section-specific Default change only that attribute; the
   existing Clear format command remains broader.
4. The chooser retains the selection while open and after applying, identifies
   both active attributes for a uniform selection, and represents mixed color
   without falsely claiming one active swatch. Recently used reflects the last
   session-local named choice without adding persisted settings.
5. Bold, italic, strike, code, underline, link destination, and the color
   attribute not being changed survive apply, replace, and Default operations.
6. A selection spanning compatible text across ordinary blocks applies the mark
   to the text portions without recoloring excluded inline/block atoms or whole
   blocks.
7. Canonical NFM preserves existing named foreground and background-only
   spellings, and uses an additive `bg_color="<name>_bg"` attribute only when a
   foreground and background coexist; apply/change/default/combined-mark
   fixtures are stable through
   `docToNfm(nfmToDoc(value))`.
8. The ordinary collaborative editor update/save path persists both colors;
   reload reconstructs the same color attributes, text, and other marks without a
   serialization error, silent coercion, duplicate span, or lost content.
9. A comment overlapping colored text retains its anchor and active/pending
   behavior, remains visually legible, and is neither created nor resolved by
   highlight changes.
10. Existing bubble-toolbar link, comment, formatting, text-style, selection-fill,
    and excluded-node tests remain green; focused editor/NFM tests and typecheck,
    formatter, relevant guards, and `git diff --check` pass.
11. A current real-interface run on a task-owned local Content runtime and
    disposable Page built from the exact review artifact exercises selection,
    foreground/background apply, replace, Default, mixed-state, combined
    bold/link/comment formatting, save, and reload. The report states whether
    its evidence is independent or
    same-context.

Acceptance policy:

- Modality: `real-interface`, supported by focused automated tests.
- Independence: `preferred`.
- Custody: `same-context-allowed`.
- Interface: a fresh browser session against a task-owned local Content runtime
  and disposable Page built from the exact review artifact.
- Rationale: this is a reversible formatting interaction with no production
  data or destructive action. Independent evidence adds confidence when
  available, while same-context custody plus exact-artifact automation and
  save/reload proof is proportionate to the risk.

## Natural Work boundary

`/work` for this exact artifact may edit the smallest Content editor, style,
i18n, focused test, and user-facing changelog surfaces required to expose the
existing mark; provision and fully clean one declared task-local runtime,
database, account, and disposable Page; run focused automated and exact-artifact
real-interface acceptance; and prepare a review-ready pull request on the
current branch. Work stops before merge or deployment.

Any change to selected-text color meaning, palette class, collapsed-caret
semantics, shipping surface, canonical representation, acceptance story, or
risk strategy invalidates implementation authority and returns to Shape.

## Work evidence ledger

- Exact implementation revision: working tree based on
  `3132ab1bd8206dabd0b5cff92a0f5c5bb56bd4e8`, ledger
  `content-inline-color-work-v1-approved-dual-color`.
- Automated proof: 173 focused editor/NFM tests passed; Content typecheck exited
  0; all 55 repository guards passed; all 30 Content product-impact tests passed.
- Successful-user-story proof: real Chromium created a disposable Content Page,
  selected text, used the rendered floating toolbar, and restored bold, red text,
  and yellow background after reload. SQLite read-back showed `<span
color="red" bg_color="yellow_bg">**Highlighted text**</span> keeps bold and
both colors.`
- Test-resource custody: `content-color-local-acceptance-69a7e1cf` was created,
  exercised, and cleaned; the declared path and port were independently absent
  afterward.
- Independent technical review: Cartographer, Terra Explorer, exact manifest
  above, triggered by canonical persistence/serialization risk. Initial finding:
  one P2 stale-contract ambiguity in this artifact; follow-up count 1. Final
  disposition: finding resolved, no blocking implementation or artifact finding.
- Repository review repair: Builder's exact-head review found that an atom-only
  selection exposed an inert color control. The control now appears only when
  the selection contains compatible text, with a focused regression test. Its
  incremental review then found the same inert state for fenced code-block text,
  whose parent schema rejects marks. The predicate now checks whether the text's
  parent permits `notionSpan`, with a focused code-block regression test. The
  following review found active swatch state also counted unmarkable code text;
  state resolution now uses the same parent-mark eligibility boundary, with a
  mixed paragraph/code-block regression test. The next review found that the
  mutation callback still relied on the schema to reject unmarkable text; it now
  applies the same explicit eligibility predicate, with a mixed-selection write
  regression test. A new exact-head repository review and CI run are required
  after push.
- Changelog: the template's `agent-native changelog add` command reported that
  changelog capture is disabled, so no manual entry was created.

## Lifecycle authority envelope

```yaml
authoritySchemaVersion: 3
stage: land
authority-source: Alice approved option 3 and invoked $work on 2026-08-18, then invoked $land on 2026-08-19 with an explicit do-not-merge constraint; Land returned internally to the matching Work envelope for review and CI repair.
authorized-scope:
  repositories:
    - BuilderIO/agent-native
  product-surfaces:
    - Content visual document editor inline formatting
  outcome: Freeze a Notion-like combined named text and background color interaction for selected text in Content's visual document editor.
allowed-mutations:
  - artifact-write
  - branch
  - commit
  - push
  - pull-request
  - ephemeral-test-resource
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-08-18-colored-text-highlighting-shape.md
test-resources:
  - id: content-color-local-acceptance-69a7e1cf
    kind: database
    surface: Local Content runtime on 127.0.0.1:4179 backed only by /tmp/codex-content-color-69a7e1cf/content.db
    ownership-marker: codex-content-color-69a7e1cf
    baseline: /tmp/codex-content-color-69a7e1cf was absent and TCP port 4179 had no listener at 2026-08-18T18:54:43Z
    allowed-actions:
      - create
      - update
      - exercise
      - delete
    cleanup-trigger: after exact-artifact real-interface acceptance
    cleanup-method: Stop the task-owned server process then remove only /tmp/codex-content-color-69a7e1cf and verify the path and port are absent.
    cleanup-proof: At 2026-08-18T19:06:57Z an independent check found /tmp/codex-content-color-69a7e1cf absent and no TCP listener on port 4179.
    shared-impact: none
    isolation: local-runtime
    ownership: task-created
    production-data: false
    customer-data: false
    cost: none
    boundary-evidence:
      - explicit absent path check at 2026-08-18T18:54:43Z
      - explicit no-listener check for 127.0.0.1:4179 at 2026-08-18T18:54:43Z
      - Chromium created a disposable Page through the rendered Content UI, selected text, applied bold plus red text and yellow background through the floating toolbar, and restored all three after reload.
      - the persisted documents.content value was <span color="red" bg_color="yellow_bg">**Highlighted text**</span> keeps bold and both colors.
      - explicit absent path and no-listener checks passed at 2026-08-18T19:06:57Z
    max-lifetime-minutes: 240
    declared-at: 2026-08-18T18:54:43Z
    expires-at: 2026-08-18T22:54:43Z
    status: cleaned
    phase: work
governing-artifact:
  path: templates/content/docs/solutions/2026-08-18-colored-text-highlighting-shape.md
  revision: work-v1-approved-dual-color
architecture-fingerprint:
  outcome: Match Notion's combined selected-text color interaction while persisting named foreground and background colors through Content's existing notionSpan mark.
  shipping-surfaces:
    - id: content-inline-color
      repository: BuilderIO/agent-native
      product-surface: Content visual document editor selection bubble toolbar and canonical rich-text body
      constituency: signed-in Content writers
      durable-destination: public Content template editor behavior in BuilderIO/agent-native
      integration-action: merge
  governing-architecture: The selection bubble toolbar independently updates the existing notionSpan.color and notionSpan.bgColor attributes; NFM preserves established one-color spellings and additively serializes an explicit background attribute when both colors coexist; ProseMirror selection and VisualEditor collaboration/save remain the sole owners of document formatting and durability, with no parallel mark or persisted recent-color setting.
  acceptance-story:
    id: content-inline-color-v2
    summary: A signed-in writer uses one Notion-like A menu to independently apply change and default named text and background colors on selected text then saves and reloads without losing other marks canonical content or independent comment state.
    required-assertions:
      - non-empty compatible text selection exposes one accessible A color control while collapsed and excluded selections do not
      - panel order is Recently used then Text color then Background color with Default plus nine named hue families in both palettes
      - each named text or background color applies only to selected compatible text and replacement or section Default changes only that attribute
      - selection is retained while open and after apply and uniform versus mixed color state is represented truthfully
      - Recently used is session-local and adds no persisted setting
      - existing inline marks link identity and the unchanged color attribute survive apply replace and Default
      - cross-block compatible text works without recoloring excluded atoms or whole blocks
      - canonical NFM uses existing named foreground and _bg span serialization and round-trips stably
      - established foreground-only and background-only NFM fixtures remain stable while a dual-color fixture round-trips both attributes without silent loss
      - collaborative save and reload preserve both color attributes text other marks and content without silent failure
      - overlapping comment anchors and states remain independent and legible
      - focused regressions existing toolbar tests typecheck formatter relevant guards and diff check pass
      - exact-review-artifact real-interface selection panel order apply replace Default mixed state combination save and reload pass on a disposable local Page
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Fresh browser session against a task-owned local Content runtime and disposable Page built from the exact review artifact.
      rationale: Reversible editor formatting needs current interaction and durability proof; independent evidence is useful but same-context custody is proportionate when exact-artifact automated and save-reload evidence also pass.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: The UI gesture touches the canonical rich-text mark and NFM serialization seam, so Shape must prove it reuses rather than duplicates the existing representation.
  status: grounded
  demonstrated-callers:
    - A signed-in Content writer selects inline text and asks for Notion's combined named text and background color interaction.
  existing-primitives:
    - BubbleToolbar non-empty compatible selection entry point and inline mark commands
    - NotionSpanMark color bgColor underline parse and render contract
    - NFM named _bg inline serialization and parsing
    - VisualEditor canonical collaboration save and reload path
    - CommentHighlight transient decoration boundary
  ownership-boundaries:
    - BubbleToolbar owns the accessible human gesture
    - TipTap and ProseMirror own selection and mark operations
    - notionSpan owns inline color background and underline fidelity
    - NFM owns canonical serialization and parsing
    - VisualEditor and the collaboration stack own persistence and reconciliation
    - Comments own anchor-backed overlays independently
  legacy-contracts:
    - existing inline marks links comments text styles selection fill and excluded-node behavior
    - imported foreground and block colors
    - canonical NFM spelling collaboration save Action access history export and source-truth boundaries
  shared-vocabulary:
    - color means the combined selected-text foreground and background interaction in this slice
    - highlight means the background-color half of that interaction
    - comment highlight means a transient SQL-anchor-derived decoration and remains separate
    - named color means Default or one of the nine observed Notion-compatible hue families
  smallest-compatible-delta: Expose independent apply replace and Default operations for existing notionSpan.color and notionSpan.bgColor in BubbleToolbar, add the observed accessible combined panel plus session-local recent choice, extend NFM additively only for simultaneous colors, and prove backward compatibility plus canonical save and reload.
  deferred-capabilities:
    - arbitrary custom or organization palettes
    - collapsed-caret stored-mark behavior
    - block color controls
    - keyboard and slash command entry
    - research annotation workflows
    - shared editor toolkit generalization
  reversibility: Bounded TypeScript CSS i18n changelog and test changes over an existing mark with no schema migration provider public protocol or data rewrite.
  direct-evidence:
    - Alice delegated title and Bowerbird ID in source thread 01a00f83-f02d-7b42-9a31-ff18c5a5eded
    - current BubbleToolbar VisualEditor NotionSpanMark NFM and CommentHighlight source
    - content.feature.durable-foundations and content.author.document-editor product records
    - logged-in Notion desktop selection toolbar and combined A panel on disposable page 3c0ccf6483ce808b8198d1a8ba36e519
  inferences:
    - unobserved swatch transitions should follow the frozen immediate apply independent replacement section Default mixed-state and non-collapsed selection semantics
    - Recently used should be session-local because no existing persistent preference primitive is needed for the demonstrated caller
  unresolved-owner-questions: []
delegation-ceiling:
  - artifact-write
product-boundary-gates:
  agent-native-public-constituency: Any signed-in Content writer can use this public template behavior without Alice's vault machines credentials or private orchestration; it belongs in the public repository because it exposes an existing canonical public editor representation.
  bowerbird-product-boundary: Bowerbird supplies only the durable private task identity for this Shape. The shipping product behavior is Content; the feature adds no Bowerbird deterministic state validation agent process retry deployment or scheduling policy.
acceptance-state:
  status: pending
  summary: The accepted behavior and same-context real-interface story remain satisfied, but exact-head repository review and CI are pending after the inert-control repairs; merge is explicitly prohibited in this Land invocation.
  blockers:
    - exact-head repository review pending after repair
    - exact-head CI pending after repair
    - merge explicitly prohibited by Alice for this Land invocation
  last-land-packet: null
material-change:
  banner: resolved by Alice approval of option 3 on 2026-08-18
  changed-fields:
    - governing architecture
    - acceptance story
  old-fingerprint: Existing notionSpan exposure with unchanged NFM serialization and simultaneous foreground/background durability.
  proposed-fingerprint: Existing notionSpan exposure plus backward-compatible dual-color NFM serialization and compatibility assertions.
  replacement-acceptance-story: approved; additive dual-color NFM compatibility assertions are frozen.
task-attention: autonomous
ledger-revision: content-inline-color-work-v1-approved-dual-color
status: active
```

## Exact handoff

Work is active for the approved option 3 replacement fingerprint. Terminal
integration remains `/land` after Work produces complete exact-artifact
evidence.
