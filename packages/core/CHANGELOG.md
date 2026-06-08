# @agent-native/core

## 0.40.2

### Patch Changes

- 8ea7f6d: Remove the annotated-code dev-doc block from Plans/Content (block source,
  client/server registries, schema, slash menu, and skill guidance).

## 0.40.1

### Patch Changes

- 38dff5b: Fix production 502s on SSR apps (docs, slides, content, assets) caused by the
  browser-only Excalidraw/Mermaid renderers leaking into the Nitro server bundle.
  Nitro re-bundles the server from node_modules and Rolldown merged
  `@excalidraw/excalidraw` into a shared vendor chunk that the SSR render path
  (tiptap, radix-ui, recharts) imported statically, so its top-level `window`
  access ran at function cold-start and crashed every request with
  `ReferenceError: window is not defined`. The Vite SSR build already stubbed these
  libs for `build/server`, but that plugin didn't run during Nitro's separate
  bundle. The deploy build now mirrors the same stub as a Rolldown plugin, replacing
  `@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, and `mermaid` with
  an inert proxy in the server bundle (they only ever render client-side).

## 0.40.0

### Minor Changes

- 2ce5471: Add a reusable `columns` container block for side-by-side (before/after) layouts in visual plans.
- 2ce5471: Promote `/visual-recap` into the Agent-Native Plans skill bundle with CLI
  installer aliases and synced skill copies.

### Patch Changes

- 2ce5471: Scope block edit hover to the directly hovered block and keep generated API reference blocks in a single-column document flow.
- 2ce5471: Expose block metadata to host edit popover renderers so apps can provide
  contextual block-level AI edit actions.
- 2ce5471: Harden shared block renderers against malformed legacy JSON edits, oversized diff inputs, and JsonExplorer expand-state updates.
- 2ce5471: Bound the Neon pooled-connection acquire with a timeout, not just the query. A cold or exhausted Neon pooler can stall on `pool.connect()`, which happens before the query-level `withDbTimeout` can fire — so authenticated requests (which run a session/org lookup on every navigation via `getSession` → `backfillSessionOrg`) hung until the platform killed the function, surfacing as "the app won't load" with lists, org switcher, and team pages stuck loading. The acquire now races the same `DB_OP_TIMEOUT_MS` budget and degrades into a retryable `CONNECT_TIMEOUT`, releasing the connection if it resolves after the timeout so the pool slot isn't leaked.
- 2ce5471: Improve visual plan canvas source formatting guidance and document targeted diagram HTML patching.
- 2ce5471: Highlight code-tab block editors while preserving textarea editing, and infer
  syntax languages from file-like tab labels such as `content.ts`.
- 2ce5471: Limit diff blocks to 15 visible lines by default with a slimmer inline expand
  control, quieter file metadata, and hover-revealed layout controls.
- 2ce5471: Compact single-child folder chains in FileTree blocks, cap the default visible tree rows, and use muted folder icons.
- 2ce5471: Use standard UI label typography for FileTree block paths instead of monospace file text.
- 2ce5471: Fix `zodDefToJsonSchema` to handle Zod v4 `"pipe"` type produced by `z.preprocess()`, `.superRefine()`, and `.transform()`. Previously these fell through to the `{ type: "string" }` fallback, causing action parameters whose schemas use `z.preprocess` (such as `content` in `create-visual-plan`) to be registered as strings in the MCP tool schema. Claude Code and other MCP clients would then JSON-encode object values as strings before sending, breaking validation.
- 2ce5471: Keep shared block tab rails on one horizontally scrollable row when many tabs are present.
- 2ce5471: Improve registry block editing with panel artifacts, inline table editing,
  container edit surfaces, and a drag-handle block action menu.
- 2ce5471: Default JSON explorer blocks to two auto-expanded container levels and add auto-expand presets to the edit popover.
- 2ce5471: Fix Mermaid block runtime loading so Vite rewrites the browser-only Mermaid and
  Excalidraw imports instead of leaving unresolved bare module specifiers in the
  browser.
- 2ce5471: Single-source the shared plan-skill cores (wireframe/canvas/document/exemplar) and share one wireframe-quality core across /visual-plan, /ui-plan, and /visual-recap. The wireframe-quality bar is now identical for forward plans and recaps, and the before/after layout rule is stated once (pick columns vs. vertical stack by geometry), removing the prior /visual-recap contradiction.
- 2ce5471: Keep the full structured block library discoverable in Plans and Content slash
  menus outside Notion-sync mode, including Mermaid, Swagger-style endpoints,
  OpenAPI specs, schema/data models, diffs, file trees, JSON explorers, and
  annotated code. Also let shareable resources normalize access context so local
  Plan ownership stays consistent across generic sharing actions.
- 2ce5471: Polish structured block slash menus with compact descriptions, hidden search
  keywords, one-line ellipsized rows, and keyboard navigation that keeps the active
  item visible while scrolling.
- 2ce5471: Soften the active tab background for shared tabs blocks.
- 2ce5471: Reduce table editing chrome by scoping row and column remove controls to the
  hovered row or header, remove the footer padding control, and edit table text
  through inline rich-markdown cells.
- 2ce5471: Add an optional vertical orientation for the reusable tabs block.
- 2ce5471: Stop generated visual recap plans from adding boilerplate disclaimer and provenance prose blocks.
- 2ce5471: Clarify that visual recaps for UI changes should include wireframes, with before/after used when it helps review the change.

## 0.39.2

### Patch Changes

- fa107db: Clarify generated app guidance so normal app data is action-first, and keep shared framework skills synchronized across generated workspaces and first-party templates.
- fa107db: Fix deploy-time action route discovery so worker/edge builds mount actions with their declared HTTP method and `http.path`.

  The deploy scan previously detected only `method: "GET"` via a plain source-text `includes`, so actions declaring `PUT`/`PATCH`/`DELETE`/`OPTIONS` were silently registered as `POST` (`app.on("POST", …)`) in deployed builds — a method mismatch against the client's actual request that 404s on edge/worker hosts (affected `calendar`'s `update-external-calendars`/`update-overlay-people` PUTs and `brain`'s `delete-source` DELETE). The same naive scan could also be tripped by an unrelated `method: "GET"` elsewhere in the file (e.g. a `fetch(…, { method: "GET" })` in the action body), and it dropped `http.path` entirely.

  Discovery now parses the `http` config block specifically (all verbs, `http.path`, whitespace-tolerant `http: false`), and the generated worker mounts each action at `${prefix}/${http.path ?? name}` — matching the runtime mount in `action-routes.ts`.

- fa107db: Guide architecture and code visual plans toward flexible inline HTML/SVG
  document diagrams instead of top-level UI canvases, custom HTML escapes, or
  default linear node flows.
- fa107db: Expose auth provider profile images on client sessions and seed Google profile pictures into the shared avatar store.
- fa107db: Fold existing-plan import guidance into `/visual-plan` and stop distributing the separate `/visualize-plan` skill.

## 0.39.1

### Patch Changes

- 24a3a14: Add `/plan-design` to the built-in Plans skill bundle and CLI aliases.

## 0.39.0

### Minor Changes

- d82d5f7: Add a "panel" edit surface for config-driven blocks. A block spec can set
  `editSurface: "panel"` (the default when it ships no custom `Edit`) to render its
  `Read` view with a hover corner edit button that opens its editor — the custom
  `Edit` or the schema-driven auto-form — in an app-provided panel
  (`ctx.renderEditSurface`, e.g. a popover), instead of always-inline fields.
  Direct-manipulation blocks (prose, checklist, table, tabs) stay inline. The core
  `custom-html` block opts into the panel.

  Also completes the schema auto-editor (`SchemaBlockEditor`): array fields now
  render as add/remove repeating rows (object elements → nested field groups,
  scalar elements → per-item inputs) and object fields render as nested fieldsets,
  instead of falling back to a "needs custom Edit" hint.

- d82d5f7: Move the eight "dev-doc" structured blocks into the core block library so any app can register them, mirroring how `checklist` / `code-tabs` / `html` / `table` / `tabs` already live in core.
  - **New shared blocks** — `mermaid` (hand-drawn Mermaid diagram), `api-endpoint` (Swagger / Stripe-style endpoint reference), `openapi-spec` (whole-document OpenAPI / Swagger reference), `data-model` (interactive dbdiagram-style ERD), `diff` (GitHub-style before/after with unified + split views), `file-tree` (VS Code / GitHub explorer with change badges), `json-explorer` (collapsible devtools JSON tree), and `annotated-code` (Stripe-docs "explain this code" walkthrough). Their React-free schema + MDX round-trip config export from `@agent-native/core/blocks/server`; their `Read` / `Edit` React renderers export from `@agent-native/core/blocks`.
  - **App-agnostic** — the renderers no longer depend on a host app's shadcn/ui components or `next-themes`. Form controls use minimal inline primitives styled with the same Tailwind tokens, dark mode is detected from the document root's `.dark` class, and the diff line-differ is inlined so core carries no extra runtime dependency. Rendered output (dark/light, collapse, FK-highlight interactivity, panel editing) is unchanged.

- d82d5f7: Export shared registry-block Tiptap node utilities so app editors can render registered block specs through a common NodeView, side-map provider, and duplicate-id reminting plugin.
- d82d5f7: Add single-document editor primitives to the shared rich-markdown editor so the
  plan app can render its whole document as one editable Notion-style ProseMirror
  doc (custom blocks as inline NodeViews) while keeping its `blocks[]` format:
  `gfmToProseJSON`/`proseJSONToGfm` (GFM↔ProseMirror via a headless editor), a
  `RunId` extension (stable per-block prose ids), the shared `DragHandle` extension
  (block grip + drag-reorder, moved from the content app and parameterized via
  `wrapperSelector`), and serializer-injection props on `SharedRichEditor`
  (`getMarkdown`/`setContent`/`normalizeValue`/`shouldSeed`/`wrapperClassName`).

  The `DragHandle` grip now attaches lazily on first hover (re-homing to the
  wrapper once it exists) instead of only at plugin init, so the grip reliably
  appears even when the editor DOM mounts into its wrapper after the ProseMirror
  view is constructed (the React mount order in `SharedRichEditor`).

### Patch Changes

- d82d5f7: Expose shared library block spec registration for template editors.
- d82d5f7: Add a `notionCompatible` block-spec flag and registry helper so apps can derive Notion-sync block allowlists from registered block metadata.
- d82d5f7: Add a shared registry-block slash-command builder for template editors.
- d82d5f7: Fix rich-text editing data loss in the shared collab reconcile. The reconcile now
  remembers a small bounded ring of recent local emissions, so a stale-but-recent
  poll echo — e.g. a debounced autosave that persisted only a partial burst, then
  re-supplied by the next poll with a newer timestamp — can no longer clobber the
  freshly-typed tail. Previously only the single latest emission was recognized as
  an echo, so the trailing characters typed during the save→poll window were
  reverted. External (agent/peer) edits never byte-match a local emission, so
  agent resync is unaffected.
- d82d5f7: Make the unified editor's block library "add a block in ONE place" by sharing the two pieces that were still duplicated between the plan and content editors.
  - **`buildRegistryBlockSlashItems(registry, options)`** (exported from `@agent-native/core/client`) — the shared builder for the registry-derived block slash commands both editors offer. It owns the `registry.list("block")` source, the Notion-compatibility filter, and the one-item-per-spec mapping; each app injects only the parts that legitimately differ (its item shape, its Notion-compat predicate, and how it inserts the block node). Plan's `buildPlanSlashCommands` and content's `buildRegistrySlashItems` are now thin adapters over it.
  - **`registerLibraryBlocks(registry, { overrides? })` + `libraryBlockSpecs`** (from `@agent-native/core/blocks`) — register the whole standard browser library (checklist, table, code-tabs, html, tabs + the eight dev-doc blocks: mermaid, api-endpoint, openapi-spec, data-model, diff, file-tree, json-explorer, annotated-code) in one call. Apps register it, then add only their app-specific blocks on top, passing small per-block `overrides` (e.g. content re-types `table` → `table-block`).
  - **`registerLibraryBlockConfigs(registry, { overrides? })` + `libraryBlockConfigs`** (from `@agent-native/core/blocks/server`) — the React-free twin for server / shared registries, registering the same library as `Read: () => null` config stubs so the agent schema export and MDX round-trip share one source too.

  Adding a 14th standard library block now means editing one core list instead of four app files. The set of registered blocks and the Notion-gating behavior in each app are unchanged.

- d82d5f7: Update bundled Visual Plans skill guidance to use bottom Open Questions form blocks.

## 0.38.0

### Minor Changes

- 5f51768: Give actions and skills tighter control over what the agent sees, and make the clarifying-question UI a first-class building block.
  - **`agentTool: false` on `defineAction`** — expose an action to the frontend / HTTP (`useActionMutation`, `callAction`, `/_agent-native/actions/<name>`) while hiding it from every agent tool surface (in-app assistant, MCP, A2A, job/trigger runners). Frontend/programmatic actions no longer have to spend a slot in the model's tool list. Distinct from `toolCallable`, which only governs the sandboxed extension iframe bridge.
  - **`ask-question` / `askUserQuestion()`** — the built-in clarifying-question tool now accepts a short `header` chip and per-option `preview` content, aligning with Claude Code's `AskUserQuestion`. A new `askUserQuestion()` client helper (exported from `@agent-native/core/client`) lets app code raise the same inline multiple-choice prompt and `await` the user's selected value(s) — so the UI can gate an action on one quick decision. Documented in `client.md` and the `client-methods` skill.
  - **Skill scoping** — SKILL.md frontmatter now supports `scope: runtime | dev | both` (default `both`). The runtime agent excludes `scope: dev` skills from both the system-prompt skills block and `docs-search`, so development-only skills stay invisible to the running app's agent.
  - **Action-surface guidance + advisory audit** — the `actions` skill and docs now teach keeping the action surface small and orthogonal (prefer one CRUD `update` over per-field actions; reach for the generic query/escape-hatch actions instead of minting read actions). Added `pnpm actions:audit`, an advisory scanner that flags likely UI-dead mutating actions and redundant action clusters (never fails CI).
  - **`run(args, ctx)` context** — an action's `run` now receives an optional second argument with the resolved request identity (`userEmail`, `orgId`) and the invocation source (`caller`: `"tool" | "http" | "frontend" | "cli" | "mcp" | "a2a"`), wired at every dispatch site. Read `ctx.userEmail` / `ctx.caller` instead of calling `getRequestUserEmail()` by hand. Backward compatible (1-arg `run(args)` still valid); `userEmail` is never defaulted to a dev identity.
  - **Client-side `track()`** — analytics tracking now works from the browser. A new `track()` client helper (exported from `@agent-native/core/client`) POSTs to `/_agent-native/track`, which forwards the event to the same registered server-side providers (PostHog/Mixpanel/etc) with server-resolved attribution. No analytics SDK or provider keys ship to the client.

- 510f15d: Add a first-party block registry (`@agent-native/core/blocks`). A `BlockSpec`
  describes one document block end to end — a zod `schema` for its data, an `mdx`
  config for byte-stable MDX round-trip, a `Read` renderer, an optional `Edit`
  (auto-generated from the schema when omitted), and `placement` (top-level
  and/or inline). Apps create a `BlockRegistry`, register their specs, and render
  through `BlockView` inside a `BlockRegistryProvider`.
  - `defineBlock` / `BlockRegistry` / `registerBlocks` — author and register blocks.
  - `BlockRegistryProvider` / `useBlockRegistry` — thread the registry + runtime
    render context (asset resolver, action caller, inline markdown editor) into React.
  - `SchemaBlockEditor` + the `markdown()` zod helper — a schema-driven auto-editor
    that renders shadcn-style controls per field, with `markdown()`-tagged string
    fields editing inline via the app's rich-markdown editor.
  - `serializeSpecBlock` / `parseSpecBlock` + the shared `prop()` encoder and
    estree attribute reader (exported from the React-free
    `@agent-native/core/blocks/server` entry) — registry-driven MDX round-trip that
    reproduces the existing component/attribute encoding for backward compatibility.
  - `describeBlocksForAgent` / `renderBlockVocabularyReference` — generate the
    agent's block vocabulary (per-block JSON schemas and a compact markdown
    reference of types, MDX tags, placement, and key fields) directly from the
    registry so the agent never drifts from what the app can render and serialize.
  - A standard block library (`@agent-native/core/blocks` + the React-free
    `/blocks/server` entry): `checklistBlock`, `tableBlock`, `codeTabsBlock`,
    `htmlBlock`, and `tabsBlock`, each with its pure schema + MDX config so apps
    can register the shared specs (plan registers all of them; tabs is also
    inline-placeable).

  The registry is designed to run alongside existing per-block code: renderers and
  the MDX adapter check the registry first and fall back to legacy paths for
  unregistered block types, so existing documents keep working unchanged.

- 510f15d: Add a standard `tabs` block to the core block library
  (`@agent-native/core/blocks`): a horizontal pill-tab container whose tabs each
  hold their own list of child blocks. It exports `tabsBlock` (the full React
  spec), `TabsBlockReader`/`TabsBlockEditor`, and the React-free
  `tabsSchema`/`tabsMdx` config (from `@agent-native/core/blocks/server`). The MDX
  encoding matches the legacy `<TabsBlock … tabs={[…]} />` form — labels and
  nested child blocks are one JSON `tabs` prop (not nested MDX) — so stored
  documents round-trip byte-compatibly.

  Container blocks render their children through a new optional
  `BlockRenderContext.renderBlock` capability (with a `NestedBlock` shape): the app
  wires it to its own block dispatcher so registered children render via their spec
  and unconverted children fall through the app's legacy path. This is the
  coexistence seam that lets a core container block render app-specific child
  blocks without importing them.

- 510f15d: Syntax-highlight code blocks in the shared rich markdown editor. When an embedder
  enables `features.codeBlock` (Plans today), the editor now uses
  `CodeBlockLowlight` with a curated lowlight grammar set (js/ts/tsx, json, css,
  html, bash, python, yaml, sql, markdown) and a github-dark token theme, instead
  of a plain monospace block. Inline code keeps its own background; block code no
  longer leaks the inline-code background over the dark surface. Apps that ship
  their own code node (Content's NFM editor disables `features.codeBlock`) are
  unaffected.
- 510f15d: Add optional real-time multi-user editing to the shared `RichMarkdownEditor`.

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

- 510f15d: Add a shared block-level image node to the rich markdown editor core so every
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

- 510f15d: Extract the rich markdown editor into ONE shared, configurable core so the plan
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

### Patch Changes

- 510f15d: Show a loading skeleton while the Assets picker iframe is initializing.
- 5f51768: Show `sendToAgentChat({ newTab: true, background: true })` work in RunsTray and ensure hidden background tabs start their queued chat turn without stealing focus.
- 510f15d: Fix a content-corrupting reconcile loop in the shared `useCollabReconcile` hook
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

- 5f51768: Honor connect-minted MCP OAuth tokens on the HTTP action surface.

  `agent-native connect` mints an MCP-audience OAuth access token and the local
  Plans publish flow POSTs it (as `Authorization: Bearer`) to the hosted action
  route `/_agent-native/actions/import-visual-plan-source`. That token is bound to
  the app's MCP resource, not the legacy `sessions` table, so `getSession` never
  resolved it on the action surface and `requiresAuth` actions like
  `import-visual-plan-source` returned 401 — breaking `publish-visual-plan`.

  `getSession`'s bearer path now falls back to the MCP surface's canonical
  `verifyAuth` for any `Authorization: Bearer` request, so the action surface
  honors exactly the tokens the MCP endpoint honors: same signature check, same
  audience binding to this app's resource, same connect-token revocation gate. It
  resolves to the same `{ email, orgId }` identity, so ownable-data scoping is
  identical. Cookie/page loads (no bearer header) are unaffected, and tokens bound
  to a different app's audience are still rejected.

- 5f51768: Reduce Sentry noise from expected browser auth/abort and reconnect 404 events, and keep social OG images from failing when the native resvg runtime is unavailable.
- 5f51768: Strengthen generated agent instructions to forbid hardcoded API keys, tokens,
  webhook secrets, credential literals, and private data in source, docs,
  fixtures, prompts, action responses, and generated content.
- 510f15d: Improve the hosted Google sign-in warning for Mail by showing it as a popover with a run-local path.
- 5f51768: Super-easy `/visual-plan` setup: `agent-native skills add visual-plan` now
  installs the skill, registers the Plans MCP connector, AND authenticates it in
  one step (reusing the existing `agent-native connect` OAuth / browser
  device-code flow) so you no longer hit an OAuth wall on the first tool call. Add
  a `--no-connect` flag to skip auth, and in non-interactive shells / CI the auth
  step is skipped and the exact `agent-native connect <url>` command is printed
  instead. The unauthorized MCP response (`401`) now returns an actionable JSON
  body with a human-readable message plus the exact remediation (the
  `agent-native connect <url>` command and the authorize / resource-metadata URLs)
  while keeping the `WWW-Authenticate` header for OAuth-capable clients. Adds a
  public docs quick-start page for Visual Plans.
- 5f51768: Correct the `/visual-plan` setup & authentication docs to match the real model.
  The CLI install (`agent-native skills add visual-plan`) installs the skill,
  registers the hosted Plans MCP connector, AND authenticates it in one step (a
  one-time browser sign-in at setup is intended; `--no-connect` skips it) — it does
  not run "no-login local by default". The no-sign-up experience is the
  browser/guest path: anyone you share with can create and edit a plan as a guest
  and only sign in to save or share, at which point their guest plans are claimed
  into their account. Public/shared plans are viewable by anyone with the link;
  commenting requires an agent-native account. Local mode (offline, plans synced to
  your repo as MDX) is documented as a separate advanced path. Updates the shared
  `PLAN_SETUP_AUTH_MD` block across all Plans skills (`/visual-plan`, `/ui-plan`,
  `/visual-questions`, `/visualize-plan`) and the public Visual Plans docs page,
  including its frontmatter description.
- 510f15d: Keep `/visual-plan` and `/ui-plan` on the host agent's normal planning flow,
  using visual questions only for explicit `/visual-questions` intake.
- 5f51768: Add a shared rich markdown editor for inline plan prose editing.
- 5f51768: Plan editor share + side-chat UX: the agent side chat now offers an inline,
  account-free way to paste an Anthropic or OpenAI API key (progressive
  disclosure next to the existing one-click Builder connect) and makes clear the
  side chat is optional — you can keep editing with your own coding agent. Adds a
  `saveAgentEngineApiKey` client helper for storing a bring-your-own provider key.
- 5f51768: Keep generated workspace skills synced from the repository skill source of truth and guard against drift.

## 0.37.3

### Patch Changes

- 309ad84: Tighten bundled visual plan guidance for non-redundant documents and aligned sketch wireframes.

## 0.37.2

### Patch Changes

- ce7f37c: Expose shared Brand Kit helpers for parsing Figma `.fig` local-copy files.
- ce7f37c: Add the visual-questions Plans skill to the installer and support compact share triggers.

## 0.37.1

### Patch Changes

- 1810b32: Fix skill discovery and resource read guidance for agent-native agents.

## 0.37.0

### Minor Changes

- 5d6ef40: Add `useSemanticNavigationState` and `useAgentRouteState` client helpers for
  consistent semantic navigation app-state sync, tab-scoped navigate command
  consumption, and duplicate command protection.

### Patch Changes

- 5d6ef40: Keep the chat shell from waiting on dynamic prompt suggestions, and show a
  three-row suggestion skeleton in empty chats while context-aware suggestions
  load.
- 5d6ef40: Add a "Plan Discipline" section to the exported Plans skills

  `/visual-plan`, `/ui-plan`, and `/visualize-plan` now lead with plan-mode
  process discipline drawn from best-in-class plan modes: right-size when to plan
  (skip trivial work), research the codebase before drafting, keep planning
  read-only, clarify only decision-changing ambiguity before finalizing (otherwise
  state an assumption and proceed), write specific plans with non-goals and a
  closing verification step, and treat the plan as an explicit approval gate before
  any code is written.

## 0.36.0

### Minor Changes

- f424018: Add the Agent-Native Plans `/ui-plan` exported skill and CLI alias for
  UI-first, high-fidelity visual planning.

### Patch Changes

- f424018: Move the Context X-Ray composer meter into a compact popover trigger.
- f424018: Show humanized running tool-call activity and hide argument previews from collapsed tool-call headers.
- f424018: Stop emitting `X-Frame-Options: DENY` from the global security headers middleware, emit iframe-navigation COEP/CORP headers for cross-origin isolated hosts, and allow trusted app host ancestors for extension iframe documents so agent-native apps can run inside iframe hosts.
- f424018: Reconcile deferred external state updates after local editing becomes inactive so agent changes can appear live without a refresh.
- f424018: Keep streamed assistant text visible across transient chat continuations so tool cards no longer jump ahead of earlier text.

## 0.35.3

### Patch Changes

- 2da75f1: Harden Agent Teams serverless dispatch and visibility: quick non-2xx
  self-dispatch responses now fail the sub-agent instead of leaving a ghost
  running task, and background transcripts/stop controls resolve the active
  chunked run id.
- 2da75f1: Add browser-safe client helpers for reading, writing, setting, and deleting
  application state through the framework transport, plus an imperative
  `callAction` helper for client action calls that do not fit React hooks.
- 2da75f1: Keep hosted template server shells CDN-cacheable by applying the shared SSR SWR
  headers to auth login HTML and always enforcing SSR cache headers on React
  Router shell/data responses.
- 2da75f1: Make the stateless MCP server serverless-safe so remote hosts (Claude Code,
  etc.) can actually complete `tools/call`. Two changes to the Streamable HTTP
  transport: (1) `enableJsonResponse: true` so request/response is returned as
  JSON inside the request lifecycle instead of an SSE event pushed after a
  serverless instance has frozen (which dropped the result and surfaced as
  "session expired"); (2) answer `405` for `GET` so clients don't latch onto a
  standalone server-to-client SSE stream a stateless per-request instance can't keep
  alive ("not connected"). Inline MCP App rendering and direct tool calls now
  work over the hosted connectors.
- 2da75f1: Enhance local context reports with workflow diagnostics and update the built-in
  Plans skill installer metadata.
- 2da75f1: Add observable agent chat context helpers for advanced staged prompt context
  sync while keeping `sendToAgentChat({ message, context, submit })` as the
  primary simple UI handoff API.
- 2da75f1: Harden provider API runtime credential scoping and catalog allowlists from late
  review feedback.
- 2da75f1: Quietly handle local auto-dev-account signup races and expose stable core
  client leaf exports for apps that need to avoid the broad client barrel.
- 2da75f1: Move the agent runs tray out of the agent panel header and into the chat overflow menu.

## 0.35.2

### Patch Changes

- 2dccc2a: Exclude `pnpm-lock.yaml` from CLI scaffolding so a freshly created app does not ship a stale lockfile copied from the source template.

## 0.35.1

### Patch Changes

- 56888a3: Update React Router dependencies to 7.16.0.

## 0.35.0

### Minor Changes

- 4740d41: Add a local Context X-Ray skill installer that writes a turnkey context-xray
  command, Codex/Claude skill instructions, and slash-command prompts for
  visualizing local coding-agent context usage.

  Project-scoped installs now stay in project `.agents` artifacts, Codex session
  analysis honors `--project`, `--open` uses a local HTML file instead of a
  detached server, and Windows installs get a native command launcher.

- 4740d41: Add Context X-Ray for inspecting and managing the agent context window with
  segment manifests, pin/evict/restore actions, durable directives, and a chat
  composer cockpit.

## 0.34.0

### Minor Changes

- 1acd641: Add a shared provider API runtime for flexible, provider-aware authenticated HTTP requests, and expose provider API catalog/docs/request actions from Dispatch.

## 0.33.0

### Minor Changes

- 8509cf0: Add a shared `@agent-native/core/provider-api` module: a reusable provider-API runtime with a credential-resolver hook, SSRF-safe outbound dispatch, a provider catalog (base URLs, auth styles, credential keys, docs/spec URLs, placeholders, examples), and helpers (`createProviderApiRuntime`, `getProviderApiConfig`, `isProviderApiId`, `listProviderApiCatalog`, `listProviderApiIdsForTemplateUse`, `PROVIDER_API_IDS`). Templates can build a thin credential adapter on top instead of hardcoding each provider endpoint.

## 0.32.18

### Patch Changes

- 2876933: Clarify Agent Teams delegation intent and distinguish spawned background tasks from completed work.

## 0.32.17

### Patch Changes

- 966838d: Propagate agent team parent thread metadata through background runs.
- 966838d: Expose the Contracts template in public metadata with its dedicated icon alias.
- 966838d: Stop a dropped Neon connection from crashing the whole serverless function. `@neondatabase/serverless` mirrors `pg-pool`, which removes its idle `error` listener while a client is checked out — so a WebSocket that drops mid-query (Lambda freeze/thaw, Neon "terminating connection due to administrator command", an idle socket the pooler closed) made the client emit an `error` event with no listener, which Node escalated to an uncaught exception that killed the function. This was the single highest-volume production crash. `attachNeonPoolErrorLogger` now attaches a persistent `error` listener to every client at connect time (covering all three pools — app, per-app, and Better Auth), so a dropped connection degrades to a logged warning and a reconnect on the next query instead of a process crash.

## 0.32.16

### Patch Changes

- c8773be: Fix social preview response handling and harden Agent Teams recovery paths.

## 0.32.15

### Patch Changes

- ba34976: Make repo-root pnpm dev use the lazy framework gateway by default.

## 0.32.14

### Patch Changes

- 6dde14d: Add a keyed agent chat composer context API for staging hidden context before the next prompt is submitted.
- 6dde14d: Agent Teams sub-agents now run reliably on serverless hosts (Netlify/Vercel/AWS Lambda).

  Previously a spawned sub-agent executed as an in-process detached promise from the spawning request. Serverless hosts freeze the function the moment that response flushes, so the sub-agent was suspended mid-run and never completed — yet `spawn` had already returned `status: "running"`, which the orchestrator narrated as "done." Background "batch" jobs reported success but produced no output.

  Sub-agents now use the framework's durable enqueue-to-SQL + self-fire-HTTP pattern (the same one A2A async tasks and integration webhooks use): `spawnTask` enqueues the run and self-fires a fresh, HMAC-signed POST to a new `/_agent-native/agent-teams/_process-run` route, which executes the run in its own function invocation with its own timeout budget. Runs longer than one function's wall-clock checkpoint at the soft-timeout boundary and self-fire a continuation chunk (the server-side analog of the main chat's client-driven continuation), folding into one durable assistant message via a stable turn id. An atomic SQL claim makes duplicate dispatches idempotent.

  Status reporting is now truthful and observable: `status`/`read-result`/`list` reconcile against the durable queue (a single completed chunk at a continuation boundary no longer prematurely marks a multi-chunk task done), dropped dispatches are re-fired, and genuinely-stalled runs fail with a real message instead of hanging as "running." The RunsTray now self-heals an owner's in-flight runs on read, so it reflects precise status without waiting on the orchestrator to poll.

  This path is host-agnostic — it works anywhere Nitro deploys (no `waitUntil` dependency) and falls back to localhost self-dispatch in dev. It requires `APP_URL`/`URL`/`DEPLOY_URL`/`BETTER_AUTH_URL` to be set in production/shared deployments so the deployment can reach its own URL (the same requirement async A2A and webhooks already carry).

  Note: the previous best-effort "sub-agent finished" auto-recap on the parent thread (a second in-process run that also never survived serverless) is removed; the orchestrator is instead prompted to read `status`/`read-result`, and the RunsTray surfaces completion.

- 6dde14d: Improve background agent visibility by surfacing recent runs in the agent panel and tracking Agent Teams launches in the shared progress tray.
- 6dde14d: Dedupe the client export and server fold of the same tool-call turn so it no longer renders twice. Now that rebuilt tool-call ids are scoped by run (`${runId}:tc_1`) while the live client stream uses a bare counter (`tc_1`), the two copies of one turn hashed to different thread-merge fingerprints; the render-only `toolCallId` is now stripped before fingerprinting so they match again.
- 6dde14d: Recover the agent panel after assistant-ui React fiber unmount crashes instead of leaving the chat UI stuck behind the reset panel.
- 6dde14d: Stop the agent chat from giving up on the first soft-timeout when a turn hasn't produced visible output yet. A complex first turn can spend the whole ~40s soft-timeout window "thinking" before any text or tool call, which previously surfaced "The agent stopped before finishing" with zero retries. Silent run timeouts now retry through a larger empty-continuation budget (1 → 3) so transient slow starts recover, while the cap still terminates a genuinely stuck turn with a clear message instead of looping forever.
- 6dde14d: Suppress Node 22 web stream close races from Vite dev socket error handling so `agent-native dev` does not crash during startup.
- 6dde14d: Add generated Agent-Native social preview images and default OG image metadata.
- 6dde14d: Prevent folded continuation turns from persisting duplicate assistant-ui tool-call resource keys, sanitize already-saved duplicates, and recover standalone prompt composers if the duplicate-key crash still appears.

## 0.32.13

### Patch Changes

- 5fe265e: Fix file uploads failing with a misleading "needs file storage" error when Builder.io was connected at org scope. The `/_agent-native/file-upload` route (and its status endpoint) now resolve the active org and include `orgId` in the request context, so org-scoped Builder credentials are found during upload.

## 0.32.12

### Patch Changes

- 9dc6a6f: Tighten generated agent instructions to prefer existing actions over duplicate REST wrappers.

## 0.32.11

### Patch Changes

- 4ee09b9: Copy ffmpeg-static into serverless bundles so Clips media transcription fallback can extract audio in production.

## 0.32.10

### Patch Changes

- 408af9c: Keep the Builder connect popup open by falling back to the signed connect URL already rendered in the UI when the click-time status refresh fails.

## 0.32.9

### Patch Changes

- 221efac: Fix skill installation edge cases and Notion sync refresh behavior.

## 0.32.8

### Patch Changes

- 8a946c6: Use `@theme inline` so scoped CSS variables (e.g. `.dark`, subtree overrides) apply to shadcn/Tailwind color utilities at use time.

## 0.32.7

### Patch Changes

- bacf30d: Expose Builder account plan metadata from the connect flow status.

## 0.32.6

### Patch Changes

- 69a857a: Preserve array values in action GET query parameters across client and server runtimes.
- 69a857a: Respect `submit: false` in `sendToAgentChat()` so agent chat bridge messages prefill the composer instead of submitting immediately.
- 69a857a: Normalize bracketed GET action query parameters through Nitro's getQuery fallback so array schemas receive arrays consistently.
- 69a857a: Persist stale run error diagnostics when reaping interrupted agent runs.
- 69a857a: Keep the embedded CLI scoped to dev-frame surfaces and route desktop template dev apps through the frame so hot reloads do not refresh terminal state.

## 0.32.5

### Patch Changes

- d56f689: Merge runtime route-warmup config overrides with the build-time config, and tune smooth streaming commit cadence.

## 0.32.4

### Patch Changes

- 826fc96: Keep auth fallback HTML out of shared CDN caches and vary docs markdown/html responses by Accept.
- 826fc96: Move safe React Router route data and JS warmup into the core client with configurable Vite defaults.

## 0.32.3

### Patch Changes

- 25d6fd6: Add CDN and Netlify durable cache headers to framework SSR and route data responses.
- 25d6fd6: Smooth streamed assistant text in chat, Agent-Native Code, and the coding CLI.

## 0.32.2

### Patch Changes

- 3d46958: Fix desktop app login failing in dev with a CORS error
  (`Access-Control-Allow-Credentials is not "true"`).

  The desktop app logs in with `credentials: "include"`. In dev its origin
  (`http://localhost:1420`) was matched by the embed-frame Vite middleware, which
  answered the CORS preflight with `Access-Control-Allow-Origin` but no
  `Access-Control-Allow-Credentials`. The browser then rejected the credentialed
  login. The middleware now also sends `Access-Control-Allow-Credentials: true`
  for origins allowed to use credentials, matching how production responds.

