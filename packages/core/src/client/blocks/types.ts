import type { FC } from "react";
import type { ZodType } from "zod";

/**
 * Block-registry contract. A `BlockSpec` describes one document block end to end:
 * its data shape (`schema`), how it round-trips to MDX source (`mdx`), how it
 * renders read-only (`Read`) and how it is edited (`Edit`, or an auto-generated
 * schema-driven editor when omitted), where it can be placed (`placement`), and
 * metadata for menus / agent schema export.
 *
 * The registry runs ALONGSIDE existing per-block code (the plan `PlanBlockView`
 * switch + `serializeBlock`/`parseBlock`). Renderers check the registry first;
 * unregistered block types fall through to the legacy code path unchanged. The
 * MDX `tag` and attribute shape for a converted block MUST match the historical
 * encoding (e.g. `<Callout tone>…body…</Callout>`) so stored `.mdx` files still
 * parse byte-compatibly.
 */

/** Where a block can be placed in a document. */
export type BlockPlacement = "block" | "inline";

/**
 * A serialized MDX/NFM attribute value before the shared `prop()` encoder runs.
 * `prop()` decides string-vs-JSON encoding; this is just the value domain.
 */
export type MdxAttrValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

/**
 * Type-narrowed reader over the resolved MDX attributes of a parsed block node.
 * The values are already estree/JSON-resolved by the shared attribute reader
 * (the same engine `plan-mdx.ts` uses), so a spec's `fromAttrs` never touches
 * the AST directly.
 */
export interface BlockAttrReader {
  string(name: string): string | undefined;
  number(name: string): number | undefined;
  bool(name: string): boolean | undefined;
  array<T = unknown>(name: string): T[] | undefined;
  object<T = unknown>(name: string): T | undefined;
  raw(name: string): unknown;
}

/**
 * Maps a block's validated data to/from its MDX component representation.
 * `tag` is the JSX component name in source (e.g. "Callout"). It MUST match the
 * historical name in `plan-mdx.ts` `BLOCK_COMPONENTS` / stored `.mdx` files or
 * existing plans break.
 */
export interface BlockMdxConfig<TData> {
  /** JSX component name in MDX source. Stable contract — never rename. */
  tag: string;
  /**
   * Encode `data` → a flat attribute bag. The registry serializer runs each
   * value through the shared `prop()` encoder (string-vs-JSON heuristic) and
   * preserves insertion order, so write the keys in the exact historical order.
   * Return `undefined` for a key (or omit it) to drop the attribute. When
   * `childrenField` is set, that field is excluded from the attribute bag.
   */
  toAttrs: (data: TData) => Record<string, MdxAttrValue | undefined>;
  /**
   * Decode resolved attributes (+ optional children markdown) → data. Must
   * tolerate missing/partial attributes for backward-compat (mirror today's
   * `?? []` / `?? ""` defaults).
   */
  fromAttrs: (attrs: BlockAttrReader, children: string) => TData;
  /**
   * When set, this data field is a markdown string serialized as MDX *children*
   * between the open/close tags (prose-bearing blocks: rich-text, callout)
   * rather than as a prop — so the body survives as real, inline-editable MDX
   * prose in source.
   */
  childrenField?: keyof TData & string;
  /**
   * Opt-in custom children serializer for blocks whose internals are nested MDX
   * components rather than a single markdown string (e.g. wireframe → Screen/kit
   * primitives). When present it overrides `childrenField`. `serializeChildren`
   * returns the raw inner MDX; `parseChildren` receives the child MDX AST nodes.
   */
  serializeChildren?: (data: TData) => string;
  parseChildren?: (childNodes: unknown[], idContext: string) => Partial<TData>;
}

/**
 * App-injected capabilities. Core blocks stay app-agnostic by taking these
 * rather than importing app services — mirroring `createImageExtension`'s
 * `onImageUpload` injection. Provided via `BlockRegistryProvider`.
 */
