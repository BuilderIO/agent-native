export {
  defineBlock,
  type BlockSpec,
  type BlockPlacement,
  type BlockMdxConfig,
  type BlockAttrReader,
  type BlockRenderContext,
  type BlockReadProps,
  type BlockEditProps,
  type BlockAiFieldActionProps,
  type BlockContainerRegion,
  type BlockContainerSpec,
  type BlockDataChangeMeta,
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
  childCodeFenceFields,
  serializeChildCodeFenceFields,
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

export {
  libraryBlockConfigs,
  registerLibraryBlockConfigs,
  type LibraryBlockConfigOverrides,
} from "./library/server-specs.js";

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
export {
  calloutSchema,
  calloutMdx,
  CALLOUT_TONES,
  type CalloutData,
  type CalloutTone,
} from "./library/callout.config.js";

export { codeSchema, codeMdx, type CodeData } from "./library/code.config.js";
export {
  diagramSchema,
  diagramMdx,
  type DiagramData,
  type DiagramNode,
  type DiagramEdge,
  type DiagramNote,
} from "./library/diagram.config.js";
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
  DATA_MODEL_CHANGES,
  type DataModelChange,
} from "./library/data-model.config.js";
export {
  JSON_EXPLORER_DEFAULT_COLLAPSED_DEPTH,
  JSON_EXPLORER_MAX_COLLAPSED_DEPTH,
} from "./library/json-explorer.config.js";

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