## 0.32.1

### Patch Changes

- d987847: Keep SSR HTML and React Router data responses CDN-cacheable across auth-looking requests, and publish a default no-op Speculation-Rules header to prevent Cloudflare Speed Brain prefetch refusals from surfacing as 503s.

## 0.32.0

### Minor Changes

- a56d93d: Add a shared `@agent-native/core/brand-kit` module — template-agnostic Brand Kit types and brand-signal extraction, plus a single re-export surface over the existing design-token utilities (URL/GitHub/Tailwind/CSS/code/document extraction). This de-duplicates the design-system/brand logic that the `design` and `slides` templates previously copy-pasted, so it can be reused across design, slides, and assets for on-brand generation.

### Patch Changes

- a56d93d: Fix core client runtime races, restricted sharing read checks, and A2A secret
  sync URL safety.
- a56d93d: Fix a batch of verified bugs found in a deep core bug hunt:
  - **Token usage double-counted on `ai-sdk:*` engines.** The AI SDK translator emitted usage from both `finish-step` (per-step) and `finish` (total), so cost tracking, quotas, and context-budget logic saw ~2× the real tokens. Now usage is emitted only from the terminal `finish`.
  - **Cross-tenant screen remounts.** Agent-initiated `refresh-screen` was emitted deployment-global (no owner), so one user's refresh remounted/refetched every other logged-in user's screen. The poll detector is now per-session and owner-scoped, and reads the newest row deterministically (`ORDER BY`/max instead of arbitrary `rows[0]`).
  - **Recoverable soft-timeout turns turned into dead chats.** A transient `thread_data` save failure during a soft-timeout continuation discarded the stashed `auto_continue` and surfaced a hard error; the client now still resumes.
  - **Extension viewer→owner privilege escalation.** A shared/org extension could re-announce its bridge binding from inside the iframe to escalate from viewer to owner. The binding is now latched to the first (pre-user-content) announcement.
  - **LLM-judge evals saw empty transcripts.** The eval transcript builder matched `tool-call`/`tool-result` event types that are never persisted (real shapes are `tool_start`/`tool_done`), stripping all tool activity from judged runs.
  - **MCP static `ACCESS_TOKEN` compared non-constant-time** — now uses `timingSafeEqual`.
  - **Webhook dedup dropped same-second messages** (Telegram/WhatsApp second-resolution timestamps); dedup now prefers the platform's unique message id.
  - **Agent `web-request` and notification webhooks had weaker SSRF protection** than the extension proxy; both now use the shared DNS/redirect/connect-time safe fetch path.
  - **Google Docs reply dedup didn't survive serverless cold starts** (in-memory `Set`), causing duplicate agent replies; processed reply ids are now persisted in the SQL thread mapping.
  - **`upload-image` buffered the entire remote body before enforcing the 25 MB cap** (OOM risk); it now checks `Content-Length` and streams with an early abort.
  - **`useAgentChatGenerating` ignored `tabId`**, so any finished run cleared the generating state of unrelated chat surfaces; it now filters by the run it started.
  - Plus: trace span matching for concurrent same-named tool calls (FIFO), code-mode toggle rollback on server rejection, awareness-map leak prune, retry-delay abort-listener leak, demo-mode status reading the wrong session field, and `removeThread` calling setState inside a state updater.

- a56d93d: Exclude TSX specs and e2e host fixtures from core package builds, refresh the
  package description, and remove unused compatibility/dead streaming code.
- a56d93d: Remove compiler-verified dead code (unused imports, unused non-exported types,
  and side-effect-free unused locals) across the framework. No behavior or public
  API changes — only declarations the TypeScript compiler proves are unreferenced.
- a56d93d: Avoid noisy startup 404s from optimistic chat tabs and make framework route mounting more reliable in serverless builds.
- a56d93d: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.
- a56d93d: Apply CDN-friendly SWR caching to public SSR HTML and React Router `.data` responses while preserving authenticated/private cache policies, and keep Vite-hashed client assets immutable across deploy targets.

## 0.31.2

### Patch Changes

- 6e6fce7: Internal cleanup sweep: remove unused imports/variables and tidy code (no behavior change).

## 0.31.1

### Patch Changes

- 853ab71: Escape application-state and resource prefix queries so literal `%` and `_` characters do not over-match keys. Also make core store initialization retry after transient failures instead of caching rejected promises, and keep run SSE polling moving past corrupt persisted events.

  Search and rate-limit LIKE filters now treat user text literally, including chat-thread/debug searches and inbound-email sender matching.

## 0.31.0

### Minor Changes

- d4013f0: Add a shared `@agent-native/core/brand-kit` module — template-agnostic Brand Kit types and brand-signal extraction, plus a single re-export surface over the existing design-token utilities (URL/GitHub/Tailwind/CSS/code/document extraction). This de-duplicates the design-system/brand logic that the `design` and `slides` templates previously copy-pasted, so it can be reused across design, slides, and assets for on-brand generation.

### Patch Changes

- d4013f0: Fix core client runtime races, restricted sharing read checks, and A2A secret
  sync URL safety.
- d4013f0: Fix a batch of verified bugs found in a deep core bug hunt:
  - **Token usage double-counted on `ai-sdk:*` engines.** The AI SDK translator emitted usage from both `finish-step` (per-step) and `finish` (total), so cost tracking, quotas, and context-budget logic saw ~2× the real tokens. Now usage is emitted only from the terminal `finish`.
  - **Cross-tenant screen remounts.** Agent-initiated `refresh-screen` was emitted deployment-global (no owner), so one user's refresh remounted/refetched every other logged-in user's screen. The poll detector is now per-session and owner-scoped, and reads the newest row deterministically (`ORDER BY`/max instead of arbitrary `rows[0]`).
  - **Recoverable soft-timeout turns turned into dead chats.** A transient `thread_data` save failure during a soft-timeout continuation discarded the stashed `auto_continue` and surfaced a hard error; the client now still resumes.
  - **Extension viewer→owner privilege escalation.** A shared/org extension could re-announce its bridge binding from inside the iframe to escalate from viewer to owner. The binding is now latched to the first (pre-user-content) announcement.
  - **LLM-judge evals saw empty transcripts.** The eval transcript builder matched `tool-call`/`tool-result` event types that are never persisted (real shapes are `tool_start`/`tool_done`), stripping all tool activity from judged runs.
  - **MCP static `ACCESS_TOKEN` compared non-constant-time** — now uses `timingSafeEqual`.
  - **Webhook dedup dropped same-second messages** (Telegram/WhatsApp second-resolution timestamps); dedup now prefers the platform's unique message id.
  - **Agent `web-request` and notification webhooks had weaker SSRF protection** than the extension proxy; both now use the shared DNS/redirect/connect-time safe fetch path.
  - **Google Docs reply dedup didn't survive serverless cold starts** (in-memory `Set`), causing duplicate agent replies; processed reply ids are now persisted in the SQL thread mapping.
  - **`upload-image` buffered the entire remote body before enforcing the 25 MB cap** (OOM risk); it now checks `Content-Length` and streams with an early abort.
  - **`useAgentChatGenerating` ignored `tabId`**, so any finished run cleared the generating state of unrelated chat surfaces; it now filters by the run it started.
  - Plus: trace span matching for concurrent same-named tool calls (FIFO), code-mode toggle rollback on server rejection, awareness-map leak prune, retry-delay abort-listener leak, demo-mode status reading the wrong session field, and `removeThread` calling setState inside a state updater.

- d4013f0: Exclude TSX specs and e2e host fixtures from core package builds, refresh the
  package description, and remove unused compatibility/dead streaming code.
- d4013f0: Remove compiler-verified dead code (unused imports, unused non-exported types,
  and side-effect-free unused locals) across the framework. No behavior or public
  API changes — only declarations the TypeScript compiler proves are unreferenced.
- d4013f0: Route outbound A2A, Dispatch vault, and scheduling webhook requests through
  SSRF-safe URL fetch paths.

## 0.30.6

### Patch Changes

- 3107f96: Preserve MCP tool error and read-only metadata through action execution, and allow Pinpoint's empty test suite to pass intentionally.

## 0.30.5

### Patch Changes

- 4048de7: Align app-backed skill installs with user-scope requests, keep full JSON install output machine-readable, and let Connect/device-code flows mint standard MCP OAuth tokens with full-catalog coding-agent configs when A2A_SECRET is absent or blank.
- 4048de7: Design exploration now works cleanly from link-only coding agents (Codex, Claude Code CLI, Claude Desktop Code tab): after the user picks a direction in the browser, the editor shows a copyable summary to paste back into chat — matching the Assets picker's standalone handoff. `present-design-variants` now accepts 2–5 directions (3 is the sweet spot) instead of erroring on anything but exactly 3, and its result includes `fallbackInstructions` for the browser path. Docs walk the full install → generate → pick (inline vs link) → apply-to-code flow for both Assets and Design, with the exact paste-back summaries and an install-alias matrix.

## 0.30.4

### Patch Changes

- 2cb6219: CLI + Builder connect: support custom / tunnel origins for local dev.
  - `agent-native skills add` gains a `--mcp-url <url>` flag to register the
    app-backed MCP connector against a custom origin — an ngrok tunnel, a local
    dev server, or a self-hosted deployment — instead of the built-in hosted
    default. A bare origin gets the standard `/_agent-native/mcp` path appended.
  - Fix the "Connect Builder" cli-auth callback when the app is reached via a
    tunnel (e.g. ngrok) whose origin Builder's `/cli-auth` does not trust:
    instead of handing Builder the rejected origin — which makes Builder fall
    back to its own dead `http://localhost:10110/auth` (ERR_CONNECTION_REFUSED) —
    fall back to the app's own `http://localhost:<PORT>` in local dev, an origin
    Builder accepts and a same-machine browser can reach. Production origins
    (`*.agent-native.com`) pass the allow-list and are unaffected.

## 0.30.3

### Patch Changes

- 5eece85: CLI + Builder connect: support custom / tunnel origins for local dev.
  - `agent-native skills add` gains a `--mcp-url <url>` flag to register the
    app-backed MCP connector against a custom origin — an ngrok tunnel, a local
    dev server, or a self-hosted deployment — instead of the built-in hosted
    default. A bare origin gets the standard `/_agent-native/mcp` path appended.
  - Fix the "Connect Builder" cli-auth callback when the app is reached via a
    tunnel (e.g. ngrok) whose origin Builder's `/cli-auth` does not trust:
    instead of handing Builder the rejected origin — which makes Builder fall
    back to its own dead `http://localhost:10110/auth` (ERR_CONNECTION_REFUSED) —
    fall back to the app's own `http://localhost:<PORT>` in local dev, an origin
    Builder accepts and a same-machine browser can reach. Production origins
    (`*.agent-native.com`) pass the allow-list and are unaffected.

## 0.30.2

### Patch Changes

- bf5ba4c: Design exploration now works cleanly from link-only coding agents (Codex, Claude Code CLI, Claude Desktop Code tab): after the user picks a direction in the browser, the editor shows a copyable summary to paste back into chat — matching the Assets picker's standalone handoff. `present-design-variants` now accepts 2–5 directions (3 is the sweet spot) instead of erroring on anything but exactly 3, and its result includes `fallbackInstructions` for the browser path. Docs walk the full install → generate → pick (inline vs link) → apply-to-code flow for both Assets and Design, with the exact paste-back summaries and an install-alias matrix.

