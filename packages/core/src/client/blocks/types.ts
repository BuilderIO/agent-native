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

export type BlockPlacement = "block" | "inline";

export type BlockVisualFrame = "auto" | "show" | "hide";

export type MdxAttrValue =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>;

export interface BlockAttrReader {
  string(name: string): string | undefined;
  number(name: string): number | undefined;
  bool(name: string): boolean | undefined;
  array<T = unknown>(name: string): T[] | undefined;
  object<T = unknown>(name: string): T | undefined;
  raw(name: string): unknown;
}

export interface BlockMdxConfig<TData> {
  tag: string;
  toAttrs: (data: TData) => Record<string, MdxAttrValue | undefined>;
  fromAttrs: (attrs: BlockAttrReader, children: string) => TData;
  childrenField?: keyof TData & string;
  serializeChildren?: (data: TData) => string;
  parseChildren?: (childNodes: unknown[], idContext: string) => Partial<TData>;
}

export interface BlockRenderContext {
  dialect?: "gfm" | "nfm";
  textDirection?: "ltr" | "rtl";
  visualFrame?: Exclude<BlockVisualFrame, "auto">;
  localizeHref?: (href: string) => string;
  resolveAssetSrc?: (assetId: string) => string | undefined;
  pickAsset?: () => Promise<{ assetId: string; url?: string } | null>;
  uploadFile?: (file: File) => Promise<{ url: string; assetId?: string }>;
  callAction?: (name: string, args: unknown) => Promise<unknown>;
  sanitizeHtml?: (html: string, css?: string) => string;
  renderMarkdown?: (
    markdown: string,
    options?: { className?: string },
  ) => React.ReactNode;
  showCodeAnnotationOverlays?: boolean;
  codeAnnotationLayout?: {
    hoverSide?: "left" | "right";
    hoverFallbackSide?: "left" | "right" | "below";
    showByDefaultWhenRoom?: boolean;
    defaultVisibleAnnotations?: "all" | "first";
    marginSide?: "left" | "right" | "auto";
  };
  renderMarkdownEditor?: (props: {
    value: string;
    onChange: (next: string) => void;
    editable: boolean;
    blockId?: string;
    className?: string;
    ariaLabel?: string;
  }) => React.ReactNode;
  renderAiFieldAction?: (props: BlockAiFieldActionProps) => React.ReactNode;
  renderBlock?: (props: {
    block: NestedBlock;
    onChange?: (next: NestedBlock) => void;
    editing?: boolean;
    compactVisuals?: boolean;
  }) => React.ReactNode;
  renderBlocksEditor?: (props: {
    blocks: NestedBlock[];
    onChange: (blocks: NestedBlock[]) => void;
    editable: boolean;
    containerBlockId: string;
    regionId: string;
    regionLabel?: string;
    compactVisuals?: boolean;
  }) => React.ReactNode;
  renderEditSurface?: (props: {
    title: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    trigger: React.ReactNode;
    children: React.ReactNode;
    variant?: "panel" | "menu";
    blockId?: string;
    blockType?: string;
    blockTitle?: string;
    blockSummary?: string;
    blockData?: unknown;
  }) => React.ReactNode;
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
  instructions: string;
  companionFields?: Array<{
    label: string;
    value: string;
    language?: string;
  }>;
}

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

export interface BlockReadProps<TData> {
  data: TData;
  blockId: string;
  title?: string;
  summary?: string;
  ctx: BlockRenderContext;
  compactVisuals?: boolean;
}

export interface BlockEditProps<TData> {
  data: TData;
  onChange: (next: TData, meta?: BlockDataChangeMeta) => void;
  editable: boolean;
  blockId: string;
  title?: string;
  summary?: string;
  ctx: BlockRenderContext;
}

export interface BlockSpec<TData = unknown> {
  type: string;
  schema: ZodType<TData>;
  mdx: BlockMdxConfig<TData>;
  Read: FC<BlockReadProps<TData>>;
  Edit?: FC<BlockEditProps<TData>>;
  placement: BlockPlacement[];
  notionCompatible?: boolean;
  editSurface?: "inline" | "panel" | "container" | "none";
  container?: BlockContainerSpec<TData>;
  label: string;
  icon?: FC<{ size?: number; className?: string }>;
  description: string;
  empty?: () => TData;
  patches?: Record<string, (data: TData, op: Record<string, unknown>) => TData>;
}

export function defineBlock<TData>(spec: BlockSpec<TData>): BlockSpec<TData> {
  return spec;
}
