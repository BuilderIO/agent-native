# Ordinary Code Block surface contrast

## Decision

Give ordinary native Code Blocks a quiet semantic surface that is visibly
distinct from the Page canvas in both light and dark themes. Reuse Content's
existing `--muted` theme token and restore the existing six-pixel radius and
block spacing directly on `pre.notion-code-block`.

This is a separate local refinement from the code-block insertion regression.
It must not delay, rewrite, or expand that repair, which remains committed at
`fbe8c9c9060944e3514fd1f2b1a43edc88115199` and land-ready.

## Current truth

Direct source evidence:

- The Page canvas uses `--background`: white in light mode and 13% lightness in
  dark mode.
- Content already defines `--muted`: 96% lightness in light mode and 16% in
  dark mode.
- `.notion-code-block-wrapper` uses `background: hsl(var(--muted))`, a six-pixel
  radius, and `0.6em` vertical margins.
- Ordinary Code Blocks now use Tiptap's native DOM renderer and carry the class
  `notion-code-block`; they do not render the old wrapper.
- The shared `pre` rule explicitly gives `.notion-code-block` a transparent
  background, zero radius, and zero margin. It therefore visually collapses
  into the Page canvas.

Inference: the missing contrast is a styling seam left behind when ordinary
Code Blocks moved from the former wrapper/node view to Tiptap's native renderer.
No new Code Block product contract or color system is required.

## Scope

Owned outcome: an ordinary native Code Block reads as a contained code surface
against the surrounding Page in light and dark themes while preserving current
source editing, syntax highlighting, selection, keyboard behavior, and
persistence.

Explicit exclusions:

- language controls, headers, tabs, execution, output, or other Code Block UX;
- Mermaid or registry-backed Code blocks;
- slash-command catalog or insertion behavior;
- syntax-highlight token redesign;
- Page, card, popover, sidebar, or global theme palette changes;
- image insertion or media styling.

## Smallest compatible repair

Keep the shared typography and overflow rule. Add a native-block-specific rule
after it that applies:

- `background: hsl(var(--muted))`;
- `border-radius: 6px`;
- `margin: 0.6em 0`.

Do not add raw light/dark colors or a new token. The existing semantic token
already expresses the intended quiet secondary surface and automatically
tracks both themes.

## Successful-user-story acceptance plan

Use the current task-owned local Content runtime or an equivalent disposable
runtime built from the exact Work artifact.

1. Open an ordinary Page in light mode and insert a native Code Block.
2. Confirm the block has a subtle non-white surface distinct from the Page,
   with visible rounded bounds and normal vertical separation.
3. Type representative plain and highlighted code; confirm text contrast,
   syntax colors, caret, selection, horizontal overflow, and Tab remain usable.
4. Switch to dark mode and confirm the same block has a subtle non-black/dark
   canvas distinction without becoming a high-contrast black panel.
5. Reload and confirm the Code Block source persists and the themed surface
   returns.
6. Confirm an ordinary paragraph, inline code, registry `Code`, and Mermaid
   presentation are unchanged.
7. Run formatter, Content typecheck, and the focused editor/style tests on the
   exact review artifact.

Acceptance is human-facing and visual, so it uses a real interface with
preferred independence and same-context custody. Independent technical review
is not required for this bounded CSS-only refinement.

## Lifecycle envelope

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: "Alice: While at it, we should give the code block background a background that's different than the white of the page and the black of the page. $shape"
authorized-scope:
  repositories:
    - BuilderIO/agent-native
  product-surfaces:
    - Content ordinary native Code Block presentation
  outcome: Give ordinary native Code Blocks a subtle theme-aware surface distinct from the Page canvas.
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-08-20-code-block-surface-background-shape.md
  prototype-sandboxes: []
test-resources: []
governing-artifact:
  path: templates/content/docs/solutions/2026-08-20-code-block-surface-background-shape.md
  revision: content-code-block-surface-shape-v1
architecture-fingerprint:
  outcome: Give ordinary native Code Blocks a subtle theme-aware surface distinct from the Page canvas.
  shipping-surfaces:
    - id: content-native-code-block-surface
      repository: BuilderIO/agent-native
      product-surface: Content visual Page editor ordinary native Code Block presentation
      constituency: signed-in Content writers and readers
      durable-destination: public Content template behavior in BuilderIO/agent-native
      integration-action: merge
  governing-architecture: Style the existing native Tiptap Code Block through Content's existing semantic theme tokens without adding a renderer, wrapper, block type, or palette.
  acceptance-story:
    id: content-native-code-block-surface-v1
    summary: A writer sees the same ordinary Code Block as a quiet contained surface distinct from the Page in light and dark themes, with editing and persistence unchanged.
    required-assertions:
      - light mode Code Block surface is visibly distinct from the white Page canvas
      - dark mode Code Block surface is visibly distinct from the dark Page canvas without becoming a black panel
      - existing code text syntax highlighting caret selection overflow and Tab remain usable
      - reload preserves source and restores the same theme-aware presentation
      - paragraphs inline code registry Code Mermaid insertion and persistence behavior remain unchanged
      - focused technical checks and exact-artifact real-interface acceptance pass
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: Disposable local Content Page built from the exact review artifact, exercised in light and dark themes.
      rationale: The outcome is a bounded visual refinement whose success depends on rendered contrast in both themes; same-context real-interface judgment is proportionate.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: not-required
  reason: Bounded local CSS refinement using an existing Content-owned class and existing semantic theme token; no shared contract, schema, renderer, identity, or persistence boundary changes.
  status: grounded
  demonstrated-callers:
    - Signed-in Content writer or reader viewing an ordinary native Code Block in a Page.
  existing-primitives:
    - pre.notion-code-block from CodeBlockNode.tsx
    - --background and --muted theme tokens in app/global.css
    - existing wrapper radius and spacing treatment
  ownership-boundaries:
    - Content global editor CSS owns ordinary Code Block presentation
    - Tiptap owns native Code Block structure and editing behavior
    - Content theme tokens own light and dark surface values
  legacy-contracts:
    - portable fenced-code source and Lowlight syntax highlighting
    - ordinary editor keyboard and persistence behavior
    - registry Code Mermaid inline code and unrelated Page surfaces
  shared-vocabulary:
    - ordinary native Code Block means Tiptap codeBlock rendered as pre.notion-code-block
  smallest-compatible-delta: Add one native-block-specific semantic background radius and margin rule after the shared pre typography rule.
  deferred-capabilities:
    - executable Code Block UX
    - language headers and controls
    - syntax palette redesign
    - registry and Mermaid presentation
  reversibility: One local CSS rule using existing tokens; removal restores the prior presentation with no data migration.
  direct-evidence:
    - repository revision fbe8c9c9060944e3514fd1f2b1a43edc88115199
    - CodeBlockNode.tsx assigns notion-code-block to the native renderer
    - global.css gives the old wrapper muted background but the native block transparent background
  inferences:
    - the contrast regression followed removal of the former React wrapper from the native renderer
  unresolved-owner-questions: []
