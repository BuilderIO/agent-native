/**
 * `@agent-native/core/blocks/server` — the React-free subset of the block
 * registry for server / agent code (MDX serialize/parse, the registry, schema
 * introspection, the `markdown()` helper, agent schema export). Importing this
 * entry never pulls React into the server bundle.
 *
 * A `BlockSpec` carries React (`Read`/`Edit`) and pure (`schema`/`mdx`) parts in
 * the same object; the server path only touches `spec.schema` / `spec.mdx`. The
 * app's registry module is shared by browser and server, but the server only
 * ever calls these React-free functions on it.
 */

export {
  defineBlock,
  type BlockSpec,
  type BlockPlacement,
  type BlockMdxConfig,
  type BlockAttrReader,
  type MdxAttrValue,
  type NestedBlock,
} from "./types.js";

export { BlockRegistry, registerBlocks } from "./registry.js";

export {
  markdown,
  richtext,
  introspect,
  type FieldKind,
  type FieldDescriptor,
} from "./schema-form/introspect.js";

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

export { describeBlocksForAgent, type BlockAgentDoc } from "./agent.js";

// Standard block library — React-free schema + MDX config only. The React
// `Read`/`Edit` live in `./library/checklist.tsx` (imported from the full
// `@agent-native/core/blocks` entry), never from here.
export {
  checklistSchema,
  checklistMdx,
  type ChecklistData,
  type ChecklistItem,
} from "./library/checklist.config.js";
export {
  tableSchema,
  tableMdx,
  type TableData,
} from "./library/table.config.js";
export {
  codeTabsSchema,
  codeTabsMdx,
  type CodeTabsData,
  type CodeTabsTab,
} from "./library/code-tabs.config.js";
export {
  htmlSchema,
  htmlMdx,
  type HtmlBlockData,
} from "./library/html.config.js";
export {
  tabsSchema,
  tabsMdx,
  type TabsData,
  type TabsTab,
} from "./library/tabs.config.js";