export interface BlockRenderContext {
  /** Markdown dialect for the auto-editor's rich-text field. */
  dialect?: "gfm" | "nfm";
  /** Resolve an asset id → displayable URL. */
  resolveAssetSrc?: (assetId: string) => string | undefined;
  /** Open the shared asset picker (returns the chosen asset). */
  pickAsset?: () => Promise<{ assetId: string; url?: string } | null>;
  /** Upload a local file, returns a hosted URL. */
  uploadFile?: (file: File) => Promise<{ url: string; assetId?: string }>;
  /** Call an app action by name (for blocks that fetch live data). */
  callAction?: (name: string, args: unknown) => Promise<unknown>;
  /** Sanitizer for HTML-bearing blocks. Provided by the app/core. */
  sanitizeHtml?: (html: string, css?: string) => string;
  /**
   * Render a markdown string with the app's read-only markdown renderer. Lets a
   * core block (whose `Read` lives in core) defer prose rendering to the app's
   * markdown reader (e.g. the plan `PlanMarkdownReader`) without importing it.
   */
  renderMarkdown?: (
    markdown: string,
    options?: { className?: string },
  ) => React.ReactNode;
  /**
   * Static capture mode: render every code/diff line annotation as a visible
   * inline overlay instead of requiring hover.
   */
  showCodeAnnotationOverlays?: boolean;
  /**
   * Render an inline, editable rich-markdown field. The auto-editor calls this
   * for a `markdown()`-tagged field so the app owns the editor wiring (collab,
   * autosave debounce, dialect) rather than core hardcoding it.
   */
  renderMarkdownEditor?: (props: {
    value: string;
    onChange: (next: string) => void;
    editable: boolean;
    blockId?: string;
    className?: string;
    ariaLabel?: string;
  }) => React.ReactNode;
  /**
   * Render an app-owned edit-by-prompt affordance ("Describe a change…") for a focused/editable block
   * field. Core block editors pass the current field value and nearby companion
   * fields; the host app decides how to collect the prompt and route it to the
   * agent sidebar. This keeps reusable core blocks from importing app-specific
   * popover/composer code while still exposing a generic AI edit hook.
   */
  renderAiFieldAction?: (props: BlockAiFieldActionProps) => React.ReactNode;
  /**
   * Render a nested child block through the app's own block dispatcher. Container
   * blocks whose `Read`/`Edit` live in core (e.g. tabs) call this to render each
   * child so the recursion keeps flowing through the SAME app renderer the
   * top-level document uses — registered children render via their spec, and
   * unregistered (not-yet-converted) children still fall through the app's legacy
   * switch. This is the coexistence seam: a core container never has to know
   * about app-specific child block types. Returns `null`/`undefined` when no
   * dispatcher is wired (read-only/SSR-only contexts can omit it).
   */
  renderBlock?: (props: {
    block: NestedBlock;
    /** Commit a replacement for this child block (edit mode only). */
    onChange?: (next: NestedBlock) => void;
    /** Whether the parent container is being edited. */
    editing?: boolean;
    /** Tighten embedded visuals in dense contexts (e.g. tab panes). */
    compactVisuals?: boolean;
  }) => React.ReactNode;
  /**
   * Render a nested editable block list through the host app's document editor.
   * Container blocks such as columns call this for each editable region so slash
   * commands, nested structured blocks, and ordinary prose behave like the
   * top-level document while the container still persists its normalized runtime
   * data. Source adapters may still expose a human-friendly nested MDX form
   * (for example `<Columns><Column>markdown</Column></Columns>`) and normalize it
   * into these block arrays at runtime.
   */
  renderBlocksEditor?: (props: {
    blocks: NestedBlock[];
    onChange: (blocks: NestedBlock[]) => void;
    editable: boolean;
    containerBlockId: string;
    regionId: string;
    regionLabel?: string;
    /** Tighten embedded visuals in dense regions such as tab panes. */
    compactVisuals?: boolean;
  }) => React.ReactNode;
  /**
   * Wrap a block's edit form in an app-provided "panel" surface (e.g. a shadcn
   * Popover anchored to the corner edit button) for `editSurface: "panel"`
   * blocks. Core renders the rendered `Read` view plus a corner trigger button
   * and the form, then hands them here so the app owns the overlay primitive
   * (core stays shadcn-free, mirroring `renderMarkdownEditor`). When omitted, a
   * panel-mode block falls back to inline editing. `title` is the block label.
   */
  renderEditSurface?: (props: {
    title: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger: React.ReactNode;
    children: React.ReactNode;
    /** Compact action menus omit host block-edit chrome such as edit-by-prompt. */
    variant?: "panel" | "menu";
    /** Metadata for host-provided contextual controls such as the edit-by-prompt CTA. */
    blockId?: string;
    blockType?: string;
    blockTitle?: string;
    blockSummary?: string;
    blockData?: unknown;
  }) => React.ReactNode;
  /**
   * Submit a respondent's answers from a `question-form` / `visual-questions`
   * block back to the host. The app decides how to route the summary (e.g. send
   * to the inline agent, copy to clipboard). Core blocks call this through the
   * context so they never import app-specific submit wiring; omit it and the
   * block degrades to a no-op submit.
   */
  onQuestionFormSubmit?: (summary: string) => void;
}

