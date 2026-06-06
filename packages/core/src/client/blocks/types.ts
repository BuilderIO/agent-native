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
  renderMarkdown?: (markdown: string) => React.ReactNode;
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
  }) => React.ReactNode;
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
  onChange: (next: TData) => void;
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
