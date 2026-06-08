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

export {
  describeBlocksForAgent,
  renderBlockVocabularyReference,
  type BlockAgentDoc,
} from "./agent.js";

// Standard library registration (React-free). Server / shared registries call
// `registerLibraryBlockConfigs(registry)` to register the whole standard library
// as `Read: () => null` config stubs in one place, then add their app-specific
// block configs on top. `libraryBlockConfigs` is the underlying ordered array.
export {
  libraryBlockConfigs,
  registerLibraryBlockConfigs,
  type LibraryBlockConfigOverrides,
} from "./library/server-specs.js";

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
  type TabsOrientation,
  type TabsTab,
} from "./library/tabs.config.js";
export {
  columnsSchema,
  columnsMdx,
  type ColumnsData,
  type ColumnsColumn,
} from "./library/columns.config.js";

// Dev-doc block library — React-free schema + MDX config only. The React
// `Read`/`Edit` live in the matching `./library/<Name>Block.tsx` (imported from
// the full `@agent-native/core/blocks` entry), never from here.
export {
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
} from "./library/mermaid.config.js";
export {
  apiEndpointSchema,
  apiEndpointMdx,
  API_ENDPOINT_METHODS,
  API_PARAM_LOCATIONS,
  type ApiEndpointData,
  type ApiEndpointMethod,
  type ApiEndpointParam,
  type ApiEndpointRequest,
  type ApiEndpointResponse,
  type ApiParamLocation,
} from "./library/api-endpoint.config.js";
export {
  dataModelSchema,
  dataModelMdx,
  DATA_MODEL_RELATION_KINDS,
  type DataModelData,
  type DataModelEntity,
  type DataModelField,
  type DataModelRelation,
  type DataModelRelationKind,
} from "./library/data-model.config.js";
export {
  diffSchema,
  diffMdx,
  type DiffData,
  type DiffMode,
} from "./library/diff.config.js";
export {
  fileTreeSchema,
  fileTreeMdx,
  FILE_TREE_CHANGES,
  type FileTreeData,
  type FileTreeEntry,
  type FileTreeChange,
} from "./library/file-tree.config.js";
export {
  jsonExplorerSchema,
  jsonExplorerMdx,
  type JsonExplorerData,
} from "./library/json-explorer.config.js";
export {
  annotatedCodeSchema,
  annotatedCodeMdx,
  type AnnotatedCodeData,
  type AnnotatedCodeAnnotation,
} from "./library/annotated-code.config.js";
export {
  openApiSpecSchema,
  openApiSpecMdx,
  type OpenApiSpecData,
} from "./library/openapi-spec.config.js";