export interface BlockAiFieldActionProps {
  blockId: string;
  blockType: string;
  blockTitle?: string;
  blockSummary?: string;
  fieldLabel: string;
  fieldValue: string;
  draftScope: string;
  disabled?: boolean;
  /**
   * Human-readable instructions for the host agent prompt. Mention how to patch
   * the block and which sibling fields should be preserved.
   */
  instructions: string;
  companionFields?: Array<{
    label: string;
    value: string;
    language?: string;
  }>;
}

/**
 * The minimal shape of a nested child block passed to {@link
 * BlockRenderContext.renderBlock}. It mirrors the app's block union loosely (the
 * app casts it back to its own block type) — a discriminating `type`, a stable
 * `id`, optional heading/summary, and the type-specific `data`.
 */
export interface NestedBlock {
  type: string;
  id: string;
  title?: string;
  summary?: string;
  data: unknown;
  [key: string]: unknown;
}

export interface BlockContainerRegion {
  id: string;
  label?: string;
  blocks: NestedBlock[];
}

export interface BlockContainerSpec<TData> {
  regions: (data: TData) => BlockContainerRegion[];
  updateRegion: (data: TData, regionId: string, blocks: NestedBlock[]) => TData;
  addRegion?: (data: TData, afterRegionId?: string) => TData;
  removeRegion?: (data: TData, regionId: string) => TData;
  reorderRegion?: (
    data: TData,
    fromRegionId: string,
    toRegionId: string,
  ) => TData;
}

export type BlockDataChangeMeta = {
  containerRegion?: {
    regionId: string;
    blocks: NestedBlock[];
  };
};

/** Props passed to a block's read-only renderer. */
export interface BlockReadProps<TData> {
  data: TData;
  /** Stable block id (for anchors, comment targeting, source patches). */
  blockId: string;
  /** Block heading, when present. */
  title?: string;
  /** Block trailing summary, when present. */
  summary?: string;
  /** Injected app capabilities. */
  ctx: BlockRenderContext;
}

/** Props passed to a block's editor (custom or schema-generated). */
export interface BlockEditProps<TData> {
  data: TData;
  onChange: (next: TData, meta?: BlockDataChangeMeta) => void;
  editable: boolean;
  blockId: string;
  title?: string;
  summary?: string;
  /** Injected app capabilities. */
  ctx: BlockRenderContext;
}

