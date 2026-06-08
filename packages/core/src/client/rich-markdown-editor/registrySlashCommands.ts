import type { BlockRegistry, BlockSpec } from "../blocks/index.js";

const COMPACT_REGISTRY_BLOCK_DESCRIPTIONS: Record<string, string> = {
  callout: "Emphasized note",
  diagram: "Inline diagram",
  wireframe: "Screen mockup",
  "question-form": "Interactive questions",
  checklist: "Checklist items",
  table: "Editable grid",
  "table-block": "Editable grid",
  "code-tabs": "Tabbed code snippets",
  "custom-html": "Sandboxed HTML",
  tabs: "Tabbed block group",
  columns: "Side-by-side columns",
  mermaid: "Mermaid diagram",
  "api-endpoint": "API reference",
  "openapi-spec": "OpenAPI document",
  "data-model": "ERD schema",
  diff: "Code diff",
  "file-tree": "File/change tree",
  "json-explorer": "JSON tree",
};

/**
 * Compact, user-facing slash-menu copy for structured registry blocks. The full
 * registry description remains available through search text, but the visible
 * row should scan like a command palette, not a block reference page.
 */
export function getRegistryBlockSlashDescription(
  spec: Pick<BlockSpec, "type" | "description">,
): string {
  return (
    COMPACT_REGISTRY_BLOCK_DESCRIPTIONS[spec.type] ??
    spec.description.trim().replace(/\s+/g, " ")
  );
}

/** Searchable text for registry block slash items, including raw type keywords. */
export function getRegistryBlockSlashSearchText(
  spec: Pick<BlockSpec, "type" | "label" | "description">,
): string {
  return [spec.label, spec.description, spec.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Shared builder for the registry-derived block slash commands both the plan and
 * content editors offer. Both apps take every `BlockSpec` whose `placement`
 * includes `"block"`, gate it by Notion-compatibility when the open document is
 * linked to a Notion page, and emit one slash item per surviving spec that
 * inserts that block's atom node. The only legitimate per-app differences are:
 *
 *  - the ITEM SHAPE (plan uses a text-glyph `icon`, content a React component),
 *  - the Notion-compat PREDICATE (plan unions in prose-only NFM analogs, content
 *    reads the registry `notionCompatible` flag directly), and
 *  - the INSERT behavior (plan inserts a `planBlock` node, content a
 *    `registryBlock` node seeded with inline `__raw`).
 *
 * Those three are injected; everything else (the `list("block")` source, the
 * Notion filter wiring, the one-item-per-spec mapping) lives here so adding a
 * new library block only touches the registry, never the slash builders.
 */
export interface BuildRegistryBlockSlashItemsOptions<TItem, TEditor> {
  /**
   * When `true`, only specs the predicate accepts are offered (the open document
   * is linked to a Notion page, so blocks that can't round-trip to NFM are
   * hidden). When unset/false, every block-placed spec is offered.
   */
  notionCompatibleOnly?: boolean;
  /**
   * Decide whether a spec round-trips to Notion. Defaults to the spec's own
   * `notionCompatible` flag (content's rule). Plan passes a predicate that unions
   * in prose-only NFM analogs not carried as registry flags.
   */
  isNotionCompatible?: (spec: BlockSpec) => boolean;
  /** Build one app-shaped slash item from a surviving block spec. */
  toItem: (spec: BlockSpec, insert: (editor: TEditor) => void) => TItem;
  /**
   * Optional app-level capability gate. Use this for blocks whose schema is
   * registered for parse/render compatibility but whose authoring experience is
   * not available in this editor yet.
   */
  includeSpec?: (spec: BlockSpec) => boolean;
  /**
   * Insert this spec's block atom into the editor. Plan inserts a `planBlock`
   * node; content inserts a `registryBlock` node seeded with inline `__raw`.
   */
  insertBlock: (editor: TEditor, spec: BlockSpec) => void;
}

/**
 * Build the registry-derived block slash items, shared by plan and content. Each
 * app prepends its own prose/base commands and wraps the result in its own item
 * type via {@link BuildRegistryBlockSlashItemsOptions.toItem}.
 */
export function buildRegistryBlockSlashItems<TItem, TEditor>(
  registry: BlockRegistry,
  options: BuildRegistryBlockSlashItemsOptions<TItem, TEditor>,
): TItem[] {
  const isCompatible =
    options.isNotionCompatible ?? ((spec) => Boolean(spec.notionCompatible));
  return registry
    .list("block")
    .filter((spec) => options.includeSpec?.(spec) ?? true)
    .filter((spec) => !options.notionCompatibleOnly || isCompatible(spec))
    .map((spec) =>
      options.toItem(spec, (editor) => options.insertBlock(editor, spec)),
    );
}