## 0.30.1

### Patch Changes

- 221bb55: Refine the app and code agent prompts toward Anthropic/Claude best practices: convert the extension-vs-Builder routing from a prose if/else tree into a scannable `<routing>` heuristic table, reframe the act-mode handoff and dev-mode capability blocks affirmatively instead of as stacked "do NOT" walls, require the code agent to show verification evidence (the command it ran and its key result) rather than asserting success, and soften the emphasis density in the connect-builder tool description.

## 0.30.0

### Minor Changes

- 8a1ff15: Bring the agent + coding harness toward Codex/Claude-Code parity: gpt-5.5-style behavioral core shared across the app and code agents (persona, engineering judgment, autonomy, verify-before-done, communication/final-answer discipline, parallel tool calls), rewritten sub-agent orchestration guidance, a new core ask-question clarifying-question tool with multiple-choice UI (the client now reads the per-tab application-state key so the question card actually renders), enriched coding tool descriptions, refreshed skills, a new writing-agent-instructions guide + docs page, and analytics workflow-discipline instruction improvements.

## 0.29.0

### Minor Changes

- d52e595: Bring the agent + coding harness toward Codex/Claude-Code parity: gpt-5.5-style behavioral core shared across the app and code agents (persona, engineering judgment, autonomy, verify-before-done, communication/final-answer discipline, parallel tool calls), rewritten sub-agent orchestration guidance, a new core ask-question clarifying-question tool with multiple-choice UI, enriched coding tool descriptions, refreshed skills, a new writing-agent-instructions guide + docs page, and analytics workflow-discipline instruction improvements.

## 0.28.5

### Patch Changes

- d3cadf3: Clarify Assets skill instructions for standalone picker handoff fallback.

## 0.28.4

### Patch Changes

- 6ed5aab: Forward structured MCP app host context so external hosts can use selected assets from embedded apps.

## 0.28.3

### Patch Changes

- f29459d: Clean the temporary auth redirect cache-busting query parameter from browser history after client boot.
- f29459d: Database admin: make the agent's db-admin tools available whenever the DB admin
  itself is (`NODE_ENV === "development"`), instead of only when the agent
  Code-mode toggle is on. This gives true agent/UI parity — the agent can read and
  edit the full database through `db-admin-*` tools in App mode too — and the tool
  descriptions now steer the agent to prefer them over the scoped `db-exec`/
  `db-query` for admin work and for tables without `owner_email`/`org_id` scoping.

## 0.28.2

### Patch Changes

- 19e7008: Clean the temporary auth redirect cache-busting query parameter from browser history after client boot.

## 0.28.1

### Patch Changes

- 704305f: Improve MCP app embedding for external hosts by keeping local embed origins usable, avoiding embed params on dev runtime modules, compacting cached app shells, and acknowledging nested chat handoffs so picked assets can round-trip back to the host.

## 0.28.0

### Minor Changes

- 5000a0b: Rename the agent-capability "dev mode" to "Code mode" for clarity. This is the
  toggle that lets the agent run shell/file/raw-DB tools and edit the app's own
  source code — now named distinctly from environment dev mode (`NODE_ENV` /
  Vite).
  - `useCodeMode()` is now the primary client hook, returning `{ isCodeMode,
canToggle, isLoading, setCodeMode }`.
  - `useDevMode()` is kept as a `@deprecated` alias that returns the old
    `{ isDevMode, canToggle, isLoading, setDevMode }` shape, delegating to the
    same shared internal state so existing callers keep working.
  - Back-compat is fully preserved: the `AGENT_MODE` env var, the
    `/_agent-native/agent-chat/mode` endpoint (its payload still uses `devMode`),
    and the `agent-chat.mode` settings key are unchanged. The `/mode` GET response
    now additively includes a `codeMode` field mirroring `devMode`.

### Patch Changes

- 5000a0b: Keep live agent activity steps pinned above the composer while a chat run is in progress, leaving completed activity trails collapsed in the transcript.

## 0.27.0

### Minor Changes

- c3852e0: Add a development-mode database admin: visually browse schemas and tables, view/filter/sort/edit data in a spreadsheet-style grid, and run SQL — with full agent/UI parity. Gated to development mode on localhost.

### Patch Changes

- c3852e0: Security hardening for the agent's raw-SQL tools, cross-tenant run isolation,
  server-side SSRF, and CSRF:
  - **db-query / db-exec scope bypass (cross-tenant read/write):** schema-qualified
    table references (`public.<table>` on Postgres, `main.<table>` on SQLite) now
    fail with a clear error, since a qualified name bypasses the per-user/per-org
    temporary views that isolate each tenant's rows. The same guard protects the
    extension SQL surface, which routes through the same tools.
  - **Credential exfiltration via db tools:** per-user credential rows
    (`u:<email>:credential:*`, stored by `resolveCredential`) are now excluded from
    the agent's scoped `settings` view, so a prompt-injected agent can no longer
    read the user's own API keys/tokens through `db-query` and send them out.
  - **Cross-tenant agent run leak + abort:** `GET /runs/:id/events`,
    `GET /runs/active`, and `POST /runs/:id/abort` now verify the caller owns the
    run's thread (404 otherwise), closing a hole where any authenticated tenant who
    learned another tenant's runId/threadId could stream their live agent turn
    (assistant text + tool-result payloads) or abort their run.
  - **Server-side SSRF:** the `upload-image` action and the `import-from-url`
    design-token fetcher now route untrusted URLs through a shared `ssrfSafeFetch`
    (DNS-aware private-address check, connect-time IP guard, per-redirect
    re-validation), so they can no longer be steered to cloud metadata, localhost,
    or internal services.
  - **CSRF:** `Sec-Fetch-Site: same-site` is no longer trusted as first-party, so a
    sibling-subdomain page under a shared cookie domain can't ride the session
    cookie for a state-changing request. Legitimate first-party clients still pass
    via the custom-header / JSON paths; iframe and embed flows are unaffected.

- c3852e0: Beta-readiness best-practices audit fixes:
  - **core / sharing:** `mergeCoreSharingActions` now preserves
    `toolCallable`/`publicAgent`/`link`/`mcpApp` (via `preserveActionFlags`),
    restoring the H5 tools-bridge `403` guard on share/unshare/set-visibility that
    was silently dropped during registry merge.
  - **core / HTTP actions:** stop echoing raw `error.message` on uncategorized 500s
    (return a generic message, log detail server-side); validation and explicit
    user-facing errors still pass through.
  - **core / auth:** remove the legacy hardcoded fallback secret literal from the
    production `BETTER_AUTH_SECRET` error message. (The `better-auth` security
    version bump is deferred to a dedicated follow-up: `1.6.12` pulls
    `kysely@0.29` which drops exports `better-auth` bundles, breaking the template
    build — it needs a kysely-compatibility fix + an auth smoke-test.)
  - **core / dev:** register `client/transcription/use-live-transcription` in the
    Vite source-alias map so monorepo dev edits resolve from source, not stale
    `dist`.
  - **core:** add `engines.node >=22`; correct the `AuthSession.orgId` doc comment
    (orgs are framework-managed, not the Better Auth organization plugin).
  - **scheduling:** remove the leftover manual `release` script (publishing goes
    through changesets/CI).
  - **shared-app-config:** clarify that the template-catalog `icon` field is an
    internal icon-alias key resolved by the desktop sidebar `ICON_MAP`, not a raw
    `@tabler/icons-react` export name.

- c3852e0: Documentation audit and overhaul. Fixed accuracy bugs across the docs content
  (wrong import paths, stale API shapes/examples, incorrect constants and ports),
  de-duplicated overlapping material (MCP embed bridge, Dispatch resource model,
  data-scoping pipeline, CLI run-model, database/deployment adapter details),
  trimmed and normalized the template docs, expanded the Frames page, added a
  "Using Your Agent" overview, reorganized the docs nav (split Architecture into
  Core Architecture and Data/Auth & Governance, moved Onboarding into Workspace),
  and reconciled terminology.
- c3852e0: Encrypt per-user / per-org credentials at rest. `saveCredential` /
  `resolveCredential` previously stored third-party API keys as plaintext in the
  `settings` table; they now AES-256-GCM-encrypt values using the same key
  material as the secrets vault (`SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET`),
  so a leaked DB backup / pg_dump / read replica no longer exposes plaintext keys.
  Reads transparently fall back to legacy plaintext rows, so nothing breaks during
  rollout. A one-shot, idempotent, non-destructive migration
  (`pnpm action db-migrate-encrypt-credentials`) re-encrypts existing rows in
  place. The encryption helper is now shared between the secrets vault and
  credentials (`secrets/crypto.ts`); behavior of the vault is unchanged.
- c3852e0: Stop inbound email from impersonating real users. The inbound email adapter now
  derives a `senderVerified` flag from the provider's DKIM/SPF
  (`Authentication-Results`) results, and dispatch only grants a sender's real
  identity — their API keys, org secrets, personal instructions, and ownable data
  — when the message is DKIM/SPF-verified for the From domain AND that address is a
  real org member. Unverified or spoofed `From:` headers fall back to a synthetic,
  credential-less owner. Linked identities (`/link`) are unchanged. The legacy
  "trust the From header" behavior can be restored with
  `DISPATCH_TRUST_UNVERIFIED_EMAIL_SENDER=1` (off by default).

## 0.26.9

### Patch Changes

- 4e7b04a: Add the hosted Design exploration app-backed skill so local agents can install Design MCP instructions and connector setup with `agent-native skills add design-exploration`.

## 0.26.8

### Patch Changes

- 0d72061: Preserve organization identity in remote MCP OAuth access tokens so MCP App
  embed sessions can resolve org-scoped credentials.

## 0.26.7

### Patch Changes

- 0a3003d: Harden MCP app embedding and selected image handoff for Assets picker flows.
- 0a3003d: Improve MCP app embedding and compact Assets picker flows for external chat hosts.

## 0.26.6

### Patch Changes

- fcca046: Retry secret-store table bootstrap after transient database failures and use a
  complete Builder connection check for setup UIs.

## 0.26.5

### Patch Changes

- a6c58a8: Validate Builder private keys before storing them and send the matching public
  key with managed image-generation requests.
- a6c58a8: Serve unauthenticated app HTML as cacheable 200 responses and let the sign-in page perform client-side session redirects.
- a6c58a8: Apply the default public SSR cache policy to React Router `.data` responses
  that only carry React Router's default `no-cache` header.
- a6c58a8: Pin Better Auth in scaffolded workspace roots until the latest Kysely adapter build is compatible.

## 0.26.4

### Patch Changes

- b523050: Tighten MCP app embedding for external hosts, including OAuth discovery, compact app launch behavior, and Claude web transplant support.

## 0.26.3

### Patch Changes

- fc4bdb9: Set year-long immutable cache headers for content-hashed client assets in framework deploy outputs.

## 0.26.2

### Patch Changes

- 1b4800f: Update signup marketing copy to say Agent Native is 100% free and open source.

## 0.26.1

### Patch Changes

- 119397a: Add image-generation aliases for the built-in Assets skill installer.
- 119397a: Expose optional MCP server branding metadata from agent chat plugins and let embedded MCP App hosts open Builder connect links.
- 119397a: Allow Cloudflare quick tunnel hostnames in the default Vite dev server host allowlist.

## 0.26.0

### Minor Changes

- a456cf8: Make the agent a real-time peer editor on collaborative documents. Add `isReconcileLeadClient(awareness, clientId)` so exactly one connected client applies an authoritative external snapshot (agent edit, Notion pull, full rewrite) into a shared Y.Doc — the rest receive it through normal Yjs sync — preventing the changed region from being duplicated across clients. Editors now reconcile newer SQL content into the live Y.Doc gated on `updatedAt`, so a lagging poll can never revert live edits and post-refresh content is always correct.

### Patch Changes

- a456cf8: Harden agent chat continuation across serverless timeouts. Fixes several cases where a turn that hit a timeout would error or stall instead of resuming: (1) a tool still in flight when the timeout fires now counts as progress, so the client no longer gives up in ~2s with "connection kept failing" while the server is actively working; (2) the empty-continuation cap is measured by real content (not bare part count) so whitespace-only output can't mask a stall; (3) large tool inputs (create-extension / update-extension HTML) are preserved verbatim in continuation history instead of degrading to a lossy placeholder, so the agent can keep refining; (4) the run-manager terminal/auto_continue event seq is stamped at emit time so late events can't collide and silently drop the continuation signal.
- a456cf8: Use provider-specific agent output-token caps and continue agent runs after max-token stops.
- a456cf8: Surface inactive Builder access-token gateway errors as reconnectable Builder auth failures.
- a456cf8: Add a reconciled client state hook and further compact agent prompt context.
- a456cf8: Reduce default agent token budgets and trim always-on prompt context for routine requests.

## 0.25.0

### Minor Changes

- ed1502b: Add "Upload Skill" option to the resources create menu so users can import an existing SKILL.md file.

## 0.24.10

### Patch Changes

- fb600a2: Harden agent chat continuation across serverless timeouts. Fixes several cases where a turn that hit a timeout would error or stall instead of resuming: (1) a tool still in flight when the timeout fires now counts as progress, so the client no longer gives up in ~2s with "connection kept failing" while the server is actively working; (2) the empty-continuation cap is measured by real content (not bare part count) so whitespace-only output can't mask a stall; (3) large tool inputs (create-extension / update-extension HTML) are preserved verbatim in continuation history instead of degrading to a lossy placeholder, so the agent can keep refining; (4) the run-manager terminal/auto_continue event seq is stamped at emit time so late events can't collide and silently drop the continuation signal.

## 0.24.9

### Patch Changes

- 5ae4924: Cap the per-message `<current-screen>` context so a large `view-screen` snapshot (e.g. a recording/meeting page returning a full transcript + every segment) can no longer overflow the model context window and hard-error the chat with `context_length_exceeded`. The screen snapshot injected into every user message is now bounded to ~24K chars with a note pointing the agent at `view-screen` / data actions for full detail. This fixes brand-new chats failing on the first message and the very high time-to-first-token caused by an oversized ambient context.

## 0.24.8

### Patch Changes

