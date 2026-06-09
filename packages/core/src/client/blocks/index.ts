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
  type BlockAiFieldActionProps,
  type BlockContainerRegion,
  type BlockContainerSpec,
  type BlockDataChangeMeta,
} from "./types.js";

// Registry + provisioning
export { BlockRegistry, registerBlocks } from "./registry.js";
export {
  BlockRegistryProvider,
  useBlockRegistry,
  useOptionalBlockRegistry,
} from "./provider.js";

// Rendering
export { BlockView, blockEditSurface } from "./BlockView.js";
export { AiEditableFieldLabel } from "./AiEditableField.js";
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

// Standard library registration. Apps call `registerLibraryBlocks(registry)` to
// register the whole standard library (the pre-built specs + dev-doc specs) in
// one place, then register only their app-specific blocks on top.
// `libraryBlockSpecs` is the underlying ordered array.
export {
  libraryBlockSpecs,
  registerLibraryBlocks,
  type LibraryBlockOverrides,
} from "./library/specs.js";

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
export {
  CodeSurface,
  HighlightedCode,
  prettyLanguageName,
  DEFAULT_CODE_MAX_LINES,
} from "./library/HighlightedCode.js";
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
  type TabsOrientation,
  type TabsTab,
} from "./library/tabs.config.js";
export {
  columnsBlock,
  ColumnsBlockReader,
  ColumnsBlockEditor,
} from "./library/columns.js";
export {
  columnsSchema,
  columnsMdx,
  type ColumnsData,
  type ColumnsColumn,
} from "./library/columns.config.js";
export {
  calloutBlock,
  CalloutBlock,
  CalloutBlockEdit,
} from "./library/callout.js";
export {
  calloutSchema,
  calloutMdx,
  CALLOUT_TONES,
  type CalloutData,
  type CalloutTone,
} from "./library/callout.config.js";
export {
  questionFormBlock,
  visualQuestionsBlock,
  QuestionFormRead,
  VisualQuestionsRead,
  QuestionFormEdit,
} from "./library/question-form.js";
export {
  questionFormSchema,
  questionFormMdx,
  visualQuestionsSchema,
  visualQuestionsMdx,
  type QuestionFormData,
  type QuestionFormOption,
  type QuestionFormQuestion,
  type QuestionMode,
  type VisualQuestionsData,
} from "./library/question-form.config.js";
export { diagramBlock, DiagramRead, DiagramEdit } from "./library/diagram.js";
export {
  diagramSchema,
  diagramMdx,
  type DiagramData,
  type DiagramNode,
  type DiagramEdge,
  type DiagramNote,
} from "./library/diagram.config.js";
export {
  wireframeBlock,
  WireframeBlock,
  WireframeEditor,
} from "./library/wireframe.js";
export {
  wireframeSchema,
  wireframeMdx,
  createStableWireframeNodeId,
  WIREFRAME_SURFACES,
  WIREFRAME_EL_NAMES,
  type WireframeData,
  type WireframeNode,
  type WireframeElName,
  type WireframeTone,
  type WireframeSurface,
  type WireframeRenderMode,
} from "./library/wireframe.config.js";
export {
  Screen,
  renderNode,
  renderNodes,
  hasRenderer,
  NODE_REGISTRY,
  KitConfigContext,
  RoughOverlay,
  HTML_ROUGH_SELECTOR,
  useWireframeStyle,
  setWireframeStyle,
  toggleWireframeStyle,
  useIsDark,
  type WireframeStyle,
} from "./library/wireframe-kit.js";

// Dev-doc block library (React `Read`/`Edit` renderers + their React-free
// schema/MDX config). Apps register these alongside their own blocks, supplying
// app-specific spec metadata (label/description/editSurface/empty) via
// `defineBlock`. Mirrors the standard library above.
export { MermaidRead, MermaidEdit } from "./library/MermaidBlock.js";
export {
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
} from "./library/mermaid.config.js";
export {
  ApiEndpointRead,
  ApiEndpointEdit,
} from "./library/ApiEndpointBlock.js";
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
export { DataModelRead, DataModelEdit } from "./library/DataModelBlock.js";
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
export { DiffRead, DiffEdit } from "./library/DiffBlock.js";
export {
  diffSchema,
  diffMdx,
  type DiffData,
  type DiffMode,
} from "./library/diff.config.js";
export { FileTreeRead, FileTreeEdit } from "./library/FileTreeBlock.js";
export {
  fileTreeSchema,
  fileTreeMdx,
  FILE_TREE_CHANGES,
  type FileTreeData,
  type FileTreeEntry,
  type FileTreeChange,
} from "./library/file-tree.config.js";
export {
  JsonExplorerRead,
  JsonExplorerEdit,
} from "./library/JsonExplorerBlock.js";
export {
  jsonExplorerSchema,
  jsonExplorerMdx,
  type JsonExplorerData,
} from "./library/json-explorer.config.js";
export {
  AnnotatedCodeRead,
  AnnotatedCodeEdit,
} from "./library/AnnotatedCodeBlock.js";
export {
  annotatedCodeSchema,
  annotatedCodeMdx,
  type AnnotatedCodeData,
  type AnnotatedCodeAnnotation,
} from "./library/annotated-code.config.js";
export {
  OpenApiSpecRead,
  OpenApiSpecEdit,
} from "./library/OpenApiSpecBlock.js";
export {
  openApiSpecSchema,
  openApiSpecMdx,
  type OpenApiSpecData,
} from "./library/openapi-spec.config.js";