delegation-ceiling:
  - artifact-write
product-boundary-gates:
  agent-native-public-constituency: Any source-blind Content writer or reader benefits without Alice-private data credentials or orchestration; this belongs in the public Content template.
  bowerbird-product-boundary: not-applicable
acceptance-state:
  status: land-ready
  summary: Work added the bounded semantic CSS rule and passed light/dark real-interface acceptance without changing adjacent Code Block behavior.
  blockers: []
  last-land-packet: null
ledger-revision: content-code-block-surface-shape-v1
status: work-complete
```

## Exact handoff

`/work templates/content/docs/solutions/2026-08-20-code-block-surface-background-shape.md`

Execution placement: local. The expected Work is one CSS rule, focused checks,
and light/dark browser acceptance; framework compute is unnecessary. The
currently running local server and Page remain available for Alice's manual
testing and were not mutated or stopped by Shape.

## Work execution record

Work lane: `codex/code-block-surface-background` in
`/Users/alicemoore/.codex/worktrees/content-code-block-surface-background`,
refreshed from `origin/main` at
`8617890c4b9688ebcca5075efb74774f7ac39918` on 2026-08-20.

Acceptance reconciliation: consistent. Schema v3 freezes real-interface
acceptance, preferred independence, and same-context custody.

Work mutations are bounded to the CSS refinement, focused tests, this evidence
artifact, a local commit, and the following disposable test resource:

- resource id: `content-codeblock-surface-work-20260820`
- kind: local server, SQLite database, browser session, and task-created Page
- surface: `http://127.0.0.1:4189` backed by
  `/tmp/content-codeblock-surface-work-20260820/content.db`
- ownership marker: Page title `Code Block Surface Acceptance 2026-08-20`
- baseline: port 4189 unbound and sandbox path absent before creation
- allowed actions: create, update, exercise, read back, reload, and delete
- cleanup trigger: after light/dark acceptance and evidence capture
- cleanup method: close the task browser tab, stop the server, confirm port
  4189 unbound, and move the exact sandbox to Trash
- cleanup proof: independent port and original-path absence checks
- shared impact: none
- isolation: local runtime
- ownership: task-created and task-exclusive
- production data: false
- customer data: false
- cost: none
- maximum lifetime: 240 minutes
- status: declared

## Work evidence

Implementation:

- added one `.notion-editor .notion-code-block` rule using `hsl(var(--muted))`,
  the existing 6px radius, and the existing `0.6em` vertical rhythm
- did not change the renderer, command transaction, persistence, registry Code,
  Mermaid, inline code, syntax palette, or slash-command catalog

Exact real-interface acceptance on the task-created Content Page:

- light theme: block `rgb(245, 245, 245)` against Page
  `rgb(255, 255, 255)`; text `rgb(38, 38, 38)`
- dark theme: block `rgb(41, 41, 41)` against Page `rgb(33, 33, 33)`;
  text `rgb(230, 230, 230)`
- both themes: `6px` radius and `8.16px` top/bottom computed margins
- the persisted fenced source rendered through `pre.notion-code-block` as
  `const greeting = "hello";// `

Technical checks:

- `oxfmt` passed for the modified CSS and this artifact
- `git diff --check` passed
- focused editor suite passed: 31/31 tests in
  `SlashCommandMenu.test.ts`
- repository typecheck exited 0; it also printed the expected local-production
  warnings for absent `BETTER_AUTH_SECRET` and persistent database URL
- changelog command was attempted and reported that changelogs are disabled in
  the Content app configuration; no changelog file was created

Framework compute preflight could not reach the configured framework host
(Tailscale stopped and the host did not resolve), so the proportionate checks
ran locally on the actual execution host. This visual-only delta does not rely
on remote-host behavior.

Cleanup completed: the task browser tab was closed, the port-4189 server was
stopped, port 4189 was confirmed unbound, the original sandbox path was
confirmed absent, and the exact sandbox was moved to
`/Users/alicemoore/.Trash/content-codeblock-surface-work-20260820`. The fixture
is recoverable from Trash. The separate port-4188 insertion-test server and its
fixture were not touched.

Acceptance result: successful-user-story schema v3 is satisfied in the same
context allowed by the frozen custody policy. Independent human review remains
preferred but is not a completion gate for this bounded visual refinement.

ledger-revision: content-code-block-surface-work-v1