- aa80e15: Clamp hosted run soft timeouts below upstream hard walls and surface Anthropic tool input progress.
- aa80e15: Add shared default social image metadata helpers and SSR injection.
- aa80e15: Update the open source badge copy to mention Agent Native is 100% free and open source.
- aa80e15: Keep the chat composer scrolled to the caret when inserting Shift+Enter line breaks.
- aa80e15: Recover client API paths from the live workspace mount when a stale app base path points at another workspace app.
- aa80e15: Stop losing agent chat turns that span a serverless timeout. A turn that is cut off mid-stream (the Builder gateway's 45s wall or the function/heartbeat limit) and resumed via auto-continuation now folds every continuation run onto a single durable assistant message keyed by a stable `turnId`, instead of each run persisting only its own events and dropping the earlier text. This fixes the "the agent stopped, then the last paragraphs disappear and it says it's just getting started" failure: the streamed text and completed tool calls are preserved in `thread_data` (monotonic, never-shrinking) so reloads and follow-up turns keep full context. Errored/cut-off runs are also now classified (`error_code`/`error_detail`) and retained longer than completed runs so failure patterns can be analyzed.
- aa80e15: Inject the default Agent-Native social image into SSR HTML when templates do not provide an OG image.
- aa80e15: Harden workspace scaffold test cleanup against transient filesystem races.

## 0.24.7

### Patch Changes

- 5355ff0: Keep the optional undici import out of browser and template build graphs.

## 0.24.6

### Patch Changes

- 1c28701: Allow extension key resolution to fall back to scoped app credentials after vault secrets miss.

## 0.24.5

### Patch Changes

- 32bb63c: Remove browser-facing ACCESS_TOKEN auth gates and keep static bearer tokens limited to MCP/connect fallback clients.

## 0.24.4

### Patch Changes

- 4b91db4: Block raw database tools from writing app-defined identity and access-control data.

## 0.24.3

### Patch Changes

- daeb0a9: Add custom migration plan inputs for AEM, Builder, headless, jQuery, and verification planning.
- daeb0a9: Harden chat thread pin and archive updates with owner checks and client rollback on failure.

## 0.24.2

### Patch Changes

- ff0fae2: Allow Brain and Dispatch sidebar chat threads to be renamed from their row menu.
- ff0fae2: Add fresh-start chat surfaces plus chat thread pin/archive metadata.
- ff0fae2: Generalize the onboarding copy for image generation provider key setup.
- ff0fae2: Keep framework routes registered through the H3 shim visible to Nitro 3 generated server dispatchers.
- ff0fae2: Promote Brain and Assets in public template catalogs and Dispatch workspace template defaults.
- ff0fae2: Render workspace app menu links with the same template icons used by the desktop app.

## 0.24.1

### Patch Changes

- 7aa1703: fix builder connect 401 for unauthenticated users with a valid connect token

## 0.24.0

### Minor Changes

- 9f3a798: Add extension history snapshots, diffs, and restore support.

### Patch Changes

- 9f3a798: Return 401 for unauthenticated private page routes while still rendering the sign-in page.
- 9f3a798: Recover agent chat runs that time out while preparing extension action input.
- 9f3a798: Keep chat recovery retries anchored to the original user request and give hosted timeout recovery more room to persist.
- 9f3a798: Preserve generated chat titles when later thread saves update chat metadata.
- 9f3a798: Keep lazy gateway wake pages active until app dev servers return HTTP responses.

## 0.23.0

### Minor Changes

- 2ea399e: Add app-backed skill packaging and CLI support for hosted/local app skill installs.

### Patch Changes

- 2ea399e: Rename the Images template/package to Assets, preserve legacy aliases, and add DAM/video generation capabilities.
- 2ea399e: Add chat-surface controls for hidden thread tabs and centered empty composers.
- 2ea399e: Clarify deployment, scaffold, skill, and template guidance for persistent databases and provider-agnostic Drizzle code.
- 2ea399e: Expose selected Dispatch workspace skills, resources, and MCP server definitions to granted app agents at runtime.

## 0.22.45

### Patch Changes

- 4bed290: Harden collaborative editing against missed updates and concurrent Yjs persistence races.

## 0.22.44

### Patch Changes

- 7ca6c99: Allow UI-submitted agent chat messages to include image data.

## 0.22.43

### Patch Changes

- bcf54ce: Fix race condition in `useChatThreads` that dropped the active general chat when the user navigated into a scoped resource before `GET /threads` resolved. The scope-flip rehydration effect now defers the decision when thread metadata is unknown (instead of falling through and swapping to the scoped storage key), so the visible conversation is preserved until threads load and a real decision can be made.

## 0.22.42

### Patch Changes

- 5f82202: `open_app({app: "<id>"})` now defaults to the app's home page (`/`) when neither `view` nor `path` is given, instead of throwing `requires 'app' and either 'view' or 'path'`. Hosts (ChatGPT / Claude) previously wasted a turn on the model's first-attempt retry whenever it omitted view/path; this lands the embed on `/` first try.
- 5f82202: Re-export `deleteOrHideExtension` and `hideExtensionForCurrentUser` from `@agent-native/core/client/extensions` so templates that wrap the extensions system (e.g. Workbench Custom Tools) don't have to deep-import internals. Also add CLI templates-meta entry for the new hidden `workbench` template.

## 0.22.41

### Patch Changes

- c790686: Fix MCP App embed regression: `create_embed_session` (and any tool with `_meta.ui.visibility: ["app"]`) now surfaces its raw result via `structuredContent` so the embed iframe can read the mint `startUrl`.

  Without this, PR #875's text-side embed-URL purge stripped the embed start URL from the only fallback the iframe had, breaking the "open inline" flow with "This app can be opened, but not embedded from this MCP server." Compliant hosts already honor the `visibility: ["app"]` hint and keep the tool result out of the LLM transcript; the structuredContent path is safe for these tools.

## 0.22.40

### Patch Changes

- 4a8e279: Route MCP App embed open links through the desktop deep-link handler.

## 0.22.39

### Patch Changes

- 1ed3ef8: Clear MCP app host generate loading state after direct host sends and fall back to the wrapper relay when direct sends fail.

## 0.22.38

### Patch Changes

- 9e22f33: Harden MCP host integration against ticket and content leaks. Strip embed-ticket URLs from any tool result text even when the action does not declare `mcpApp.resource`. Filter `embedTargetPath`, `embedExpiresAt`, and `ticket`-like fields from MCP structured content (their legitimate carrier is `_meta["agent-native/embedStart"]`). Stop fabricating an `_meta["agent-native/openLink"]` `webUrl` from a bare view name like `"deck"` when the action returns only an embed-start URL. Remove the now-unused `compose` field from `buildDeepLink` so deep-link URLs cannot inline draft contents. Make `isEmbedMcpChatBridgeActive` keep the in-memory bridge flag once enrolled so sandboxed iframes that deny sessionStorage no longer silently drop chat-bridge mode mid-session.

## 0.22.37

### Patch Changes

- 12d3c0f: Fix MCP app host catalog and embed metadata edge cases.

## 0.22.36

### Patch Changes

- 1c0b51e: Add ShareButton options for template-specific access labels and top-positioned share links.
- 1c0b51e: Fix MCP app host context clearing, compact catalog compatibility, and embed-only open-link metadata.
- 1c0b51e: Keep general chat threads visible when navigating into scoped resources.
- 1c0b51e: Keep MCP App host catalogs compact by default, hide one-time embed tickets from model-visible output, and keep host follow-up prompts separate from hidden context.
- 1c0b51e: Bust cached MCP App shells so hosts load the refreshed embed wrapper.
- 1c0b51e: Improve ShareButton member autocomplete with server-side org-member search, pagination, and keyboard selection.

## 0.22.35

### Patch Changes

- 6f76cbe: Bust cached MCP App shells so hosts load the refreshed embed wrapper.

## 0.22.34

### Patch Changes

- bc9c866: Recover built-in auth marketing copy from hosted app request context.
- bc9c866: Use branded first-party auth pages when the default auth guard serves before a template plugin.
- bc9c866: Fix MCP Apps metadata and extension-page embeds for Claude and ChatGPT hosts.
- bc9c866: Keep default SSR HTML cache headers public even when requests include auth cookies.

## 0.22.33

### Patch Changes

- d0a107e: Default MCP Apps hosts to the compact generic app catalog instead of listing every action-specific UI resource.
- d0a107e: Refuse to auto-bind CLI actions when multiple dev session owners exist.

## 0.22.32

### Patch Changes

- 5c6b741: Emit MCP App widget domain metadata so ChatGPT can render submitted app templates.

## 0.22.31

### Patch Changes

- 11362a2: Keep MCP App resource listing resilient to CSP metadata failures and invalid Dispatch app URLs.

## 0.22.30

### Patch Changes

- 3b1a0e5: Accept nested `params.embed` and `params.chrome` values in MCP `open_app` calls.

## 0.22.29

### Patch Changes

- a899300: Allow MCP App embed fetches to follow Agent-Native open redirects in Claude.

## 0.22.28

### Patch Changes

- 4a5dc8d: Retry transient agent-chat route-missing startup responses and harden Dispatch MCP embed fallback behavior.

## 0.22.27

### Patch Changes

- 5986cd0: Keep MCP Apps resource CSP and permissions on UI resources instead of tool descriptors.
- 5986cd0: Add a reusable interactive starfield background with subtle cursor attraction.

## 0.22.26

### Patch Changes

- 0efeaec: Allow Dispatch-routed MCP app embeds to authenticate target apps with synced org A2A secrets.

## 0.22.25

### Patch Changes

- b76bf4f: Bust MCP App shell resource caches so host CSP metadata refreshes after embed changes.

## 0.22.24

### Patch Changes

- b275383: Allow MCP app embed wrappers to connect to configured frame domains so Claude can transplant cross-app embeds.

## 0.22.23

### Patch Changes

- 75223dd: Fix Dispatch-routed MCP App embed sessions and surface embed helper errors in the wrapper.
- 75223dd: Expose current extension ids to agents and wait for tracked async framework plugins before dispatching first serverless requests.

## 0.22.22

### Patch Changes

- 1a9d1c0: Mint same-app MCP embed sessions during app launches so Claude can render embedded apps without iframe-originated tool calls.

## 0.22.21

### Patch Changes

- 56e5abc: Use Claude single-frame transplant rendering and ChatGPT controlled route frames for MCP App embeds.

## 0.22.20

### Patch Changes

- 7918065: Default Agent-Native SSR page responses to public cache headers with short max-age, week-long stale-while-revalidate, and hour-long stale-if-error, without creating sessions for anonymous page hits.
- 7918065: Improve MCP App route embeds by using signed real app routes across hosts, preserving host chat bridge state, controlling ChatGPT route height, and mounting the real signed app document inside Claude's proxied MCP content frame.
- 7918065: Make MCP app embeds default to 560px, shrink toward the host-visible height, and cap dynamic resize reports at the configured embed height.

## 0.22.19

### Patch Changes

- 1750384: Make MCP App embeds navigate the host frame into the real app route, keep the MCP chat bridge alive after embed-token redirects, and cache-bust the shared MCP App shell resource.

## 0.22.18

### Patch Changes

- bf1cb24: Expose MCP App CSP metadata, compact unknown OAuth app hosts, support ChatGPT's window.openai bridge, and show a Claude-safe fallback when nested app frames are blocked.

## 0.22.17

### Patch Changes

- 5173662: Add COEP-compatible dev headers for MCP embed page loads.
- 5173662: Emit Cross-Origin-Embedder-Policy for validated MCP embed-session page loads.
- 5173662: Relax Cross-Origin-Resource-Policy for validated MCP embed-session page loads.
- 5173662: Allow MCP app runtime requests to resolve validated embed-session cookies.
- 5173662: Allow MCP App full-app embeds to load in hosted chat clients with stricter iframe and resource policies.
- 5173662: Lower default full-app MCP App embeds to a 720px app viewport.
- 5173662: Allow MCP app embeds to load resources from the request origin.
- 5173662: Prevent same-origin 401/403 responses from causing client retry storms.

## 0.22.16

### Patch Changes

- 6de0eaf: Fix `/assets/*` 404s in production builds. The React Router client build is now
  copied into Nitro's `publicDir` before `nitroBuild` runs, so the static-asset
  manifest baked into the server bundle includes hashed JS/CSS chunks. Previously
  the copy happened after `nitroBuild`, leaving the files on disk but invisible to
  Nitro's runtime `serveStatic` handler — every `/assets/*` request fell through
  to the SSR catch-all, which 404s any path with a file extension.

## 0.22.15

### Patch Changes

- 0ba051e: Relay `sendToAgentChat()` submissions from MCP App embeds to compatible chat hosts.
- 0ba051e: Prevent HEAD probes from consuming one-time MCP app embed tickets before iframe navigation.
- 0ba051e: Add client helpers for MCP App host integration.
- 0ba051e: Add an embedRoute helper that pairs action deep links with MCP App resources.
- 0ba051e: Add a ShareButton hook for hiding organization-link resources from discovery.

## 0.22.14

### Patch Changes

- b09db79: Prevent unavailable optional agent engines from being selected by chat model pickers or explicit runtime overrides.

## 0.22.13

### Patch Changes

- 0b4ade2: Use the official Gemini 3.5 Flash model ID for the Google provider.
- 9482ec9: Harden serverless database pool cleanup and chat thread conflict retries.
- 54f295b: Make MCP App embeds launch real app routes reliably and keep web-host discovery compact.

## 0.22.12

### Patch Changes

- c43d534: Fix MCP App full-app embed launching through open routes and keep app-host discovery compact.

## 0.22.11

### Patch Changes

- e3b219b: Emit compact MCP Apps tool catalogs for OAuth app hosts and include ChatGPT-compatible widget metadata for real app embeds.

## 0.22.10

### Patch Changes

- ce325de: Include chat session context in feedback submissions and harden chat debug clipboard actions.

## 0.22.9

### Patch Changes

- e834a27: Improve MCP App embed startup reliability.

## 0.22.8

### Patch Changes

- bbaa675: Allow MCP App frame CSP sources emitted by the built-in app embed helper so local and HTTPS app frames render correctly, and expose the helper through the browser-safe core entry used by template actions.
- bbaa675: Clarify MCP app embeds can target focused app routes as well as full app surfaces.
- bbaa675: Request taller full-app MCP App embeds.
- bbaa675: Prevent replayed chat history with interrupted tool calls from sending malformed tool-use messages to model gateways.

## 0.22.7

### Patch Changes

- 2fcecb9: Fix `backfillEngineMessagesToolResults` so a `tool-result` is only paired with `tool-call`s from assistant messages that appeared earlier in the conversation. The previous global lookup overwrote earlier entries when ids collided (e.g. reused `continuation_tc_*` ids after adapter recreation), causing older history to be backfilled with the wrong `tool_name` / `tool_input` and sent that way to the Builder LLM gateway.
- 2fcecb9: Include `tool_name` and `tool_input` on every `tool_result` sent to the Builder LLM gateway (Gemini compatibility), backfill from prior `tool_use` when replaying history, add gateway client identification headers, and require `toolName`/`toolInput` on engine tool-result parts. Preserve unmatched structured-history tool results as text (then run `backfillEngineMessagesToolResults`) so replay never drops that payload before backfill runs. `backfillEngineMessagesToolResults` now turns orphan engine `tool-result` parts into the same replay text (instead of silently dropping them), and structured history coerces legacy non-string `toolCallId` / `content` shapes from stored JSON.

## 0.22.6

### Patch Changes

- 789ba7d: Clarify starter app creation guidance, seed app descriptions, and remove starter/new-app leftovers from starter-derived apps.
- 789ba7d: Add Dispatch unified MCP gateway guidance and app-grant controls.
- 789ba7d: Add MCP App full-app embedding with short-lived browser sessions.
- 789ba7d: Ignore test files when discovering and generating runtime action registries.
- 789ba7d: Skip stored AI SDK agent engines when their optional runtime packages are not installed.

## 0.22.5

### Patch Changes

- 7873242: Clear the chat attachment drop overlay when editor-level drops consume the drop event.
- 7873242: Resolve Builder assistant credentials from a single complete user/org/workspace scope so partial personal rows do not hide org-shared connections.
- 7873242: Start fresh chats on new browser/project surfaces instead of auto-opening the latest server thread.
- 7873242: Sanitize resent email verification callback URLs before forwarding to Better Auth.

## 0.22.4

### Patch Changes

- b5fc3b7: `/_agent-native/mcp/connect` now leads with the no-CLI path: the remote MCP URL is shown with a copy button, and a Claude/ChatGPT/Cursor/Claude Code/Codex/Other tab strip walks users through each host (paste-the-URL for OAuth hosts, one-line `claude mcp add` / `npx @agent-native/core connect` snippets for CLI hosts) so non-developers can connect a chat host without ever opening a terminal. The static-token mint flow and connections list keep their existing endpoints; tests cover the new sections.

## 0.22.3

### Patch Changes

- 5a5b620: Isolate local dev auth cookies per app and stop first-party hosted apps from sharing incompatible agent-native.com session cookies.
- 5a5b620: Derive production workspace auth and OAuth signing secrets from A2A_SECRET when explicit auth secrets are not configured.

## 0.22.2

### Patch Changes

- 4a35c70: Preserve MCP Apps metadata during static action discovery and write hosted Codex MCP installs as HTTP server entries.

## 0.22.1

### Patch Changes

- 570923a: Respect the persisted agent chat sidebar state inside Builder frames.
- 570923a: Persist mutating action change markers so child-process actions refresh custom app UIs.

## 0.22.0

### Minor Changes

- 819cf59: Add standard remote MCP OAuth discovery, authorization-code + PKCE, refresh-token rotation, scoped MCP access tokens, and OAuth-native `agent-native connect` config for Claude Code clients.

### Patch Changes

- 819cf59: Improve custom app action sync defaults and starter guidance.
- 819cf59: Honor collapsed agent-sidebar deep links when an already-mounted app receives the URL hint.
- 819cf59: Mount the local agent sidebar before delivering programmatic chat submissions so prompts are not dropped when the sidebar starts closed.
- 819cf59: Address MCP app route hardening and Dispatch vault cleanup edge cases from review.
- 819cf59: Fix dev-mode agent feedback issues around connection-reset overlays, request-scoped shell identity, and assistant markdown rendering.
- 819cf59: Sign Builder connect URLs rendered in chat cards and return gateway callbacks to the preview opener.
- 819cf59: Add granular extension content edits with marker/section operations and optional Prettier formatting.

## 0.21.0

### Minor Changes

- 65d43fd: Add host-side MCP Apps rendering support for connected MCP tools.

### Patch Changes

- 65d43fd: Add `agent-native connect dev` and `agent-native connect prod` for switching first-party MCP entries between hosted apps and local dev-lazy gateways.
- 65d43fd: Add optional MCP Apps UI resources for action tools while preserving deep-link fallbacks.
- 15d9967: Clean up synced Dispatch vault secrets on delete and make DB timeout cleanup awaitable.

## 0.20.9

### Patch Changes

- 482e9db: Make agent chat recovery continue after useful tool progress instead of prematurely surfacing connection failures.
- 482e9db: Add an interactive hosted-app picker when `agent-native connect` is run without a URL, and default connect-minted MCP tokens to a 365-day lifetime.
- 482e9db: Bound every DB init/query op with a timeout (`withDbTimeout`, `DB_OP_TIMEOUT_MS`, default 8s on serverless). A frozen→thawed serverless instance could leave the Neon WebSocket hung mid-query so the promise never settled and never errored — `retryOnConnectionError` only retries thrown errors, so authenticated requests (which run a session lookup on every navigation) hung until the platform killed the function (~30s on Netlify), surfacing as "the site won't load". The timeout reports as a retryable `CONNECT_TIMEOUT`, so the existing retry and reject-reset paths recover and the cached session-table init promise no longer stays poisoned. Also drop a failed/hung `getDbExec` init promise so the next call retries a fresh connection instead of re-awaiting a permanently rejected/pending one.
- 482e9db: Add SEO-friendly extension URLs with generated name slugs and extension page titles.
- 482e9db: Keep auth endpoints responsive when agent chat startup stalls, and expose framework session cookie helpers for custom auth plugins.

## 0.20.8

### Patch Changes

- a07d19c: Fix session.orgId always being undefined

## 0.20.7

### Patch Changes

- e06d8ab: Keep Builder iframe Google sign-in on the popup path when redirects cannot work.

## 0.20.6

### Patch Changes

- 52adc2d: Keep Builder.io connect popups alive when the click-time status refresh fails by falling back to the recently fetched signed connect URL.

## 0.20.5

### Patch Changes

- a470349: Clear the chat drop overlay when the composer consumes dropped files.

## 0.20.4

### Patch Changes

- dab88cd: Prevent dropped screenshots in the agent composer from attaching twice.

## 0.20.3

### Patch Changes

- 76b5268: Stop closed agent sidebars from mounting hidden polling surfaces on page load.

## 0.20.2

### Patch Changes

- f343737: Use the shared popover primitive for the composer model picker and keep the menu stable while model groups expand.
- f343737: Fall back to redirect Google sign-in when the popup OAuth window is blocked.
- f343737: Quiet Builder credential and engine detection diagnostics unless debug tracing is enabled.
- f343737: Prompt for target agent clients during `agent-native connect` and remember the selection.
- f343737: Soften the MCP connect authorization UI and collapse existing connections by default.

## 0.20.1

### Patch Changes

- 6f3002f: Prevent integration retry timers from keeping Netlify function invocations open and retry Postgres connection timeouts.

## 0.20.0

### Minor Changes

- 3eb86c8: Add shared Code chat transcript replay, prompt attachment helpers, and injectable AssistantChat runtime adapters.

### Patch Changes

- 3eb86c8: Allow extensions to resolve vault-backed keys from the active workspace and mirror Dispatch vault saves into the shared credential store.
- 3eb86c8: Respect externally supplied Builder-backed model availability in the shared composer model picker.
- 3eb86c8: Preserve spaces between streamed Agent-Native Code transcript chunks.
- 3eb86c8: Collapse the agent sidebar by default when opening external-agent deep links.
- 3eb86c8: Bound agent chat startup/history size and surface stalled or quota-capped runs instead of retrying forever.

## 0.19.3

### Patch Changes

- 39b4db3: Harden and complete external-agent MCP connect flows for hosted and local apps.
  - A connect-minted token (or `mcp install` / ACCESS_TOKEN / production caller)
    now gets the full MCP tool surface — including mutating template actions
    like `create-document` — even in local dev, matching the documented
    external-agents contract. Previously a connected Claude Code/Codex/Cowork
    only saw framework builtins in dev, so "say it and it does it" didn't work
    against a local app.
  - `list_apps` now reports the live request origin and `running: true` for the
    app serving the request, instead of a guessed `PORT || 5173` URL with
    `running: false` (which mis-pointed cross-app deep links on non-default
    dev ports).
  - The in-app Connect page now auto-refreshes "Your connections" after a
    device authorize, so the new connection appears (with a "Connected"
    confirmation) without a manual reload.

## 0.19.2

### Patch Changes

- 046a8f2: Improve the external-agent connect screen hierarchy and device-code presentation.

## 0.19.1

### Patch Changes

- 310c02f: Add context-aware dynamic prompt suggestions to the agent chat empty state.
- 310c02f: Tighten read-only bash command guards and scope org-directory/A2A routing auth by caller org identity.
- 310c02f: Reduce production Sentry noise from expected transport and authorization errors.
- 310c02f: Share the minimal bash/read/edit/write coding tool profile between Agent-Native Code and sidebar development mode.

## 0.19.0

### Minor Changes

- b3de2db: Cross-app SSO ("Sign in with Agent-Native", Dispatch as identity authority).
  New opt-in env `AGENT_NATIVE_IDENTITY_HUB_URL`: when set, an app exposes
  `/_agent-native/identity/login` + `/callback`, redirects to the hub's
  `/_agent-native/identity/authorize`, verifies the short-lived `A2A_SECRET`-
  signed identity token (strict `scope:"identity"`, single-use CSRF state,
  `iat`/`exp` bounds), and **JIT-links to the local Better Auth user strictly by
  verified email** — existing same-email user is linked (additive `account` row
  via the adapter; the user/session rows are never modified, renamed, or
  deleted), new email is created via the normal signup path — then mints a normal
  local session. Unset = zero behavior change (fully reversible; per-app canary
  via one env var). Identity rows are only ever added to, so rolling this out
  logs users out once and they log back into the _same_ account with data intact.
  Includes the `redirect()` staged-`Set-Cookie`-on-302 fix so the session
  survives the federated callback. The Dispatch-side identity authority lives in
  the (private) dispatch template.
- b3de2db: Frictionless connect for external agents. New `agent-native connect <url>`
  (and `connect --all`) drives an OAuth-style device-code flow: a logged-in
  browser session mints a per-user, scoped, **revocable** MCP token (an
  `A2A_SECRET`-signed JWT with a `jti`) and the CLI writes the HTTP MCP server
  entry for every detected client (Claude Code desktop/CLI, Codex, Cowork) — no
  shared secret copying, no local server. Adds the framework-served
  `/_agent-native/mcp/connect` page + token mint / device-code / list / revoke
  endpoints (mounted by the core routes plugin, gated by `disableMcpConnect`),
  two additive framework tables (`mcp_connect_tokens`, `mcp_device_codes`), a
  `jti` revoke check in the MCP `verifyAuth`, and an optional `extraClaims` on
  `signA2AToken`. Connecting to hosted apps is now the primary documented path;
  local-dev `mcp install` / stdio remains as the advanced path.

### Patch Changes

- b3de2db: Fix local-dev zero-setup auto-sign-in: the session cookie is now emitted on
  the 302 itself. `maybeAutoCreateDevSession` returned a bare
  `new Response("", { status: 302, headers: { Location } })` after staging the
  session cookie via `setFrameworkSessionCookie`. h3 v2's `prepareResponse`
  only merges the event's staged response headers into a returned web
  `Response` when that Response is 2xx — its `!val.ok` early-return hands a
  non-2xx Response (like a 302) back as-is, dropping the staged `Set-Cookie`.
  A fresh `pnpm dev` therefore 302'd straight to the app and bounced back to
  the login form. A new `redirectWithStagedCookies` helper mirrors the staged
  cookies onto the redirect Response's own headers so the 302 actually carries
  the session.

  Also hardens the dev auto-account so the convenience can't become an
  exposure: it now (1) only fires for **loopback** requests — a new shared
  `isLoopbackRequest` helper (also adopted by the desktop-SSO broker) so a
  tunnelled / reverse-proxied / misconfigured-non-prod dev server never
  auto-signs-in a remote visitor; and (2) mints a **random per-DB password**
  printed to the server console once, instead of the source-code-known fixed
  `local-dev-account`, so there is no shared credential to reuse. Still gated
  on `NODE_ENV` and `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`.

- b3de2db: Remove the "Effective context" card grid from the resources editor and replace the section-title hover tooltips (Workspace / Organization / Personal) with a dedicated small help icon. The inherited Workspace section is now hidden unless workspace context exists.
- b3de2db: Share composer submit intent, transcript normalization, and conversation scroll primitives with Agent-Native Code.

## 0.18.1

### Patch Changes

- 24049a6: External-agent bridge follow-up fixes: add `/_agent-native/mcp` to the auth
  bypass allowlist so the stdio proxy / external MCP clients reach the endpoint's
  own `verifyAuth` (was 401); static `ACCESS_TOKEN` requests now carry caller
  identity via `AGENT_NATIVE_OWNER_EMAIL`/`X-Agent-Native-Owner-Email`; `open_app`
  / `create_workspace_app` use the target app origin and `ask_app` routes
  cross-app over A2A honestly; validate decoded compose `draft.id` in
  `/_agent-native/open`; swallow benign post-flush `ERR_STREAM_WRITE_AFTER_END`;
  fix the local-dev auto-account email (`dev@local` → `dev@local.test`, rejected
  by better-auth 1.6.0) with legacy dual-exclusion.

## 0.18.0

### Minor Changes

- 921715a: Seamless bridge to external coding agents (Claude Code, Cowork, Codex). Actions
  gain an optional `link` builder; MCP tool results now append an "Open in … →"
  deep link (`_meta["agent-native/openLink"]` + markdown). New
  `/_agent-native/open` route bridges those links to the existing
  `navigate`/`application_state` mechanism, scoped to the browser session. Adds
  `buildDeepLink`/`toAbsoluteOpenUrl`/`toDesktopOpenUrl` helpers, an
  `agent-native mcp` CLI (serve/install/uninstall/status/token) with stdio
  transport + one-command install for Claude Code/Codex/Cowork, and generic
  cross-app MCP tools (`list_apps`, `open_app`, `ask_app`, `create_workspace_app`,
  `list_templates`). All additive and backward compatible.

## 0.17.2

### Patch Changes

- 480c078: Cap the Postgres connection pool to a single connection per instance on serverless runtimes (Netlify Functions / AWS Lambda). Concurrent frozen Lambda instances each holding postgres.js's default 10-connection pool were exhausting Neon/Postgres' connection limit, causing "Max client connections reached" and HTTP 500s on every `/_agent-native/*` route. Long-lived Node servers keep the normal pool.

## 0.17.1

### Patch Changes

- 8b0a941: Fix agent sidebar resurrecting an old closed tab on refresh. When all tabs were closed down to a single new empty tab, reloading the page replaced it with the most-recent old conversation because the empty tab is never persisted server-side and the in-memory newly-created marker is wiped by the reload. The saved tab is now restored verbatim as an optimistic empty tab instead of falling back to an unrelated old chat. Stale (>12h) tab clearing is unchanged.
- 8b0a941: Composer toolbar: drop the leading pencil/clipboard icon from the Act/Plan mode picker, and hide the reasoning-level suffix ("· Auto") when the chatfield is narrower than 370px so the model name + version stays fully readable instead of truncating. The reasoning level is still reachable via the model picker popover. Also alias `@agent-native/core/styles/agent-native.css` to source in dev so CSS edits take effect live instead of silently loading the stale built copy.
- 8b0a941: Refine Demo Mode redaction: only coerce a name-key value to a fake name when it's a 2–4 word person name (mail labels/tabs like "Important" no longer mangled); stable mappings via a bounded, TTL'd, leak-free cache plus produced-fake idempotency so names/emails don't drift when a draft is edited and refetched; realistic stand-in email domains instead of example.com; protect SQL/query/expression/code keys so analytics panel queries aren't corrupted by redaction (chart titles/names still faked, queries run intact); fetch interceptor hardened to be a zero-overhead pass-through when demo mode is off and to never touch agent/run/streaming transport. Plus DemoModeSection/action-routes wiring and tightened TiptapComposer, use-chat-threads, and use-db-sync behavior.
- 8b0a941: Fix Google sign-in popup showing "[object Object]" instead of redirecting to Google. The `/_agent-native/google/auth-url?redirect=1` path used h3 v2's `sendRedirect`, which (in `2.0.1-rc.20`) ignores the event and returns a non-standard `HTTPResponse` instance; the request-handler shim stringified it to `[object Object]` with a 200 status and no `Location` header. It now returns a native web `Response` 302, matching the proven OAuth response idiom used by the callback route.

## 0.17.0

### Minor Changes

- a21633b: Add demo mode: a settings toggle / `toggle-demo-mode` agent action / `DEMO_MODE` env that deterministically replaces real names, emails, and numbers with realistic fake data in every action result — for both the UI and what the agent sees. IDs, dates, URLs, and structure are preserved (protect-first tokenization + key denylist) so the app keeps working. The redaction walk is fully gated and only runs when demo mode is on.

## 0.16.3

### Patch Changes

- dbf8db4: Tag Builder connect URLs with Agent Native signup source and flow attribution.
- dbf8db4: Expose Agent Teams background runs through agent-chat Code hub-compatible run APIs.
- dbf8db4: Deliver queued Agent Teams messages to running sub-agents at safe continuation points.
- dbf8db4: Allow templates to answer inbound A2A messages through a deterministic fallback before loading an agent engine.
- dbf8db4: Add regression coverage for public A2A skills built from static action registries.
- dbf8db4: Expose local Agent-Native Code sessions through a shared background-agent run adapter.
- dbf8db4: Improve the Agent-Native Code shell intro and status context.
- dbf8db4: Polish the shared composer model menu and Code agent credential handling.
- dbf8db4: Add a reusable provider reader metadata registry for workspace connections.
- dbf8db4: Add a minimal provider reader runtime contract for granted workspace connections.
- dbf8db4: Track last-used audit metadata for reusable workspace connections and grants.
- dbf8db4: Add reusable runtime credential resolution for granted workspace connections.

## 0.16.2

### Patch Changes

- 5b9bdd7: Fix chat dictation: "auto" mode now uses browser-native SpeechRecognition when available, matching the macros-app record-button experience. Words stream incrementally into the composer with no server API key required. Explicit server providers (builder, gemini, groq, openai) are unchanged.

## 0.16.1

### Patch Changes

- 85d6554: Auto-hide sidebar tabs after 12 h of inactivity (previously 4 h, empty-only). Any tab inactive for more than 12 hours is now removed from the sidebar on load and the user is dropped into a fresh tab; older threads remain accessible via History.

## 0.16.0

### Minor Changes

- 79a0eb9: Add host bridge, React iframe helpers, screen context snapshots, typed live client actions, session metadata, approval gates, and host tool adapters for embedding Agent-Native sidecars in existing SaaS apps.
- 79a0eb9: Document the next Agent-Native Code follow-up features: session picker/run controls, permission modes, project slash commands, and migration as a Code workspace slash command instead of a template.
- 79a0eb9: Expose local Agent-Native Code run helpers and document the reusable Code UI/template flow.
- 79a0eb9: Add a batteries-included embedded Agent-Native runtime with host-auth server mounting, a React embedded sidebar/surface, and direct browser-session context/action registration.
- 79a0eb9: Add a SQL-backed browser-session bridge so embedded sidecars can register live host tabs, let backend agent tools inspect page context, run client actions, and send host refresh/navigation/remount commands.
- 79a0eb9: Add portable extension iframe and slot primitives for embedding SDK hosts, including manifest-gated permissions and storage adapters.

### Patch Changes

- 79a0eb9: Add org-scoped per-app default model settings for agent chat.
- 79a0eb9: Expose server-side agent loop helpers for template background workers.
- 79a0eb9: Register the Brain template in the public catalog and docs.
- 79a0eb9: Add scoped built-in MCP capability toggles for browser and computer-use servers.
- 79a0eb9: Record active Agent-Native Code follow-ups as steering or queued prompts.
- 79a0eb9: Default Agent-Native Code sessions to auto mode and add plan/auto CLI aliases.
- 79a0eb9: Expose package-provided actions through template action runners and add a full Dispatch Dreams settings editor.
- 79a0eb9: Add explicit shared composer layout variants and toolbar slot hooks.
- 79a0eb9: Expose Agent-Native Code project commands and skills as structured code-pack metadata.
- 79a0eb9: Build the core package before packing local file dependencies so generated framework workspaces install a fresh dist snapshot.
- 79a0eb9: Link the local Dispatch package during framework-development workspace creation and build Dispatch before local packing.
- 79a0eb9: Inherit Dispatch-managed workspace instructions, skills, and reference resources at runtime; seed and restore starter company, brand, messaging, guardrail, and voice resources; show and inspect each app's effective workspace context stack; gate All-app resource edits through Dispatch approvals when enabled; preview global impact and overrides before save; and expose read-only inherited workspace resources in app panels.
- 79a0eb9: Improve `/migrate` CLI handoff output with clearer Agent-Native Code resume commands and artifact guidance.
- 79a0eb9: Add the generic Agent-Native Code `/migrate` CLI entrypoint, any-input migration seeding, and own-agent dossier emit output for code-agent handoff.
- 79a0eb9: Export a reusable full-page agent chat surface backed by AgentPanel internals.
- 79a0eb9: Expose safe public-agent read-only actions in the unauthenticated agent surface.
- 79a0eb9: Expose shared workspace connection app-access semantics for reusable integrations.
- 79a0eb9: Add SQL-backed remote integration relay device, command, run-event, management, and push-registration endpoints.
- 79a0eb9: Remove legacy workspace-resource sync actions and clarify runtime inheritance docs.
- 79a0eb9: Add runtime inheritance contract coverage for workspace resources.
- 79a0eb9: Require authentication before dry-running arbitrary MCP server URLs.
- 79a0eb9: Add shared workspace connection app-grant and provider-readiness helpers for reusable integrations.
- 79a0eb9: Route Telegram `/code` commands from Dispatch to the remote code-agent relay.
- 79a0eb9: Add a typed workspace connection provider catalog for reusable integration metadata.
- 79a0eb9: Add scoped workspace connection grant storage and helpers for connect-once, grant-to-app integrations.
- 79a0eb9: Add scoped workspace connection metadata storage for connect-once-use-everywhere foundations.

## 0.15.14

### Patch Changes

- cbd1826: Keep extension previews fresh after agent-side edits and clarify chat recovery after repeated connection failures.

## 0.15.13

### Patch Changes

- 3fda479: Fix migration template dev-port collision (8100 → 8101), emit a single canonical for /docs and /docs/getting-started, and JSON-escape generated route paths so Next.js dynamic segments can't break scaffolded TSX.

## 0.15.12

### Patch Changes

- 2cb8220: Add Agent Web surface generators, public-agent action metadata, and an audit command for crawlable public routes.
- 2cb8220: Stop the Builder connect card from spinning after popup completion when status does not confirm credentials, and show Builder as the active LLM source when connected.
- 2cb8220: Add the Migration Workbench engine, hidden migration template, CLI entrypoint, and documentation for verified Next.js-to-agent-native migrations.

## 0.15.11

### Patch Changes

- 31b3ffe: Always refresh the Builder cli-auth URL inside a freshly-opened about:blank popup on web (desktop keeps direct path), add a stable `authError` field to BuilderStatus for persisted old-credential rejection, and keep Fusion/workspace-runtime deploy keys out of the identity fallback when a signed-in user is present.

## 0.15.10

### Patch Changes

- e2d812c: Keep Builder reconnect flows alive while replacing rejected deploy fallback credentials.

## 0.15.9

### Patch Changes

- 5b2488b: Fix: default the Builder API host fallback to `https://api.builder.io` instead of the unreachable `https://ai-services.builder.io`, so calls succeed when `BUILDER_API_HOST` / `BUILDER_PROXY_ORIGIN` / `AIR_HOST` are unset.

## 0.15.8

### Patch Changes

- 3084676: Handle Builder cli-auth callback fallback for preview hosts not in Builder's allow-list, surface rejected credentials on status / Settings, scope callback postMessage to the parent origin, and self-heal credential auth-failure markers after a successful gateway call.

## 0.15.7

### Patch Changes

- d4c9097: Polish Builder connect completion by avoiding loopback callback URLs and refreshing connected chat UI.

## 0.15.6

### Patch Changes

- 54e65a6: Keep Builder connect on the active preview deployment and route chat reconnect buttons through the signed popup flow.
- 54e65a6: Keep Builder CLI auth connect URLs fresh and preview-aware in embedded Builder editor contexts.

## 0.15.5

### Patch Changes

- 86dbcea: Refresh Builder connect links inside popup click flows and use Google OAuth popups for Builder iframes.

## 0.15.4

### Patch Changes

- Refresh Builder connect links inside popup click flows and use Google OAuth popups for Builder iframes.

## 0.15.3

### Patch Changes

- b2d1228: Use popup Google sign-in for Builder web iframes and bridge the returned session back into the embedded preview.

## 0.15.2

### Patch Changes

- 73dbe40: Allow signed Builder connect flows to complete through workspace gateway origins without requiring the iframe host's session cookie.

## 0.15.1

### Patch Changes

- 10dc17f: Improve Builder preview Google OAuth popup completion, diagnostics, and callback error propagation.
- 10dc17f: Keep the pre-hydration theme script's resolved data-theme in sync with the html class.

## 0.15.0

### Minor Changes

- f400c81: Two additions to core:
  - **`AppearancePicker` + `change-appearance` action.** New per-user appearance presets (`warm` / `ocean` / `forest` / `rose` / `slate` + the default) that override the base HSL theme tokens. The runtime reads `localStorage["appearance"]` in the inline theme-init script and sets `<html data-appearance="...">` before hydration, so there's no first-paint flash. Exports: `APPEARANCE_PRESETS`, `applyAppearance`, `getStoredAppearance`, `useAppearance`, `AppearanceSync`, `AppearancePicker`. The agent can change the active preset via the new `change-appearance` core sharing action — auto-registered through `mergeCoreSharingActions`, so every template inherits it.
  - **`guard-extension-no-public.mjs`.** New CI guard wired into `pnpm guards`. Statically refuses any change that drops `allowPublic: false` / `requireOrgMemberForUserShares: true` from the extension shareable registration, or that introduces a string literal / raw SQL flipping an extension row to `visibility = "public"` outside the framework-level `set-resource-visibility` action. `sharing` skill updated to document the two new registration flags and point at the guard.

- b5b6f22: New optional `emptyStateAddon` prop on `AssistantChat` — content rendered in the empty state above the suggestion buttons. Used by `MultiTabAssistantChat` to surface "previous chats for this design" when the current thread is empty but the scope has other threads. No behaviour change when the prop isn't passed.
- 2eb5064: `PromptComposer` + `TiptapComposer`: inline image attachments, attachment-only composer-mode sends, and active-voice cancellation on submit. Image files attached to the composer are now sent inline as `<uploaded-image name=… contentType=…>` data-URL blocks alongside the existing pasted-text / inline-text flattening. Composer modes (`/code`, `/research`, etc.) now also accept submissions with no text when attachments are present — the default prompt becomes "Use the attached context." and the attachments survive the wrap in the mode's prefix + `<context>` block. Every send / build intercept path also cancels any in-flight voice dictation so a late transcript can't land on top of the just-sent message.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` (plus `BuilderConnectFlow` / `BuilderConnectFlowOptions` types) from `@agent-native/core/client`. Both hooks already powered the in-framework SettingsPanel's Builder.io connect flow; surfacing them lets templates reuse the same status read + connect-flow state machine in their own settings UIs without duplicating the SSE / popup-handshake plumbing.
- f400c81: Polish + appearance presets:
  - Sign-in page: add a favicon `<link>` to the onboarding sign-in and reset-password HTML so tabs no longer show the default globe.
  - Sign-in page: suppress the on-screen Google OAuth status overlay ("OAuth exchange redeemed; returning to the app (flow …)" and friends) for end users. Diagnostics still log to the browser console; the overlay can be opted back in with `#oauth-debug` or `?oauth_debug=1` for debugging.
  - Feedback popover: placeholder now leads with concrete examples ("e.g. 'The Send button isn't obvious'…") so users have a clearer prompt than "Tell us what's on your mind…".
  - **New: Appearance presets.** Users can pick a color theme without editing source. Adds a `change-appearance` action (auto-mounted everywhere) that the agent can invoke as a tool, a `<AppearancePicker />` React component for Settings pages, a `useAppearance` / `useAppearanceSync` hook pair, and CSS preset overrides (`warm`, `ocean`, `forest`, `rose`, `slate`) layered on top of each template's base palette via `<html data-appearance="…">`. The theme init script now also applies the stored preset on first paint to avoid FOUC.
  - Agent system prompt now includes a short first-session personalization flow: greet, ask two yes/no questions (theme preset via `change-appearance` plus one template-specific preference), then mark `application_state.personalization = { done: true }` so it never re-asks.

- d1a90ac: Image uploads and drag-and-drop, framework-wide.
  - New `upload-image` agent action — converts a base64 data URL or remote URL into a hosted CDN URL via the active file-upload provider (Builder.io by default, or any provider registered with `registerFileUploadProvider` — S3, R2, GCS, etc.). Auto-registered for every template alongside the sharing actions; the agent now has an explicit tool to materialize chat-attached or generated images as stable URLs for slides, documents, and outbound messages.
  - File-upload registry now uses a `globalThis`-backed singleton. The previous module-level `Map` could be evaluated more than once in some Vite/Nitro bundle-split scenarios — the plugin that called `registerFileUploadProvider()` lived in one module instance and the request handler / server-side pre-upload lived in another, so the call site saw an empty map even though registration succeeded. Custom providers (S3/R2/GCS) and the dev-mode upload path now both see the same map regardless of how the bundler chunked them; Builder.io was unaffected because it has an env-var fallback in `uploadFile()`.
  - Server-side pre-upload of chat image attachments: when a user attaches an image to the agent composer, the framework now uploads it through `uploadFile()` before the model runs and injects a `<chat-image-attachment url="..." />` block at the bottom of the user message. The model still receives the image as multimodal vision content; it just also has the hosted URL to embed in HTML. If no provider is configured, the framework injects a `<chat-image-attachment-upload-error>` block instructing the agent to suggest connecting one.
  - Chat-wide drag-and-drop: the agent sidebar now accepts file drops anywhere on the chat surface (thread, header, composer), not just inside the contenteditable. A "Drop to attach" affordance highlights the chat while files are being dragged over it.
  - Slides drag-and-drop fixes: `/api/assets/upload` now routes uploads strictly through the framework `uploadFile()` provider chain. The previous local-disk path that wrote into `public/uploads/` is gone — it didn't persist on serverless deploys and polluted the source tree on dev runs. With no provider configured, the endpoint returns a clear 503 telling the caller to connect Builder.io (or any registered provider). `listAssets` / `deleteAsset` no longer scan local disk; listing is a no-op for now (until a SQL-backed asset index lands), and deletes go through the provider's own API. Drops anywhere on the slides editor — including the chrome and sidebars — are caught instead of letting the browser navigate to the file; drops outside a placeholder/`<img>` open a popover that hands the image off to the agent chat for the user to describe what to do with it.

- f400c81: Two related additions to the realtime + agent layer:
  - **Per-source change-version primitive.** New `useChangeVersion(source)` / `useChangeVersions(sources)` / `getChangeVersion` / `bumpChangeVersion` exported from `@agent-native/core/client`. Every `recordChange` event carries a `source` and `version`; `useDbSync` now bumps a per-source counter on each event and templates fold the counter into their React Query `queryKey`, so a change to `"dashboards"` only refetches dashboard queries instead of triggering a blanket cache invalidate across the app. Framework-level keys (`action`, `extension`, `application-state`, …) keep their universal invalidate; template data keys (`data`, `dashboards`, `analyses`, `dashboard-views`) no longer do — they react through the per-source counter. Analytics templates updated as the first consumer (CommandPalette / Sidebar / sql-dashboard / AnalysesList).
  - **Scoped chat tabs in `AgentPanel` / `MultiTabAssistantChat`.** New optional `scope?: ChatThreadScope | null` prop on `AgentPanel`. When set, the tab bar partitions per `(storageKey, scope)` so each deck / dashboard / record shows its own thread list, new chats inherit the scope server-side, and the panel renders a "Working on {label}" badge with a Detach button to escape back to the unscoped tab list. Pairs with the server-side `scope_type` / `scope_id` / `scope_label` columns + `setThreadScope` already in `chat-threads/store.ts`.

- ffd3d00: Add first-class workspace app audience metadata with route-level public/protected page access.
- d1a90ac: `ShareButton` now accepts an optional `shareUrlPlaceholder` prop. When the primary `shareUrl` is undefined the popover shows the placeholder inside a subtle dashed-border slot instead of hiding the link section silently. Use it to tell respondents _why_ there's no link yet (e.g. "Publish this form to get a public response link") so the popover doesn't look broken on draft / unpublished resources.
- 5f59f44: Browser tracking now sends a persistent `anonymousId` (visitor ID) and a `sessionId` with a 30-minute idle timeout on every event posted to the Agent Native Analytics `/track` endpoint. Both IDs are stored in `localStorage` and degrade gracefully to NULL when storage is unavailable (private browsing). Unique-visitor and session metrics in the analytics template now have real data to aggregate against; previously these columns were always NULL for anonymous traffic.
- c6defe7: Real-time sync, take 2: per-source change counters.

  The previous attempt — invalidating every active React Query on any non-own change event — caused a request storm on the analytics dashboard (461 pending requests, polls timing out at the 10s abort). This change replaces it with a targeted, default-on mechanism:
  - New `useChangeVersion(source)` and `useChangeVersions(sources)` hooks return an integer that advances every time the server emits an event with that source (`"dashboards"`, `"analyses"`, `"action"`, `"settings"`, `"app-state"`, etc.). `useDbSync` keeps a per-source counter and bumps it from every poll/SSE event it sees.
  - Templates fold the counter into the relevant React Query `queryKey`. When the source advances, the queryKey changes and React Query refetches that one query — no whole-cache invalidate, no fanned-out refetches across unrelated panels. `placeholderData: (prev) => prev` keeps the old data on screen during the refetch so there's no flicker.
  - `useDbSync` reverts to invalidating a small fixed list of framework-internal prefixes (`["action"]`, `["app-state"]`, `["__set_url__"]`, etc.) and no longer touches templates' own data queries. The legacy `queryKeys` option remains in the type signature for backward compatibility but is ignored.
  - Analytics' dashboard / analysis / sidebar / command-palette queries are wired up. Other templates can adopt the same pattern by importing `useChangeVersion` and including it in their query keys; recommended sources include `"dashboards"`, `"analyses"`, `"settings"`, and `"action"` (the agent runner emits `source: "action"` after every successful mutating tool call, so depending on it catches any agent-driven change to the underlying data).

- 5f59f44: New `usePinchZoom` hook exported from `@agent-native/core/client` for canvas-style editors. Wires trackpad pinch (synthesized as `wheel` events with `ctrlKey: true`) and 2-pointer touchscreen pinch onto a scrolling container, with cursor-anchored zoom-to-cursor support and configurable `min` / `max` percentages. The slides template adopts it on the deck-editor canvas; any template with a zoomable surface can drop it in by attaching the returned ref to the scroll container.

### Patch Changes

- d1a90ac: Agent chat: when the user sends a new message after scrolling up to read history, scroll back to the bottom so the new message and reply land in view. Previously the sticky-bottom override (which exists to stop streaming from yanking the viewport) also swallowed direct sends, leaving the user stuck in old history.
- ffd3d00: Emit agent sidebar open-state events so custom toolbar buttons can track when the chat panel opens or closes itself.
- d1a90ac: Local-dev convenience: skip the sign-up wall on a freshly-scaffolded app. When `NODE_ENV=development` and the `user` table has no rows for any email other than `dev@local`, the auth guard transparently signs up + signs in an auto-managed `dev@local` account on the first page GET and 302s back to the original URL with the session cookie set. A developer who just ran `pnpm dev` lands in the app immediately instead of being asked to fill in name + email + password to try the framework. Once a real user signs up via the regular form, the email-filter short-circuit fires and this helper returns null on every subsequent request, so the normal login flow takes over. Set `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1` to opt out.
- 5f59f44: Docs only: spell out the auto-refresh contract in the default-template and starter `AGENTS.md` so newly-scaffolded apps know that agent writes must reflect in the UI without a manual refresh. Use `useActionQuery` (auto-covered) or fold `useChangeVersions([<source>, "action"])` into raw `useQuery` keys. Mirror the framework `adding-a-feature` and `real-time-sync` skills into `packages/core/src/templates/default/.agents/skills/` and `templates/starter/.agents/skills/` so scaffolded apps inherit the same guidance.
- d1a90ac: Builder credential resolution: implicit-org fallback + trace logging.
  - `agent-chat-plugin`: when `session.orgId` is null (Better Auth leaves it null until the user explicitly switches orgs), fall back to `getOrgContext()` to pick up implicit org membership. A fresh signup with a domain-matched org now sees its org-scoped Builder credentials instead of looking unconnected.
  - `resolveSecret`: log every Builder credential lookup (`[resolve-secret]` lines covering hit/miss + scope + email + orgId). "I connected Builder but chat says no LLM" reports can now be diagnosed from server logs without rerunning the request. Other keys are gated behind `DEBUG_CREDENTIAL_RESOLVE=1` to keep noise low.
  - `core-routes-plugin` builder-connect: log the resolved write scope so we can see which scope (user/org/workspace) a connect actually persisted to.

- d1a90ac: Add inline "Start new chat" button to no-detail Builder gateway error messages. When the gateway returns `{type:"stop",reason:"error",requestId:...}` with no diagnostic, the error UI now renders a one-click CTA next to the message instead of just telling the user to start a new chat manually. The button dispatches an `agent-chat:new-chat` window event that `MultiTabAssistantChat` listens for, matching the existing close-tab event pattern.
- a89082e: Builder reconnect now clears stale credentials before writing the new connection, so reconnecting with a different Builder space actually takes effect.

  `writeBuilderCredentials` previously upserted each new key but left stale rows in place. Two failure modes:
  - Reconnecting with a Builder space that doesn't carry every optional field (e.g. no `orgName`/`orgKind`/`userId`) left the previous connection's metadata behind at the target scope, so the gateway saw a mix of new and old credentials.
  - When a user's first connect wrote at user scope (member or no-org) and a later reconnect wrote at org scope (now owner/admin), the old user-scope row still won resolution — user scope beats org scope by design — so the chat kept using the old Builder space's credentials even though the UI showed the new connection.

  Fix: before writing, delete all five `BUILDER_*` keys at the target scope, and when writing at org scope also delete the writer's user-scope rows. The org-scope row is intentionally left alone when writing at user scope so a single user's personal override doesn't blow away the team's shared connection.

  Reported as "I signed in again with my Builder space not my own one and still telling me I need to upgrade" on 2026-05-11.

- d1a90ac: `builderFileUploadProvider`: retry transient 5xx once with backoff (600ms then 1.8s).

  Builder.io's upload service occasionally returns a bodyless 500 ("Internal Error") on the first attempt — usually GCS write hiccups that succeed on retry. Three template surfaces that hit this on every recording / upload (Clips finalize, attachment uploads, generated-image uploads) now get those transient failures absorbed silently. Deterministic 500s still surface to the caller after the third attempt with the original status + body.

- ad4f135: Keep the in-app agent panel active inside Builder web previews instead of treating them as local dev frames.
- ffd3d00: Recover the agent panel automatically when assistant-ui renders a stale list index.
- ffd3d00: Clarify scoped chat context copy in the assistant sidebar.
- 64792af: Clarify Builder Cloud Agent waitlist guidance so agents do not send users to nonexistent org settings.
- d1a90ac: CLI + dispatch shell fixes from create-workflow feedback:
  - `create`: scaffold `packages/pinpoint` when the user selects `slides` or
    `videos`. Their `package.json` declares `@agent-native/pinpoint:
workspace:*`, but the templates-meta entries were missing
    `requiredPackages: ["pinpoint"]`, so `pnpm install` blew up with
    `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. The existing e2e test now covers
    every template with `@agent-native/*` workspace deps so a regression
    surfaces in CI instead of on the user's machine.
  - `create`: per-template progress messages during scaffolding
    (`Scaffolding Slides (3/4)...`, `Adding shared packages...`) and a
    concrete "this is done" stop message, replacing the single static
    "Working... no action needed" line that made a multi-app workspace
    feel hung.
  - `create`: detect `pnpm` on PATH before printing the outro. If it's
    missing, the next-steps block now leads with `npm install -g pnpm`
    instead of dumping the user at `zsh: command not found: pnpm`.
  - `create`: Dispatch is now always scaffolded into a new workspace
    rather than being a recommended-but-optional pick. The picker only
    lists the optional apps; the workspace note explains that Dispatch is
    always included as the control plane. `--template=forms` (or any
    non-Dispatch list) still works — Dispatch gets unioned in. New
    regression test asserts this.
  - Auth guard: local-dev convenience for `NODE_ENV=development`. When
    the `user` table has no real users yet, the first unauthenticated
    page GET transparently signs up (and signs in) a `dev@local` account
    and 302s back to the requested URL, instead of showing the sign-up
    form. A developer running `pnpm dev` lands straight in the app. Once
    any real account exists the auto-create short-circuit fires and the
    regular login flow takes over. Opt out with
    `AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1`. Production is unaffected.
  - `DispatchShell`: page-title info icon is now a click-driven Popover
    instead of a hover-only Tooltip, and the trigger button has a
    proper hover background so it reads as clickable. Clicking the icon
    (the natural gesture, and the only available one on touch) did
    nothing before.
  - `create`: clean up the partially-scaffolded directory when scaffolding
    fails (e.g. flaky network during the template download). Without this
    the first failure left the workspace dir on disk, and the next
    `agent-native create <name>` rejected the same name with "Directory
    already exists" — forcing a manual `rm -rf` before retrying.
  - Dispatch apps list: filter dotfile directories (e.g.
    `.agent-native-tmp-*` extraction sidecars) when reading the
    workspace's `apps/` directory. The temp dir is a sibling of the
    target so it appeared at the top of the apps grid mid-scaffold,
    looking like a stray entry.
  - Dispatch onboarding: register a "Create your first app" step at order
    5 so it sits above the Slack/Telegram secret-onboarding steps. A
    brand-new workspace was leading with "Connect Slack" before the user
    had even added an app, which felt confusing.
  - Agent system prompt (chat-in-browser-on-localdev): when a user asks to
    scaffold a new workspace app from a localhost browser tab, point them
    at \`npx @agent-native/core add-app\` first since they're already in
    that terminal. The desktop / Claude Code / Codex / Builder.io
    alternatives still follow for general source-editing work.

- ffd3d00: Add Cmd/Ctrl+Backslash as a global shortcut for toggling the agent sidebar.
- 04c3ed9: Coach users through stalled agent tasks with clearer troubleshooting and next-step guidance.
- b5b6f22: `TiptapComposer`: when a caller passes a custom `actionButton`, render only the model selector + plan-mode toggle on the left side (skipping the voice/file/send cluster that the default action-button slot owns). Without this, callers that already render their own send button got a duplicate-looking trailing block. No behavior change when `actionButton` isn't passed.
- 2eb5064: `AssistantChat`: hide the empty user-message bubble when the text content is nothing but an injected `<context>...</context>` block. Previously, sending an attachment-only composer-mode message (e.g. `/code` with a file but no prose) rendered an empty grey bubble in the chat after the context tags were stripped. The message now skips the bubble + expand/collapse UI entirely when the only attachment is context; attachment chips still render above.
- 2eb5064: `useDbSync` + server poll: per-key invalidation for application_state one-shot commands. The poll loop now emits one event per changed (key, owner) pair instead of a single `key: "*"` wildcard, and the client only invalidates `navigate-command` / `show-questions` / `__set_url__` queries when those specific keys actually change. Noisy app-state keys (template-specific UI state, per-tab flags) no longer wake the navigation / question readers on every poll cycle.
- 2eb5064: `useVoiceDictation`: cancelling while the transcription request is in flight now actually drops the response. Previously `cancel()` returned early for any state other than `recording` / `starting`, so once the network POST started, a cancel click was a no-op and the transcribed text would still be inserted into the composer after the user cancelled. The fetch handlers (both success and live-snapshot fallback) now check `cancelledRef` immediately after the await and bail without forwarding.
- 64792af: Keep Builder connect popups from replacing the Agent Native desktop webview.
- ddcc773: Raise shadcn floating-UI primitives (Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Tooltip, HoverCard, ContextMenu, Menubar, Select) from `z-50` to `z-[250]` so modal overlays cover the agent sidebar header (`z-[240]`). Fixes the case where the "Add Calendar" (and similar) modal opens but the agent chat panel underneath stays visible and interactive.
- f400c81: Add `create-pylon-ticket` action to Dispatch for escalating blockers, unmatched `#customer-*` routing, or follow-ups that need tracking — uses `PYLON_API_KEY` from the Vault. Instrument the agent chat with Sentry captures when the auth-error card stays visible past auto-recovery (`auth_error_card_stuck`) and when SSE reconnect times out (`reconnect_no_progress`) so we can chase the "occasional Reload UI required" symptom.
- b7e7d17: Route the Dispatch thread debugger through workspace root aliases.
- 04c3ed9: `workspaceAppRouteAccessFromPackageJson` now returns optional `publicPaths` / `protectedPaths` so consumers can distinguish "field absent" from "field explicitly empty." `workspace-deploy`, `workspace-dev`, and `agent-discovery` prefer the package.json value whenever it was set (even `[]`), so an app owner can clear an inherited manifest override by writing `"publicPaths": []` in its `package.json`.
- f400c81: Restrict extensions to private/org sharing only — extensions execute code in
  the viewer's authentication context, so they must never be `visibility: "public"`
  and user shares must target someone already in (or invited to) the org.
  - Added `allowPublic` and `requireOrgMemberForUserShares` flags to
    `registerShareableResource()`. Defaults match prior behavior; extensions
    opt into both.
  - `set-resource-visibility` rejects `"public"` for any resource registered
    with `allowPublic: false`. `accessFilter` and `resolveAccess` treat any
    stored `'public'` row as private for those resources (defense in depth).
  - `share-resource` verifies the principal email against `org_members` and
    pending `org_invitations` when `requireOrgMemberForUserShares: true`. The
    same flag also pins `principalType: "org"` shares to the resource's own
    org — cross-org org-principal shares would otherwise let an outside org's
    members run extension code in the viewer's auth context (same threat
    model as a public extension).
  - `updateExtension` and the extension `PUT` route refuse `visibility: "public"`
    directly. `list-resource-shares` returns a `policy` block so the share
    popover hides the "Public" option and shows server errors inline.
  - New `scripts/guard-extension-no-public.mjs` (wired into `pnpm guards` /
    `pnpm prep`) statically enforces that the extension registration keeps
    both flags set, and refuses `visibility: "public"` literals inside
    `packages/core/src/extensions/`.

- d1a90ac: Fixes for feedback from QA pass:
  - **Content** (`templates/content`): deleting the page you're currently viewing now navigates to the landing page **before** the delete round-trip resolves, so the editor doesn't sit on a now-deleted page while the request is in flight. The page-id route also redirects to `/` when the document fetch returns 404, so refreshing on a stale URL no longer dead-ends at "Document not found".
  - **Design** (`templates/design`): clicking the Edit tab no longer auto-collapses the agent chat. Previously, entering edit mode dispatched `agent-panel:close` so the EditPanel and canvas could share the screen, but the chat dropping out shifted the toolbar and removed the user's working context. Properties and chat now coexist as adjacent right-side panels.
  - **OrgSwitcher** (`packages/core`): clicking "Create organization" or "Invite member" now clears any leftover input from a previous session before entering that mode. Previously, the create form could re-open prefilled with the just-created org's name, making the switcher look like a create dialog for the new org.

- d1a90ac: Several feedback fixes:
  - **Dispatch back-button to `/dispatch/dispatch/overview`.** `dispatchNavLinkTarget` (the helper that decides whether NavLink should manually prepend the workspace mount prefix) read `window.__reactRouterContext.basename` to detect the router's basename. If that global wasn't set yet at render time, the helper double-prefixed the `to` prop, the router then prepended its own basename, and the resulting `/dispatch/dispatch/<route>` landed in browser history — clicking back from any dispatch page later took the user to that 404. The helper now mirrors `entry.client.tsx`'s basename calculation directly from `window.location.pathname`, removing the context-global race. `routerPath` (in both the package and the template copy) also iteratively strips the basename so any doubly-prefixed path that snuck into `application_state.navigate` doesn't get partially-stripped here and re-prefixed by the router back to the bad URL.
  - **"Use Builder" CTA stuck after connect (web).** The Builder upsell CTA in `AgentPanel` opens Builder in a `<a target="_blank">` tab, not a popup, so it never started the `useBuilderConnectFlow` polling loop — `useBuilderConnectUrl` was fetched once on mount and never refreshed, leaving the CTA in the "Use Builder" state after the user came back to the original tab. The callback success HTML now posts a `builder-connect-success` BroadcastChannel + window.opener message (mirroring the existing error-path broadcast), and `useBuilderConnectUrl` listens on BroadcastChannel + `window.message` + `focus` + `visibilitychange` + the existing `agent-engine:configured-changed` event, refetching `/builder/status` on any of them. Also dispatches `agent-engine:configured-changed` when status first reports configured so the rest of the chat tree updates without a full reload.
  - **Firebase `auth/popup-blocked` in desktop Builder connect.** Builder's `/cli-auth` page signs into Google via `signInWithPopup`, which calls `window.open()`. Inside the Electron OAuth `BrowserWindow` we create for the Builder flow, there was no `setWindowOpenHandler`, so Electron's default silently blocked the popup — Firebase reported `auth/popup-blocked`, the parent OAuth window never received the result, and the user saw a blank screen that then closed. The OAuth window now returns `action: "allow"` for https child popups and constructs the child as another `BrowserWindow` sharing the same `session` so Firebase's `window.opener.postMessage` handshake reaches back.
  - **`resolveScopedBuilderCredential` tracing.** The Builder credential lookup walked user → org → workspace silently; when "I connected Builder but chat says use Builder" reports come in, there was no way to tell which scope answered or whether none did. Each branch now logs the scope, email, orgId, and hit/miss outcome (matching the existing always-on tracing in `resolveSecret` for BUILDER\_\* keys).

- ffd3d00: `forkThread` now overlays the in-memory snapshot on top of the persisted row when the snapshot is fresher (more messages) than what's in SQL. Previously, once any version of the source row existed in the database, the snapshot was ignored — so forks could lose the latest unflushed user message, which is exactly the scenario chat-fork-from-unflushed is meant to fix. Guarded with `snapshot.messageCount > stored.messageCount` so a stale snapshot from another tab can't clobber a fresher persisted row.
- ffd3d00: `AgentPanel` no longer emits a synthetic `{ open: false }` sidebar-state event on mount when the parent frame owns the sidebar. The dispatch is now deferred until the frame sends its first `agentNative.sidebarMode` message, so listeners initialize with the real state instead of seeing a false → true flip a moment later.
- 64792af: Avoid double-submitting Builder chat prompts from embedded app composers by using a single iframe transport when a parent frame is available.
- 9c991e1: Keep Builder preview Google sign-in from returning to loopback preview URLs.
- ce9e355: Open primary Google sign-in from Agent Native Desktop through the desktop exchange flow so OAuth can complete in the system browser.
- ce9e355: Add LLM connection context to tracking events and track Builder connect clicks.
- 97ca0db: Export `useBuilderStatus` and `useBuilderConnectFlow` from `@agent-native/core/client` so template settings pages can render a connect-builder button that polls for completion instead of a bare `<a target="_blank">` link.
- 1fd5856: Allow owners to manage legacy unscoped shared resources after joining an organization.
- d1a90ac: Org polish:
  - `InvitationBanner`: while a join-by-domain or accept-invitation request is in flight, render an in-place "Joining {orgName}…" status so the chat panel doesn't look unchanged until the view abruptly swaps.
  - `OrgSwitcher`: `settingsPath` is now optional. When unset, "Workspace settings" only opens the in-sidebar settings panel — suitable for templates without a dedicated team page. Templates that mount one (e.g. Dispatch's `/team`) pass it explicitly.
  - `useOrgMembers` / `useOrgInvitations`: scope the React Query cache by active `orgId` so switching/creating an org forces a fresh fetch instead of briefly showing the previous org's members.
  - `useCreateOrg`: invalidate all queries on success (creating an org switches into it server-side, so every org-scoped query is stale), matching `useSwitchOrg`.
  - Create/invite forms: loader uses flex centering so the spinner stays vertically centred inside the button; close the create-org dialog via the unified `handleOpenChange` so cleanup runs.

- ce9e355: Add app navigation links to the organization switcher, with Dispatch pinned as the workspace hub.
- ffd3d00: Standardize the organization switcher settings link around template team pages.
- ad4f135: Use polling file watchers for workspace dev in managed remote containers to avoid Linux inotify limits.
- 64792af: Recover auth sessions when stale duplicate cookies shadow a fresh sign-in.
- b7e7d17: Hide agent-created scratch resources from workspace file lists by default.
- 64792af: Recover the agent chat message list when assistant-ui briefly renders a stale message index.
- ad4f135: Seed shadcn-aware frontend design skills in generated apps and workspaces.
- 13284b1: ErrorBoundary: "Go home" now triggers a full page reload (was client-side
  `<Link>`), so a signed-out visitor who lands on an error page is taken
  through the server auth guard's sign-in flow instead of getting stuck on
  a logged-in route with failing API calls. Also softens the 404 message
  to a plain "We couldn't find this page." for end users — the previous
  copy mentioned Dispatch and "shipping" routes, which only made sense to
  developers working on workspace apps.
- ffd3d00: Make chat forking work when the source thread has not flushed to SQL yet.
- ffd3d00: Redirect mounted Dispatch workspace roots to the overview page across workspace deploy presets.
- 04c3ed9: Surface workspace app startup timeouts instead of looping forever on the gateway wake screen.
- ce9e355: Send a larger default output-token budget through the Builder gateway so long Plan Mode responses do not inherit a short gateway default.
- ce9e355: Scope agent chat screen and URL context to the originating browser tab.
- d1a90ac: Fix Builder "Upgrade at builder.io" link in chat dropping users on `/app/projects` instead of billing. The link previously deep-linked to `/app/organizations/<BUILDER_ORG_NAME>/billing`, but `BUILDER_ORG_NAME` is the org's display name (e.g. `Nicholas kipchumba Space`), not a URL-safe slug — Builder's router didn't recognize it and silently redirected to `/app/projects`. The CLI-auth callback doesn't expose an org slug or id today, so the link now always points to `https://builder.io/account/billing`, which resolves the active org from session.
- d1a90ac: Promote `upload-image` to a core sharing action: register it in `mergeCoreSharingActions` so every template inherits the agent-callable image-upload tool without each app having to re-declare it in `actions/`.
- ce9e355: Default Dispatch vault access to all workspace apps, add manual grant mode, sync vault keys into encrypted app secrets, and fix org-scoped vault listing.
- ce9e355: Save generated workspace app descriptions, make Dispatch app metadata editable, and include workspace app names/descriptions in A2A agent context.
- ce9e355: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- 64792af: Show workspace dev child-process failures on the startup page instead of hiding them behind a generic reload loop.
- d1a90ac: CLI: probe each app's port before spawning Vite so the workspace dev server doesn't die on a single port conflict. `pnpm dev` previously assigned each app a fixed port (`8100`, `8101`, …) and spawned Vite with `--strictPort` for the gateway routing; if anything on the host already owned that port, Vite failed hard before the gateway could route around it. The workspace now binds a probe TCP socket on each candidate port before commiting to it, increments past collisions, and logs the substitution. The same probe runs in the live filesystem-sync path so a newly-scaffolded app added with `agent-native add-app` doesn't trip on a busy port either. Includes a related CLI scaffolding spinner tweak — the per-app message now distinguishes "Downloading X template…" (slow GitHub fetch) from "Configuring X…" (fast local rewrite) so users don't watch a frozen "Scaffolding…" message during the network step. `runWorkspaceDev` is now async (returns `Promise<WorkspaceDevHandle>`); the two in-tree callers already chained `.then()`, so no external API change.
- ce9e355: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.
- ad4f135: Keep workspace OAuth and app URL resolution on configured public origins before falling back to local workspace gateways.
- b7e7d17: Allow the Workspace tab to load without desktop code access.

## 0.14.8

### Patch Changes

- db11073: Fix workspace scaffolds of `slides` and `videos` failing with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for `@agent-native/pinpoint`. Both templates depend on pinpoint but were not declaring it in `requiredPackages`, so it never got copied into `packages/pinpoint` and the `workspace:*` reference could not resolve.

## 0.14.7

### Patch Changes

- 63e641a: Add rich Sentry tags (model, gatewayOrigin, gatewayRequestId) for no-detail Builder gateway errors and fix the user-facing copy to stop promising auto-recovery and model switching, which don't actually help for this error code.
- 63e641a: Stop `Error: socket hang up` unhandled rejections from polluting Sentry on
  AWS Lambda (Sentry AGENT-NATIVE-BROWSER-4 — 24k events / 199 users in 48h).
  The MCP `StreamableHTTPClientTransport` opens long-lived sockets for SSE
  long-polls; AWS reaps those sockets ~60s after a Lambda invocation returns
  200, and the next thaw delivers a `Socket.socketOnEnd` whose Promise has
  nobody left to await it. Two changes:
  - `server/sentry.ts` `beforeSend` drops `socket hang up` events whose
    mechanism is `onunhandledrejection` and whose stack includes
    `Socket.socketOnEnd` / `node:_http_client`. Real socket-hang-up errors
    with a different mechanism or non-HTTP-client stack still report.
  - `mcp-client/manager.ts` attaches a no-op `transport.onerror` before
    `client.connect()` so SDK fire-and-forget paths (initial SSE stream
    open, scheduled reconnects) can't surface as unhandled rejections in
    the window before Client wires its own handler. `Client.connect()`
    chains its own onerror on top of ours, so post-connect errors still
    flow through the existing `client.onerror` recorder.

- 63e641a: Fix `MessageRepository(addOrUpdateMessage): Parent message not found` unhandled
  rejection in the agent prompt composer (Sentry AGENT-NATIVE-BROWSER-18). The
  assistant-ui local runtime can clear or relink its message map between the
  `append` that adds the user message and the `performRoundtrip` call that
  records the assistant placeholder (history-adapter load, branch reset, repeat
  imports). When that race fires the runtime threw an internal-bug error that
  masked the original error from chatModel.run() and surfaced as a Sentry
  unhandled rejection on the user's first send. The fix patches the underlying
  `MessageRepository.addOrUpdateMessage` to relink the message to the current
  head (or root) when the requested parent is missing, instead of throwing.

## 0.14.6

### Patch Changes

- 7992922: Hide the CLI tab in the agent sidebar when embedded inside the Builder.io frame. Code editing in that context happens via Builder, and the CLI panel only offered a Download Desktop CTA, so the tab added clutter without value. If the persisted panel mode was `cli`, it now auto-switches to `chat` once embedded.
- 7992922: fix(chat): three related chat-history fixes that landed together.
  - New `normalizeThreadRepository()` walks an imported repo, drops messages without an id, and rewrites missing or dangling `parentId` references to the previous-seen message id (or `null` for the head). assistant-ui's `threadRuntime.import()` rejects the whole repo with `Parent message not found` if even one entry has a stale parent, which used to wipe the entire thread on refresh after a partial save. Both `mergeThreadDataForClientSave` (server-side merge) and `AssistantChat`'s import path now run through it.
  - `chat-threads/store` derives `messageCount` from `thread_data` on read via `normalizeThreadRepository`, and drops summary rows where the derived count is `0`. The chat-history sidebar now reflects only real conversations even if a row sneaks in with `message_count = 0`.
  - `isInternalContinuationError` no longer classifies `builder_gateway_error` (or the loose `"gateway error"` message-substring match) as a continuation. PR #634 dropped this code from the client's auto-recover allow-list and capped the server retry budget; this finishes the picture so the visible thread surfaces a normal error card instead of hiding the failure behind the silent-continuation filter.
  - Thread-data writes now use an `updated_at` compare-and-swap retry loop and remerge message history against the latest DB row before each retry, so cross-process serverless writers no longer blindly clobber each other. Client restore/reconnect also refuses obviously stale server snapshots that would replace a richer local runtime.

- 7992922: Add `?authMode=popup` / `?authMode=redirect` query-param override to the Google sign-in flow, allowing per-session testing of either flow without flipping the global `GOOGLE_AUTH_MODE` env var or shipping a default-behavior change.

## 0.14.5

### Patch Changes

- fa3189e: fix(thread persist): every user message was getting duplicated in `chat_threads` because the runtime export (assistant-ui's `saveThreadData`) wrote `attachments: []` while the server-side `persistSubmittedUserMessage` → `buildUserMessage` path omitted the field entirely. The fingerprint used to dedupe in `messageIdentityKeys` couldn't see them as the same message — `[]` and `undefined` hashed differently. Now normalize the attachments slot through `normalizeAttachmentIdentity` (which collapses both shapes to `undefined`) so duplicates merge instead of stacking up as `client_user → assistant → server_user` triples.
- fa3189e: Mirror Google Slides' sharing behavior in the framework `ShareButton` and SSR runtime:
  - Wrap SSR loaders in `runWithRequestContext` so React Router loaders see the signed-in user via `getRequestUserEmail()` / `accessFilter()`. Fixes a bug where shared admins (and even owners) hit 404 on access-controlled SSR routes unless visibility was set to public.
  - `ShareButton` now supports an optional `secondaryShareUrl` (with `secondaryShareUrlLabel` / `secondaryShareUrlDescription`) so a resource can expose two copyable URLs — e.g. an editor link and a read-only / presentation link — in the same share dialog.
  - `shareUrlRequiresPublic` (and the related `shareUrlUnavailableDescription`) is now a no-op and deprecated. Access is enforced on the resource itself, not the URL shape, matching Google Slides — copying a link no longer requires flipping visibility to public.

## 0.14.4

### Patch Changes

- e9d5dac: Return Builder cloud OAuth completions to the active preview proxy host instead of raw loopback URLs.
- e9d5dac: fix(chat): stop the "agent regenerates the reply 4+ times in a loop" runaway when the Builder gateway emits a no-detail error

  End-to-end repro on slides production showed the agent emitting `{activity, tool_start, tool_done, tool_start, tool_done, clear, clear, clear, error}` with `errorCode: "builder_gateway_error"`, then the client sending another `POST /agent-chat` to auto-continue, which got the same gateway error, which auto-continued again — up to **4 server runs for one user message** until the gateway returned 503. Each run wiped visible content via `clear` events and re-streamed from scratch. That's the "agent does some work, deletes its reply, regenerates, gets stuck in a loop" symptom users were hitting.

  Two changes:
  - **client (`sse-event-processor.ts`):** `builder_gateway_error` is no longer in `isAutoRecoverableError`'s recoverable list. That code is the no-detail Builder gateway fallback (gateway emitted `{type:"stop",reason:"error"}` with no explanation — almost always upstream provider giving up: model quota hit, account misconfiguration, opaque downstream failure). The production-agent already retries it synchronously inside the run before the error escapes to the SSE stream, so by the time the client sees it the server has given up — auto-continuing on top of that just sends another POST that hits the same wall. Surfaces the error to the user as a "Something went wrong" card instead of looping up to 32 transient continuations. Also removed `"gateway error"` from the message-substring matcher to stay consistent with the code-based check.
  - **server (`production-agent.ts`):** Cap the in-run retry budget for `builder_gateway_error` at 1 (down from `MAX_RETRIES = 3`). Same rationale — retrying the same call against a misbehaving Builder route rarely recovers, and each retry emits a `clear` event that wipes the user's visible content. Three cycles of "regenerate, clear, regenerate" inside a single run is bad UX for a failure mode where retrying doesn't help. Other retryable codes (`http_5xx`, `builder_gateway_network_error`, rate limits, transport blips) keep the original 3-attempt budget. New `maxRetriesForError(err)` helper gates this so we can extend per-code overrides later without touching the loop.

## 0.14.3

### Patch Changes

- 740bca9: ux(extensions sidebar): trim the section header's right padding from `pr-24` to `pr-20`. The previous value reserved space for icons that were since removed; the new value lines up cleanly with the action buttons that are actually rendered.

## 0.14.2

### Patch Changes

- 704951d: Agent run-store: stop the bug that caused the user-facing `run_terminal_event_missing` error from happening in the first place. The reaper paths (`reapIfStale`, `reapAllStaleRuns`, `cleanupOldRuns`, `markRunAborted`) used to call `appendTerminalRunEvent(...).catch(() => {})`, silently dropping transient SQL errors and stranding reconnecting clients with bare `status='errored'` rows. They now go through `safeAppendTerminalRunEvent` — one retry after a 100ms backoff, then a structured `captureError` to Sentry on persistent failure. `cleanupOldRuns` also broadens its terminal-event-append SELECT to cover the 24h-age UPDATE in addition to the heartbeat-stale one (an old run with a somehow-fresh heartbeat would previously be flipped to `errored` without a terminal event).
- 704951d: Return Builder desktop Google sign-in to the local workspace gateway and bridge the OAuth session back with `_session`.
- 704951d: Stop chat history from "reverting" mid-conversation: `useChatThreads.fetchThreads` now reconciles per-thread instead of replacing wholesale, so a server fetch that arrives a few hundred ms behind a fresh local update no longer rolls the recent-chats list back to older timestamps. The active thread is also kept visible in the History popover (and highlighted as `Active`) even when its `messageCount` is still zero, so a brand-new chat doesn't appear to vanish from the list right after opening.
- 704951d: fix(chat): stop creating empty `chat_threads` rows on every page mount + recover from stale active threads

  Two related fixes that together prevent `chat_threads` from filling up with ghost rows and prevent users from getting stuck on an active id the server doesn't know about:
  - `useChatThreads` no longer optimistically `POST`s `/_agent-native/agent-chat/threads` when synthesizing a thread id for the composer. The previous flow inserted an empty `chat_threads` row (`message_count=0`, no linked `agent_runs`) on every page mount and every "+" click, even when the user never sent a message. The agent run's server-side `persistSubmittedUserMessage` already creates the row idempotently the moment the user sends, so the client just adds the thread to local state. Rows now land in `chat_threads` only when there's a real conversation behind them.
  - When the saved active thread id isn't on the server AND wasn't created locally this session, the hook now drops the user on the most-recent real thread instead of leaving them on a stale composer that the server has no record of. The `newlyCreatedRef` check disambiguates: only optimistic-this-session ids stay active; ids from a previous session whose row was cleaned up get swapped out.

  Per-thread merge in `fetchThreads` (already shipped) keeps in-flight optimistic threads visible until the server learns about them, so the chat list still shows the user's current thread without flicker.

- 704951d: Two small UI primitives:
  - Prompt composer: click an attached image to open a fullscreen preview (Esc / click-outside to close). The thumbnail's X button still removes.
  - Agent sidebar: new `window.dispatchEvent(new Event("agent-panel:close"))` event mirrors the existing `agent-panel:open` so apps can collapse the sidebar programmatically (used by the design template's Edit mode to free up canvas space).

- 704951d: Agent SSE reconnect: replace the cryptic `run_terminal_event_missing` error with the friendlier stale-run message, and persist it back to SQL so future reconnects replay the proper terminal event instead of regenerating it. This path triggers when an `agent_runs` row was flipped to `errored` but the terminal event write was lost (e.g. a reaper's `appendTerminalRunEvent(...).catch(() => {})` swallowed a transient DB error). The user-facing situation is identical to a stale-run reap, so the UI now shows "The agent stopped before it could finish" with `recoverable: true` (offering retry) instead of the debug-string error.

## 0.14.1

### Patch Changes

- 513aac1: fix(chat): recover from chats disappearing from sidebar history

  Two changes that together restore the pre-#621 behavior where the chat history list always reflects the server:
  - **client**: Stop hydrating chat messages from a per-thread `localStorage` cache, and stop synthesizing a fresh UUID active thread inside the `useState` initializer. The cache could mask stale or partially-saved threads, and the synthesized id raced with the agent run's server-side `persistSubmittedUserMessage` create — when the client's `POST /threads` then lost the race, its `.catch` was yanking the freshly-created thread out of local state. Active thread is now resolved against the server's threads list (most-recent fallback if the saved id isn't there); thread messages are loaded from the server. The `agent-chat-active-thread` localStorage key still persists which thread the user last had focused.
  - **server**: Make `POST /_agent-native/agent-chat/threads` idempotent. When the request body's `id` matches an existing thread owned by the same user, return that thread instead of failing on the SQL UNIQUE constraint. This also means a flaky network retry of `POST /threads` no longer 500s after the agent's `onRunPrepared` already inserted the row.

- 513aac1: refactor(agent): extract `runAgentLoopDirectWithSoftTimeout` (the soft-timeout + resumable-error continuation wrapper) out of `agent-chat-plugin.ts` into a dedicated `run-loop-with-resume.ts`, with unit and integration spec coverage for the soft-timeout path, gateway-timeout resume, network-interrupt resume, the `MAX_RUN_LOOP_CONTINUATIONS=6` cap, and upstream-abort handling.

  Also bumps `DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS` from 45s to the existing 55s cap so design generation and other long-output workloads get the full per-call budget Lambda's 75s function limit allows. 55s leaves ~20s headroom for response streaming + the soft-timeout continuation path.

## 0.14.0

### Minor Changes

- 04fe544: feat(agent): resume runs that get cut off by upstream gateway timeouts (Builder gateway, HTTP 502/503/504, serverless function timeouts) or transport-level interruptions (socket hang up, ECONNRESET, fetch failed, stream closed) instead of failing the run.

  The `auto_continue` event's `reason` union picks up two new values — `gateway_timeout` and `network_interrupted` — so clients can show a precise message. Internally the agent gets a one-line continuation note describing how it was interrupted, then resumes from the same conversation prefix (Anthropic prompt cache rescues the latency) and finishes the user's original request without redoing completed work.

- 04fe544: feat(auth): when `COOKIE_DOMAIN` is set (e.g. `.agent-native.com` for first-party deploys where each app is its own subdomain), the framework session cookie is shared across every subdomain. The cookie name becomes the unsuffixed `an_session` and a `Domain=<COOKIE_DOMAIN>` attribute is added on every set/clear, so signing into one app signs the user into every sibling app under the same parent domain.

  Better Auth's session cookie picks up the same domain via its `crossSubDomainCookies` advanced option, so its cookie and the legacy framework cookie stay in sync across subdomains.

  Falls back to the existing per-app and workspace-mode cookie naming when `COOKIE_DOMAIN` is unset, so non-first-party deploys keep their origin-scoped cookies.

- 04fe544: feat(extensions/fetch-tool): the `web-request` tool now sends realistic Chrome-on-macOS headers (User-Agent, Accept, Sec-Fetch-\*, Upgrade-Insecure-Requests, etc.) by default so sites with anti-bot middleware (Cloudflare, PerimeterX, Akamai) respond normally instead of returning challenge pages. Caller-supplied headers always win, so API calls with Authorization keep their values untouched.

  Also raise the response truncation cap from 8k to 32k chars so the agent can read a full article or scraped table in one shot.

- 04fe544: feat(onboarding): pick Google sign-in flow with `GOOGLE_AUTH_MODE` env var (`auto` | `popup` | `redirect`, default `auto`). Auto uses a popup in normal browsers, a full-page redirect inside Electron, and a popup inside the Builder.io browser iframe (Google rejects framing). The new `resolveGoogleAuthMode()` server helper is also exported from `@agent-native/core/server/google-auth-mode` for callers that need to pass an explicit mode.

### Patch Changes

- 04fe544: Auto-send the user's pending prompt the moment Builder.io connection
  completes. The Connect Builder card carries the user's original ask as
  its `prompt` prop; previously the OAuth popup closing left them staring
  at a "Send to Builder" button as if they had to retype it. The card now
  fires the send automatically once `connecting` flips false with a
  configured Builder, but only if the user actually clicked Connect this
  session — revisiting an already-connected card still requires an
  explicit click so old threads don't replay on re-open.
- 04fe544: fix(agent prompt): two routing tweaks for connect-builder.
  - Add an "Extensions vs. Code Changes — Pick the Right Path" section so the agent prefers `create-extension` for new self-contained surfaces (widgets, dashboards, lists, viewers) and only falls back to `connect-builder` when the request modifies the host app's existing chrome.
  - Make the agent briefly acknowledge the user's specific ask before handing off to Builder, and reword the post-card sentence around what the user just asked for instead of leading with a generic Builder pitch.

- 04fe544: - db/neon: Attach a logging error listener to the Neon serverless Pool. Without one, Node 24 surfaces routine WebSocket drops (idle timeout, Lambda suspend, network blip) as fatal `Unhandled error` / `Connection terminated unexpectedly` uncaught exceptions even though the next query would have transparently reconnected. The pool now logs and swallows these so they don't crash the function or fill Sentry.
  - server/sentry: Drop 4xx HTTPError / H3Error from `beforeSend`. h3's `createError({ statusCode: 4xx })` is the documented way to return 404 / 400 / 401 from a route — those bubble through Nitro's error hook and were getting captured as Sentry issues. Match by statusCode when present, fall back to message heuristics ("not found", "Cannot find any route matching", "No access to …", "Unauthenticated") so handler-thrown 4xx don't bury real bugs.
- 04fe544: fix: avoid spurious failures in two edge cases.
  - `agent_run_events` writes now use `ON CONFLICT (run_id, seq) DO NOTHING` so a `pendingTerminalEvent`-reserved seq getting reused, or `appendTerminalRunEvent` racing with the producer's final event, no longer leaves the run in an inconsistent terminal state.
  - `fetchPollJson` in `use-db-sync` now awaits `res.json()` inside the `try` before the timeout `finally` runs, so a body-stream abort can't escape as an unhandled rejection.

- 04fe544: - AssistantChat: clearer Builder-setup card copy ("Turn on the AI assistant" / "One click to connect Builder for free hosted access — no API keys needed").
  - Sentry: drop `AgentAutoContinueSignal` (control-flow sentinel) on the browser side and `ForbiddenError` / `UnauthorizedError` on the server side from captured events. They aren't real failures and were burying actionable bugs in the Sentry issue list.
- 04fe544: ux(agent prompt): after finishing a task with obvious recurring value (daily triage, weekly digests, monthly cleanup), the agent now offers to save it as a recurring job in one short closing line, then calls `manage-jobs(create)` if the user confirms. Skips the offer for one-shot lookups, single drafts/replies, and prompts that already specify a cadence.
- 04fe544: fix(dispatch): make the `/dispatch/<appId>` server-side bounce work in production deploys and after live workspace changes by reading the same env-→file-→filesystem manifest fallback chain that the rest of agent discovery uses, instead of only checking `AGENT_NATIVE_WORKSPACE_APPS_JSON`.

  Core now exports `loadWorkspaceAppsManifest()` and the `WorkspaceAppManifestEntry` type from `@agent-native/core/server/agent-discovery`, so other server entrypoints can resolve the workspace manifest without re-implementing the fallback.

- 04fe544: Strengthen the `create-extension` tool description so the agent generates more
  robust extensions: prefer `<script>` + `Alpine.data('name', () => ({...}))`
  for any non-trivial component instead of stuffing methods, branching, and
  template literals into an inline `x-data="..."` attribute (HTML parser
  pitfalls cause `ReferenceError` failures); require a real LLM key via
  `${keys.*}` for AI features or route the AI work to the agent chat instead
  of shipping a stubbed analysis step.
- 04fe544: Fix Extensions sidebar header so the info-circle icon no longer overlaps the title text on narrow widths. Title now truncates cleanly and the info button only appears on row hover.
- 04fe544: fix(auth): share the framework session cookie across all apps in workspace mode + add `Partitioned` to the cookie attributes so it survives Builder.io's iframe + Chrome's third-party-cookie deprecation.

  Two related issues were combining to break workspace SSO:
  1. The framework cookie name was suffixed with `APP_NAME` (`an_session_dispatch`, `an_session_todo`, etc.) to prevent template ping-ponging in `dev:all`. In workspace mode every app shares the same origin **and** the same DB, so per-app suffixes were the wrong default and killed cross-app sign-in. Workspace apps now share `an_session_workspace`.
  2. The framework cookie was set with `SameSite=None; Secure` but no `Partitioned` attribute, so the Builder OAuth popup → main-iframe handoff dropped the cookie under Chrome's third-party storage partitioning. Better Auth's own cookie already has `Partitioned: true`; this brings the framework's legacy cookie in line.

  After this change, signing into one workspace app (Dispatch in builder-workspace) means you're signed in across the workspace's other apps too, and the agent chat sidebar's auth check stops looping back to the login page on subsequent app loads.

## 0.13.1

### Patch Changes

- 051fcac: Swap `AgentPresenceChip`, `PresenceBar`, and `agent-identity` accent colors to the agent-native brand blues (#00B5FF / #48FFE4) so presence indicators match the new analytics chart palette.
- 051fcac: Route Builder desktop Google sign-in through the configured public OAuth origin so the centralized callback host mints and redeems the OAuth state.

## 0.13.0

### Minor Changes

- 98d56cd: Surface a user-visible "this chat looks stuck" affordance when an agent run goes silent. The server now tracks a durable `last_progress_at` timestamp on every emitted event (distinct from the process-liveness `heartbeat_at`); `/runs/active` returns it; and a new `useRunStuckDetection` hook + `RunStuckBanner` component poll it from the client. After 90s without progress — past the adapter's 75s no-progress reconnect — the banner appears with Retry / Cancel buttons. `MultiTabAssistantChat` wires this in by default, with Retry sending a continuation prompt via the existing chat handle. `trackEvent` calls fire on stuck-detected, retry, and cancel so we can finally see the long tail of stuck-chat incidents in analytics instead of relying on user reports.

### Patch Changes

- 98d56cd: Make the chat sidebar paint instantly on open instead of blocking behind network round-trips. `useChatThreads` now seeds an optimistic active thread synchronously on mount — either from localStorage or a freshly-generated UUID — and persists it server-side in the background. For existing chats, every save also writes the thread data to a localStorage cache, and `AssistantChat` hydrates from that cache synchronously so the message bubbles paint on first commit; the server fetch still runs in the background to refresh, and is skipped as a no-op when the server data is identical to the cache.
- 98d56cd: Composer + menu now reads "Create Extension" (was "Create Tool") and "Schedule Task" (was "Scheduled Task") to match the imperative tense of the other menu items.
- 98d56cd: Reword waitlisted Builder Cloud Agents UI from "unavailable" to "coming soon" in the connect card and code-required dialog.

## 0.12.40

### Patch Changes

- dd3090e: When the agent chat is open in a plain browser tab on localhost, source-code work via the dev handler kills the chat session — Vite HMR and full page reloads cancel the in-flight run. The chat adapter now sends `x-agent-native-surface: desktop | frame | browser`, and the server forces the prod handler (no shell / no fs) on the chat-in-browser-on-localdev surface and prepends a redirect block telling the agent to point users at Agent Native Desktop, Claude Code, Codex, or Builder.io for code changes instead of trying to edit source itself.

## 0.12.39

### Patch Changes

- e4f6cf3: Workspace dev gateway pages (loading + index) now respect `prefers-color-scheme` and render in dark mode when the user's OS is set to dark.
- e4f6cf3: Prefer the public auth origin (`APP_URL` / `BETTER_AUTH_URL` / `WORKSPACE_OAUTH_ORIGIN`) over the workspace gateway URL when resolving Google OAuth redirect URIs, on both server and client. Filter out loopback gateway origins so dev workspaces don't accidentally redirect to localhost in production. The workspace dev runner forwards the resolved origin to per-app processes via `VITE_WORKSPACE_OAUTH_ORIGIN`.

## 0.12.38

### Patch Changes

- cd451f8: Clarify Builder Cloud Agent waitlist copy and desktop fallback links.

## 0.12.37

### Patch Changes

- 10d8f30: Keep workspace Google OAuth redirects on the configured gateway callback instead of Builder preview origins.
- 10d8f30: Restore the chat-with-dots Tabler icon for the shared agent sidebar toggle.
- 10d8f30: Fix user-testing bugs around unavailable CLI controls, desktop Builder connect fallback, missing-LLM guidance, and duplicate chat activity step keys. Also adds quieter capability cues for code/Builder availability and integration setup prerequisites.
- 10d8f30: Keep chat connected to active server runs when the local runtime drops idle unexpectedly.
- 10d8f30: Add a Dispatch thread debugger with cross-source thread search and deep agent run inspection.

## 0.12.36

### Patch Changes

- bc8311a: Tighten the extensions empty-state copy ("Describe a small app and the agent will build it.").

## 0.12.35

### Patch Changes

- b209def: Make raw agent database tools fail closed for tables without a recognized tenant scope.
- b209def: Polish the extensions empty state hierarchy and composer alignment.

## 0.12.34

### Patch Changes

- d749754: Drop the command menu from `top-[5vh]` to `top-[15vh]` so the palette sits comfortably below the page header instead of pinned to the top.
- d749754: Top-align command palettes so result count changes do not shift their viewport position.

## 0.12.33

### Patch Changes

- 9e11b24: Drop the command menu from `top-[5vh]` to `top-[15vh]` so the palette sits comfortably below the page header instead of pinned to the top.
- 9e11b24: Top-align command palettes so result count changes do not shift their viewport position.

## 0.12.32

### Patch Changes

- 8a83abd: Use redirect sign-in inside Builder.io desktop and harden Builder Google popup opening.
- 8a83abd: Move the extensions sidebar explainer from a click popover to an interactive hovercard.

## 0.12.31

### Patch Changes

- 88f206f: Open workspace settings to the relevant settings section and update chat history wording.
- 88f206f: Extract the QuestionFlow primitive from the design / videos / slides templates into a shared `GuidedQuestionFlow` (plus `useGuidedQuestionFlow` hook and helpers `formatGuidedAnswerValue`, `formatGuidedAnswersForAgent`, `getOtherGuidedAnswerText`, `hasGuidedAnswer`, `isOtherGuidedAnswer`, `makeOtherGuidedAnswer`, `normalizeGuidedAnswers`). Templates that need question-driven generation can now consume the same component instead of forking ~400 lines of UI each.
- 88f206f: Improve agent chat tool-call detail display and disable lazy route-discovery manifest polling in template configs.
- 88f206f: Stamp `requestMode` on every assistant chunk's metadata so the chat surface can tell which mode each turn was actually generated under. The Plan-mode "Implement Plan" CTA now requires the latest assistant message to be a plan response, instead of triggering on any assistant message while the global toggle is plan. Also let the chat history popover include currently-open tabs (marked "Open" instead of a timestamp) so users see their full thread list.
- 88f206f: Prevent copying public-only share links before the resource is public.
- 88f206f: Await persistence of terminal run events before writing the final run status, and skip the status update if the terminal-event SQL write fails — so reconnects can no longer observe `status='errored'` without the corresponding error payload, and the heartbeat-stale reaper retries the run cleanly. Also forces the settings panel to re-apply `initialSection` when the same value is requested twice via a new `sectionRequestKey` prop, and updates the dev overlay shortcut hint to render `Cmd+Ctrl+A` on Mac and `Ctrl+Alt+A` elsewhere.
- 88f206f: Add an optional `id` prop on `SettingsSection` so callers can deep-link or scroll to a specific section. The `agent-panel:open-settings` CustomEvent now accepts an optional `detail.section` field that AgentPanel forwards to the settings panel as `initialSection`. Rename the chat-history toggle copy to "All chats".
- 88f206f: Persist terminal agent-run events before final run status updates so reconnects replay the real outcome.
- 88f206f: Stream `/_agent-native/events` SSE for in-process change events as the fast path for `useDbSync`, with the existing `/_agent-native/poll` endpoint as the cross-process / serverless fallback. When the SSE stream is connected, the polling interval relaxes to 15 s; if the server can't reach the client (or the consumer passes `sseUrl: false`), polling continues at the original cadence. Tool-call cards in `AssistantChat` now expose copy-to-clipboard buttons on the input and result panes.
- 88f206f: Open the agent settings panel when selecting Workspace settings from the organization switcher.

## 0.12.30

### Patch Changes

- 419988f: Surface a visible "model returned an empty response" message when an engine ends a turn with reasoning-only content and zero output text (e.g. OpenAI gpt-5+ Responses runs where reasoning consumes the entire output-token budget). Previously the SSE stream finished cleanly with no text, producing a silent empty assistant bubble.
- 419988f: Add an optional `prepareRequest` hook on `ProductionAgentOptions` and `AgentChatPluginOptions` so templates can normalize the inbound chat request — materialize uploaded attachments into per-template file handles, rewrite the message, or append non-visible instructions — between owner resolution and system/context assembly. Re-export `AgentChatAttachment` from the core entry points so templates can type the hook's payload.
- 419988f: Add a server-side agent chat request preparation hook for templates to materialize uploaded attachments before a run starts.

## 0.12.29

### Patch Changes

- 4c90b33: Use Claude Sonnet as the default Builder gateway chat model.

## 0.12.28

### Patch Changes

- fd1cc43: Add Google OAuth handoff debug breadcrumbs for Builder-hosted sign-in flows.
- fd1cc43: Pause `useDbSync`, `useScreenRefreshKey`, `usePausingInterval`, and `useCollaborativeDoc` polling while the tab is hidden so background tabs do not keep waking the network. Restores polling on focus and visibility change. The new `pauseWhenHidden` option defaults to `true`; pass `false` to keep the legacy always-on behaviour. Also expand `useDbSync`'s default invalidation set to include `app-state`, `navigate-command`, `show-questions`, and `__set_url__`, so framework-managed application-state keys stay in sync without templates having to opt in by passing `queryKeys`. The `/_agent-native/poll` endpoint now subscribes to in-process `app-state` and `settings` emitters and records changes directly, skipping a DB scan when the event happened on the same Node instance, and forwards an `owner` field on every event so clients can match it to the active session.
- fd1cc43: Allow per-message plan/act override via `runConfig.custom.requestMode` so the chat composer can flip a single user turn into Implement Plan without changing the global Plan/Act toggle.

## 0.12.27

### Patch Changes

- 08d4113: Broaden composer upload filters so Markdown, JSON, CSV, DOCX, and PPTX reference files are selectable in native file pickers.
- 08d4113: Buffer streamed assistant text until the final-response guard approves it, so rejected answers never flash before the corrective retry. Removes the `clear` event the UI used to swallow.
- 08d4113: Improve assistant chat embed previews and sub-agent task card labels.
- 08d4113: Clear stale chat activity when corrective agent retries discard partial output.
- 08d4113: Add Preview header bar to IframeEmbed showing the embed's title above the iframe.
- c195ddd: Include installed libsql native packages in Node serverless bundles so hosted apps do not fail loading local SQLite/libsql fallbacks.
- 08d4113: Use better-sqlite3 for local SQLite file URLs and `@libsql/client/web` for remote libsql/Turso URLs so serverless bundles no longer depend on libsql's platform-specific native packages. The deploy bundler still copies any installed `@libsql/<platform>` natives into Netlify/Vercel/Lambda outputs as a safety net.
- 08d4113: Bundle agent chat feedback controls with the main client entry so missing lazy chunks cannot crash the agent panel.
- 08d4113: Show visible assistant error text for chat authentication failures instead of blank messages.

## 0.12.26

### Patch Changes

- 09d9748: Bundle agent chat feedback controls with the main client entry so missing lazy chunks cannot crash the agent panel.

## 0.12.25

### Patch Changes

- 1155964: Close Google OAuth success popups after Builder workspace sign-in completes.
- 1155964: Keep hosted chat credential isolation intact and show visible missing-credential errors.
- 1155964: Read legacy workspace-scoped Builder credentials so users who connected before org scoping no longer see "missing key" errors.

## 0.12.24

### Patch Changes

- d198100: Polish setup, navigation, editor, and feedback affordances from user feedback.
- d198100: Preserve chat attachments and completed history during interrupted-run recovery.
- d198100: Fix stale collaboration presence cleanup, stale run handling, and agent panel recovery.

## 0.12.23

### Patch Changes

- e752afd: Expire stale progress runs so abandoned tray indicators do not stay active forever.
- e752afd: Require request-scoped Builder or LLM credentials for signed-in users on hosted shared-database apps.
- e752afd: Use neutral composer styling when Plan mode is active.
- e752afd: Contain failed remote MCP handshakes and show concise connection errors.
- e752afd: Quiet the optional node-pty missing notice unless terminal debug logging is enabled.
- e752afd: Keep the Workspace docs tooltip from overlapping the panel header.
- e752afd: Improve Sentry signal for Builder gateway network failures and browser analytics noise.
- e752afd: Use the request-context owner when resolving explicit agent engine credentials.
- e752afd: Preserve uploaded attachments on queued chat messages and stringify screen context objects.

## 0.12.22

### Patch Changes

- 1ba9738: Allow composer dictation to request same-origin microphone access and improve blocked-microphone guidance.
- 1ba9738: Use the AI SDK's default OpenAI Responses path for first-party OpenAI agent models.
- 1ba9738: Show a Builder reconnect action when agent chat hits Builder or model-provider auth errors.

## 0.12.21

### Patch Changes

- 0d95d53: Restore production Plan mode in the agent sidebar and clarify read-only planning before production writes.
- 0d95d53: Fix prompt composer model selection in embedded prompt dialogs.
- 0d95d53: Add generic client/server error capture helpers and report agent chat run failures through configured capture providers.

## 0.12.20

### Patch Changes

- 715eda8: Fix sidebar popover clipping, terminal startup visibility, automation test routing, and tiny usage rounding.
- 715eda8: Add Vercel workspace deploy packaging and make the shared-token login gate provider-neutral.
- 715eda8: Reduce noisy CLI Sentry reports for handled workspace watcher limits and skip first-party agent symlinks during GitHub tarball extraction on Windows.
- 715eda8: Collect browser and server Sentry errors from shared DSN deploy configuration.
- 715eda8: Add `vercel` as a third workspace-deploy preset alongside `cloudflare_pages` and `netlify`. When `preset=vercel`, the build emits into `.vercel/output` so the standard Vercel build pipeline picks it up unmodified.

## 0.12.19

### Patch Changes

- 3b88628: Disable Plan mode in local browser dev surfaces and point users to Agent Native Desktop for planning.
- 3b88628: Use cross-site session cookie attributes for Google OAuth sessions so embedded app chat remains authenticated.
- 3b88628: Default the framework to the Builder gateway's `gpt-5-5` model alias, centralize built-in engine model defaults/catalogs in `model-config.ts`, and stop hard-coding `DEFAULT_MODEL` for A2A / MCP / integrations runs — the resolved engine's default is used instead. Also adds a "Use Builder" cloud CTA alongside the Desktop CTA in the AgentPanel and CodeRequiredDialog code-access-unavailable surfaces, including a `useBuilderConnectUrl()` hook that wires up the secondary link from `/_agent-native/builder/status`.
- 3b88628: Fix lazy workspace dev root routing, live app discovery, and generated app dependency startup.
- 3b88628: Keep oversized pasted-text chat attachments from overflowing agent context and render them consistently as pasted-text chips.

## 0.12.18

### Patch Changes

- c17f651: Reorder agent-engine resolution so a Builder-connected user always wins over a stale settings row. Add `isStoredEngineUsableForRequest` so per-user `app_secrets` (Builder or BYOK) are recognized when deciding whether a stored engine is usable, and update `/agent-engine/status` and the engine picker to honor the same priority chain at request time.
- c17f651: Polish OAuth callback close-tab success and error page spacing.

## 0.12.17

### Patch Changes

- ad7006d: Block frame-routed code submissions when local source access is unavailable and point users to Agent Native Desktop for code, CLI, and Workspace access.
- ad7006d: Keep workspace app creation prompts editable after submit and clarify that named products are design references, not implied API-key requirements.
- ad7006d: Fix Plan mode selector mouse interaction and remove keyboard-shortcut wording from user-facing mode guidance.
- ad7006d: Suppress benign Vite connection-reset error overlays and keep narrow composer controls contained.

## 0.12.16

### Patch Changes

- 27c3dbc: Submit a pending email invite when closing the share popover with Done.
- 27c3dbc: Clarify provider-specific tool routing so named external sources win over generic warehouse tools.
- 27c3dbc: Improve chat run completion durability and clarify mounted workspace app routing.
- 27c3dbc: Preserve public forwarded host/protocol headers when proxying workspace apps so Google OAuth redirect URIs use the stable gateway origin instead of internal app dev ports.

## 0.12.15

### Patch Changes

- b07f933: Export the Builder agent engine for template media pipelines.
- b07f933: Clarify workspace app creation instructions to reuse hosted first-party apps as A2A neighbors instead of cloning or nesting templates.
- b07f933: Make extension removal handle shared extensions and refresh installed widgets cleanly.

## 0.12.14

### Patch Changes

- 5115f28: Add Dispatch knowledge packs to workspace resources and let new-app flows grant them alongside vault keys.
- 5115f28: Add an optional run-local command CTA to auth marketing pages.
- 5115f28: Retry workspace app dev servers after early launch failures during local app creation.

## 0.12.13

### Patch Changes

- b1595cc: Allow Builder Connect to override deploy-level Builder credentials with request-scoped credentials.
- b1595cc: Improve Builder transcription error detail and remove OpenAI-specific fallback guidance.

## 0.12.12

### Patch Changes

- 4caaa4f: Keep workspace app creation on same-origin gateway routes and stop child dev servers from advertising private ports.
- 4caaa4f: Give the extensions empty state more breathing room.

## 0.12.11

### Patch Changes

- e076977: Hide the share dialog notification checkbox until an email invite is entered.
- e076977: Match the share popover and trigger surfaces to app sidebar backgrounds.
- e076977: Surface tool-input progress in agent chat and recover from stale reconnect streams.
- e076977: Make generated workspace apps preserve their mounted base path and keep Dispatch app links on the active workspace gateway origin.
- e076977: Support stable root OAuth callbacks for path-mounted workspace apps and clarify new-app prompts.

## 0.12.10

### Patch Changes

- f0776fc: Decode extension route path segments so extensionData removal works for item IDs with spaces.
- f0776fc: Keep short pasted text inline in the agent composer and only convert page-sized pastes to attachments.
- f0776fc: Keep agent chat auth prompts scoped to the originating chat and surface streamed provider auth errors as run errors.
- f0776fc: Preserve structured tool history across agent chat recovery turns and suppress duplicate read-only calls during continuations.

## 0.12.9

### Patch Changes

- 7a849c3: Give the shared extensions sidebar header room for its full label and replace the docs icon tooltip with an interactive popover.
- 7a849c3: Include the Images app as a default connected A2A agent and guide agents to use it for generated imagery.
- 7a849c3: Images-template library refactor + agent-discovery polish.
- 7a849c3: Remember extension sidebar usage and add collapsible sort controls.

## 0.12.8

### Patch Changes

- fdf8cfc: Align the agent sidebar toggle button with standard top-bar icon controls.

## 0.12.7

### Patch Changes

- 7d0ebfc: Add Builder-managed image generation onboarding support and endpoint helpers.
- 7d0ebfc: Move Mail lower in template pickers, remove non-featured templates from default selections, and add a hosted Mail Google sign-in notice.
- 7d0ebfc: Preserve standard `backdrop-filter` declarations in production CSS builds.
- 7d0ebfc: Allow share dialogs to customize visibility and link copy for template-specific access wording.

## 0.12.6

### Patch Changes

- 471bf1e: Treat invalid chat session tokens as auth failures and make empty command-menu AI prompts open chat.
- 471bf1e: Show Builder.io LLM usage as agent credit spend when Builder is the active provider.
- 471bf1e: Harden agent chat auth and gateway recovery paths.
- 471bf1e: Keep programmatic new-tab chat sends on the requested thread id so UI callers can track run state.
- 471bf1e: Allow the feedback popover's first submit click to load the form schema before sending.
- 471bf1e: Persist the agent chat model selection across page refreshes.
- 471bf1e: Allow notification bells to show clearer empty-state copy.
- 471bf1e: Add optional share notification controls and direct resource links for sharing emails.

## 0.12.5

### Patch Changes

- 2e99cca: Fix workspace scaffolding for the Design template and clarify local Dispatch setup.
- 2e99cca: Shorten the composer model selector reasoning effort label.
- 2e99cca: Send Builder gateway owner headers from the Builder agent engine and keep Builder auth failures out of the app-login flow.
- 2e99cca: Register the `images` template with `hidden:true` in the CLI catalog. The template directory exists in-flight but is intentionally not surfaced in public template lists yet.

## 0.12.4

### Patch Changes

- e2bce24: Keep the prompt composer TipTap schema minimal to avoid ProseMirror recursion in deployed pages.
- e2bce24: Keep existing extension edits on the update-extension path instead of routing them to Builder code changes.
- e2bce24: Recover dev pages when Vite serves outdated optimized dependency 504 responses.

## 0.12.3

### Patch Changes

- d83d5ec: Recognize Images artifacts in cross-app A2A responses.
- d83d5ec: Improve the shared access-token login page with clearer guidance and visible failure states.

## 0.12.2

### Patch Changes

- b878dd8: `agentNative.chatRunning` event now reflects both true and false transitions of `isRunning`, allowing UI consumers to track agent work state in real time.
- b878dd8: Broadcast agent chat running state when normal runs start or stop, and switch the agent panel back to chat when submitting a visible prompt.

## 0.12.1

### Patch Changes

- 47b8486: Avoid duplicate TipTap link extensions when editors provide custom link behavior.

## 0.12.0

### Minor Changes

- 14f7b63: Add agent-callable extension list, hide, unhide, and delete actions so chat can manage visible extensions without raw SQL.

### Patch Changes

- 14f7b63: Tighten generic chat document uploads and make restored chat threads settle at the bottom after refresh.
- 14f7b63: Collapse the extension sidebar list to three items by default.
- 14f7b63: Clarify personal versus organization MCP server scope guidance in the connection UI.
- 14f7b63: Create extensions with private visibility even when the creator belongs to an organization.

## 0.11.4

### Patch Changes

- 24781d0: Clarify Dispatch new-app instructions so Builder branches scaffold separate workspace apps instead of editing starter.
- 24781d0: Add a template hook for retrying guarded final agent answers before they are shown.
- 24781d0: Match the agent sidebar loading header height to the loaded panel header.

## 0.11.3

### Patch Changes

- 81d5b68: Use the Tabler message-dots icon for the agent sidebar toggle.
- 81d5b68: Keep agent DB tools scoped to owner rows when org context is active and rows have no org id.
- 81d5b68: Suppress automatic stale route-chunk reloads inside the Agent Native desktop app.
- 81d5b68: Harden the public-viewer anonymous-owner resolver: validate Referer origin, require the exact Builder callback path, and discard expired status connect URLs in the embedded settings panel.

## 0.11.2

### Patch Changes

- 8975a96: Allow Builder connect popups to complete from local embedded settings panels by accepting a short-lived signed connect token.
- 8975a96: Polish agent chat menus, icons, and message timestamps.
- 8975a96: Add share-link support to the share button and allow templates to expose read-only anonymous chat and Builder-connect surfaces.

## 0.11.1

### Patch Changes

- 2d52595: Detect Builder preview webviews from builder preview URL markers so code prompts route to Builder chat.
- 2d52595: Use the shadcn popover animation for the framework share control and keep visibility changes fresh after reopening.

## 0.11.0

### Minor Changes

- b4bdd34: Workspace settings reachable from the org switcher in every template, plus admin-vs-member roles, bulk invite (typed list, paste-many, CSV upload) with per-row role selection, and stricter auto-join domain validation (must match the admin's own email domain; free email providers like gmail.com are blocked).
  - `OrgSwitcher` exposes a "Workspace settings" link (configurable via `settingsPath`, default `/team`).
  - `useInviteMember` accepts `{ email, role }`; new `useBulkInviteMembers` and `useChangeMemberRole` hooks.
  - New `PUT /_agent-native/org/members/:email/role` endpoint; only owners can promote/demote admins.
  - `org_invitations` gains a `role` column so invites land at the assigned role on accept.
  - `OrgPendingInvitation` type now includes `role`.
  - New `isFreeEmailProvider` export with a curated blocklist used by `setDomainHandler`.

### Patch Changes

- b4bdd34: Replace custom overflow menu in extensions sidebar with shadcn DropdownMenu (Radix-portaled). Fixes the menu being clipped by the sidebar's stacking context and adds the standard fade/zoom animations.
- b4bdd34: Sign connected-agent A2A mention calls with the current request identity in production.
- b4bdd34: Fix Cloudflare Pages deploy failure with `Cannot require: tty`. Terminal-detection helpers in transitive deps (chalk, picocolors, supports-color, debug, etc.) call `require("tty")` at module init; the bundled-worker require shim now covers `tty`, `readline`, `process`, `console`, `perf_hooks`, and `string_decoder` so those CJS calls resolve to the matching ESM imports instead of throwing at deploy time.
- b4bdd34: Allow actions to stop an agent turn after deterministic provider failures instead of feeding the error back into automatic retries.

## 0.10.0

### Minor Changes

- 721f125: NotificationsBell: clicking a notification with `metadata.link` now navigates to that URL (and marks the notification read). Notifications without a link keep the previous click-to-mark-read-only behavior.

### Patch Changes

- 977af2b: Restyle the Builder connect callback / error pages to match the rest of the framework's UI — Inter font, neutral-zinc palette, and dark/light mode that follows the user's app theme (or `prefers-color-scheme`).
- a562b18: Fix extension table initialization and respect reduced-motion preferences on first-run onboarding backgrounds.
- a562b18: Improve chat stop/error fallback copy and normalize escaped tooltip shortcuts.
- 57b7e0a: Composer accepts file drops directly. Previously, dragging a file (PDF, PPTX, image, etc.) into the prompt composer triggered the browser's default behavior (navigating to the file), even though the "+" button accepted the same file types. The composer now intercepts drops, mirroring the existing paste handler — drag a deck or screenshot in and it attaches like a normal upload.
- 57b7e0a: PromptComposer now inlines small text files (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, etc., plus any `text/*` MIME) into the prompt as `<uploaded-text-file>` blocks instead of only attaching them as binary uploads. Truncates after 60k characters. The original file is still attached as well, so server-side handlers that prefer the binary path keep working.
- 57b7e0a: Resolve org-shared Builder credentials when auto-selecting the chat engine.
- a562b18: Fix queued chat handoff after a run completes and improve multi-invite banner spacing.
- a562b18: Detect Netlify Lambda runtimes for hosted agent soft timeouts and cap repeated stale-run recovery loops.
- a562b18: Fix Vite "Failed to resolve import @tauri-apps/api/core" error in fresh CLI workspaces. The settings panel called `window.__TAURI_INTERNALS__.invoke` directly instead of dynamically importing `@tauri-apps/api/core`, so non-desktop installs no longer crash on the first SPA load.
- 57b7e0a: Wrap shadcn `Tooltip` usages in a `TooltipProvider` so the agent panel and other top-level components don't crash on render. PR #509 swapped native `title` hints for `Tooltip`, but `@radix-ui/react-tooltip@1.2.x` requires a provider ancestor and threw `'Tooltip' must be used within 'TooltipProvider'` on the docs site and any template embedding the agent sidebar.
- 977af2b: Route Dispatch overview prompts to Builder chat in Builder frames and keep the app agent sidebar collapsed there by default.
- a562b18: Improve workspace setup feedback and allow adding the Dispatch workspace app from the CLI.
- a562b18: Fix completed chat runs getting restored as permanently thinking after partial thread saves.
- a562b18: Server-side Sentry now attaches user/org context to more error paths. Failed login/signup attempts capture as `level:warning` with `tags.auth:login|signup` and the attempted email pinned to `user.email` (filtered to skip routine bad-credential noise). Every `runWithRequestContext({ userEmail, orgId, ... })` invocation now also tags Sentry's per-request isolation scope, so action handlers, agent-chat tool re-entries, integration webhook processors, and A2A calls all surface errors under the right user even when no session cookie was attached to the request.
- 57b7e0a: Stop reloading the agent chat after Builder or secret configuration updates.
- 57b7e0a: Initialize Sentry inside the Nitro server so 5xx errors thrown by framework routes, action handlers, and agent-chat streams are reported with per-request user context. Driven by the `SENTRY_SERVER_DSN` env var (no-op when unset). Complements the existing CLI and browser Sentry init points without wiring them together — each maps to a different Sentry project.
- a562b18: Improve shared extension shell navigation, creation guidance, and polling recovery.
- a562b18: Recover automatically from no-detail Builder gateway errors in agent chat.
- 57b7e0a: Unify request-scoped secret resolution to read user → org → workspace rows from `app_secrets` everywhere. Previously, `getOwnerApiKey()`, `resolveSecret()`, voice provider status, transcribe-voice, and Google Realtime each had their own slightly different read order — some only checked the user row, some checked user + org but not workspace. They now all walk the same chain, so an org-shared (or workspace-scoped) key is honored consistently no matter which call site resolves it. Solo (no-org) sessions fall back to a `workspace:solo:<email>` row.

## 0.9.1

### Patch Changes

- 4090a2a: PR #511 follow-up fixes:
  - `/runs/active` now surfaces recently-completed and recently-errored SQL runs (within a 10-minute reconnect window) so the agent-chat adapter can replay synthesized done/error events from the run-events stream instead of retrying the original POST when the producer's in-memory state was already evicted (different serverless isolate). Without this, a POST that failed after the server already accepted and finished the run could re-execute the agent turn and double-apply mutations.
  - `/builder/status` now reads the user's active org via `getOrgContext(event)` and passes the orgId into `runWithRequestContext()` so the status poller resolves org-shared Builder credentials. Previously, an admin's org-scope OAuth result was invisible to every other org member's status poller, leaving the UI showing "not connected" even though chat resolved the credentials correctly.
  - Registered secrets routes now treat `scope: "org"` as a first-class scope: writes and deletes require an active org and an owner/admin role (`canMutateOrgScope`), and `resolveScopeId("org", …)` rejects requests without an active org rather than falling back to a `solo:` scopeId. Ad-hoc secret routes were already restricted to `user`/`workspace` and remain unchanged.

## 0.9.0

### Minor Changes

- 117d476: Builder credentials are now stored at org scope by default when an owner/admin connects, so a single OAuth flow powers AI chat for everyone in that org.
  - New `app_secrets` scope: `"org"` (alongside `"user"` and `"workspace"`).
  - `writeBuilderCredentials(email, creds, { orgId, role })` writes at `scope: "org"` when the connecting user is owner/admin of an active org. Plain members (or users in Personal mode) keep writing at `scope: "user"` so a teammate can never overwrite the org-shared connection. The Builder OAuth callback now passes `orgId`+`role` automatically — existing direct callers without options keep their previous user-scope behaviour.
  - `resolveBuilderCredential` and `resolveSecret` now check user scope first, then fall back to the active org's row. `${env.BUILDER_PRIVATE_KEY}` (deploy-managed mode) still wins over both, unchanged.
  - `deleteBuilderCredentials(email, { orgId, role })` mirrors the connect-side scope decision, so a Disconnect press undoes exactly what the same user's Connect press wrote — no orphaned org-shared rows for owners, no accidental org-wide tear-downs from a member's personal disconnect.
  - Helper `resolveCredentialWriteScope(email, orgId, role)` exposes the scope decision for any future credentials integration that wants the same default-to-org-when-admin behaviour.

  Migration: existing per-user Builder connections from before this change keep working for the connecter — but other org members won't auto-resolve to them. To promote a user-scope connection to org-shared, the owner/admin disconnects and reconnects once in the affected app.

- dca4f6d: Domain-based org join across the framework — three connected changes so a fresh signup whose email matches an existing org's `allowed_domain` lands inside that org without manual steps:
  - **Auto-join on signup.** New `autoJoinDomainMatchingOrgs(email)` helper, called from the Better Auth `user.create.after` hook. Anyone who signs up with an email whose domain matches `organizations.allowed_domain` is added to that org as a `member` immediately, and `active-org-id` is set to it (only when the user doesn't already have an active org from a pending invite). Idempotent and missing-table-safe.
  - **OrgSwitcher popover** now renders a "Join your team" section listing every domain-match org with a one-click Join button, for users who signed up before the org existed (or whose auto-join failed). Wires through `useJoinByDomain`.
  - **InvitationBanner** also renders domain-match orgs as a top-of-app prompt, so existing-but-not-yet-joined users see a clear CTA without needing to open the picker.

  The backend (`organizations.allowed_domain`, `getMyOrgHandler.domainMatches`, `joinByDomainHandler`, `useJoinByDomain`) was already in place — these changes wire it into the signup flow and the prominent UIs.

### Patch Changes

- dca4f6d: Improve agent chat setup and auth recovery by routing missing provider setup to Builder.io and surfacing hosted sign-in for authentication failures.
- dca4f6d: Replace native title hints on interactive controls with shadcn tooltips.
- dca4f6d: Resolve agent engine status against the active request user so per-user provider secrets are detected correctly.
- a1fef80: Add [dev-session] log when auto-binding email in CLI runner; fix TS narrowing in db-reset-dev-owner; remove redundant trim in zeroChangesHint.
- 117d476: Harden GitHub design-token imports with token-aware fetch helpers and keep persisted agent run diagnostics longer for reconnect investigation.
- dca4f6d: Keep agent chat auto-recovery alive across long runs that keep making progress.
- dca4f6d: Dedupe collaborative presence avatars by email and show collaborator emails on hover.
- dca4f6d: Smooth signup email verification handoff back into the app.

## 0.8.2

### Patch Changes

- 3424455: Fix `agent-native create` failing with "Unrecognized archive format" on freshly published versions. The CLI now tries the changesets per-package tag (`@agent-native/core@<version>`) first, falls back to the legacy `v<version>` tag, and finally to `main` — so it keeps working through the release-tag scheme shift introduced when the framework adopted changesets.
- 81005c4: Add an optional AgentPanel chat notice render slot.
- 81005c4: Export a reusable client theme initialization script helper.
- 81005c4: Avoid stale Vite prebundles for core source aliases in monorepo development.
- 81005c4: Initialize template light/dark classes before hydration and normalize legacy theme storage.

## 0.8.1

### Patch Changes

- e3a8798: Recover agent chat runs automatically when streams time out, disconnect, or stay open without producing progress.

## 0.8.0

### Minor Changes

- e375642: Add `@agent-native/core/usage` subpath export for `getUsageSummary` so server-side consumers (Cloudflare Workers / Pages) can import it without hitting the curated browser entry. Switch dispatch's usage-metrics store to the new subpath, fixing the dispatch CF Pages build failure.

### Patch Changes

- bcb2069: Hide partial assistant text from transient agent-chat continuations while retaining it as continuation history.
  Recover agent chat streams that stay connected but stop producing progress events.

## 0.7.85

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.

## 0.7.84

### Patch Changes

- a75a89c: In Builder.io's editor frame, `sendToAgentChat` now keeps content prompts self-targeted so the embedded app's own `AgentSidebar` receives them. Code requests still delegate to Builder via `builder.submitChat`. Drops the explicit `isInBuilderFrame()` branching from dispatch's home composer — the routing now lives in core.
- a75a89c: Add Dispatch workspace usage metrics and preserve app ids in token usage rows.
- a75a89c: Recommend Dispatch more clearly during workspace scaffolding and add a packaged Dispatch extension API for workspace-owned tabs.
- a75a89c: Add server-side 302 redirect from `/tools` and `/tools/:id` page routes to `/extensions/...` so existing bookmarks for the renamed primitive keep working. Honors `APP_BASE_PATH` for workspace deployments.
