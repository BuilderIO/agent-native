/**
 * `@agent-native/core/blocks` — the first-party block registry.
 *
 * A block registry unifies structured document blocks under one `defineBlock`
 * contract: a zod `schema` for the data, an `mdx` config for byte-stable MDX
 * round-trip, a `Read` renderer, an optional `Edit` (auto-generated from the
 * schema when omitted), and `placement` (top-level and/or inline). Apps create a
 * `BlockRegistry`, register the core standard library plus their own specs, and
 * render through `BlockView` inside a `BlockRegistryProvider`. The renderer
 * checks the registry first and falls back to legacy code for unregistered
 * types, so existing documents keep working unchanged.
 *
 * This entry includes the React surface. For server/agent code that must stay
 * React-free, import from `@agent-native/core/blocks/server`.
 */

// Types + authoring
export {
  defineBlock,
  type BlockSpec,
  type BlockPlacement,
  type BlockMdxConfig,
  type BlockAttrReader,
  type BlockRenderContext,
  type BlockReadProps,
  type BlockEditProps,
  type MdxAttrValue,
  type NestedBlock,
} from "./types.js";

// Registry + provisioning
export { BlockRegistry, registerBlocks } from "./registry.js";
export {
  BlockRegistryProvider,
  useBlockRegistry,
  useOptionalBlockRegistry,
} from "./provider.js";

// Rendering
export { BlockView } from "./BlockView.js";
export { SchemaBlockEditor } from "./SchemaBlockEditor.js";

// Schema-form helpers
export {
  markdown,
  richtext,
  introspect,
  type FieldKind,
  type FieldDescriptor,
} from "./schema-form/introspect.js";

// MDX round-trip (registry-driven serialize/parse + shared encoder primitives)
export {
  prop,
  escapeAttr,
  jsonExpression,
  attributeValue,
  createAttrReader,
  serializeSpecBlock,
  parseSpecBlock,
  type MdxJsxNode,
  type MdxAttrNode,
  type SerializableBlock,
  type ParsedBlockBase,
} from "./mdx.js";

// Agent schema export
export {
  describeBlocksForAgent,
  renderBlockVocabularyReference,
  type BlockAgentDoc,
} from "./agent.js";

// Standard block library (React specs). Apps register these in their browser
// registry alongside their own app-specific blocks.
export {
  checklistBlock,
  ChecklistBlock,
  ChecklistEditor,
} from "./library/checklist.js";
export {
  checklistSchema,
  checklistMdx,
  type ChecklistData,
  type ChecklistItem,
} from "./library/checklist.config.js";
export { tableBlock } from "./library/table.js";
export {
  tableSchema,
  tableMdx,
  type TableData,
} from "./library/table.config.js";
export { codeTabsBlock } from "./library/code-tabs.js";
export {
  codeTabsSchema,
  codeTabsMdx,
  type CodeTabsData,
  type CodeTabsTab,
} from "./library/code-tabs.config.js";
export { htmlBlock, HtmlReadBlock, HtmlEditBlock } from "./library/html.js";
export {
  htmlSchema,
  htmlMdx,
  type HtmlBlockData,
} from "./library/html.config.js";
export { tabsBlock, TabsBlockReader, TabsBlockEditor } from "./library/tabs.js";
export {
  tabsSchema,
  tabsMdx,
  type TabsData,
  type TabsTab,
} from "./library/tabs.config.js";