export interface BlockSpec<TData = unknown> {
  /** Discriminator. Equals the runtime block `type`. */
  type: string;
  /** Zod schema for `data`. Drives validation AND the schema-auto-editor. */
  schema: ZodType<TData>;
  /** MDX round-trip config. */
  mdx: BlockMdxConfig<TData>;
  /** Read-only renderer (replaces a `PlanBlockView` switch branch / NodeView). */
  Read: FC<BlockReadProps<TData>>;
  /**
   * Optional editor. When omitted, the registry renders the schema-driven
   * `SchemaBlockEditor` generated from `schema`. Supply for full control
   * (wireframe canvas, diagram editor).
   */
  Edit?: FC<BlockEditProps<TData>>;
  /** Allowed placements: `["block"]`, `["inline"]`, or both. */
  placement: BlockPlacement[];
  /**
   * When `true`, this block's data maps to a Notion-Flavored-Markdown (NFM)
   * analog and therefore round-trips into a Notion page. Apps can derive
   * registry-backed Notion allowlists with
   * {@link BlockRegistry.notionCompatibleTypes} instead of hand-maintaining
   * per-app sets. Set it on registry-atom blocks with an NFM counterpart
   * (checklist, table); leave it `false`/undefined on dev-doc blocks
   * (api-endpoint, openapi-spec, data-model, diff, file-tree, json-explorer,
   * annotated-code, mermaid, custom-html, tabs, code-tabs) and visual/plan-only
   * blocks (wireframe, diagram). Prose blocks that aren't registry atoms
   * (rich-text, callout) carry their NFM analog through the prose path, not this
   * flag.
   */
  notionCompatible?: boolean;
  /**
   * How the block is edited in a `block`-placed document:
   * - `"inline"` — the `Edit`/auto-form renders in place for direct
   *   manipulation of authored content (prose, checklist text, table cells,
   *   code bodies). Schema-ish metadata such as tone/type, tab labels,
   *   language, density, or structural settings should still be tucked behind a
   *   contextual edit/settings affordance inside the custom `Edit`.
   * - `"panel"` — the block shows its rendered `Read` view with a corner edit
   *   button that opens the `Edit`/auto-form in an app-provided panel (popover).
   *   Best for config-driven blocks whose render differs from their props
   *   (custom HTML, charts, any user-registered block).
   * - `"container"` — the block renders its `Edit` in place, and that editor
   *   may call `ctx.renderBlocksEditor` for nested block regions with normal
   *   slash commands and nested structured blocks.
   * Defaults to `"inline"` when a custom `Edit` is supplied, else `"panel"`
   * (auto-form blocks are property forms, ideal for a panel). The app must wire
   * `ctx.renderEditSurface` for `"panel"` to take effect; otherwise it falls
   * back to inline.
   */
  editSurface?: "inline" | "panel" | "container";
  /**
   * Optional generic contract for content-bearing container blocks. Keep this
   * runtime-oriented: it describes editable regions over normalized block arrays;
   * source formats can provide readable nested MDX adapters independently.
   */
  container?: BlockContainerSpec<TData>;
  /** Human label for menus + agent schema export. */
  label: string;
  /** Tabler icon component for UI menus (never emoji/robot/sparkle). */
  icon?: FC<{ size?: number; className?: string }>;
  /** One-line description for the agent schema export. */
  description: string;
  /** Optional default `data` factory for slash-menu insertion (an empty block). */
  empty?: () => TData;
  /**
   * Optional block-specific source-patch handlers, generalizing bespoke ops
   * like `update-custom-html`. Keyed by op name; the registry dispatches a
   * matching patch op here. Generic ops (`update-block` shallow-merge) need none.
   */
  patches?: Record<string, (data: TData, op: Record<string, unknown>) => TData>;
}

/** Identity helper for authoring a spec with full type inference. */
export function defineBlock<TData>(spec: BlockSpec<TData>): BlockSpec<TData> {
  return spec;
}
