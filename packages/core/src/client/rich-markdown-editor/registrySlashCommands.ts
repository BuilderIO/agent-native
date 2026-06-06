import type { BlockRegistry, BlockSpec } from "../blocks/index.js";

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
    .filter((spec) => !options.notionCompatibleOnly || isCompatible(spec))
    .map((spec) =>
      options.toItem(spec, (editor) => options.insertBlock(editor, spec)),
    );
}
