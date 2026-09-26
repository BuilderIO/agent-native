import { registerBlocks, type BlockRegistry } from "../registry.js";
import { defineBlock, type BlockSpec } from "../types.js";
import {
  annotatedCodeSchema,
  annotatedCodeMdx,
  type AnnotatedCodeData,
} from "./annotated-code.config.js";
import { AnnotatedCodeRead, AnnotatedCodeEdit } from "./AnnotatedCodeBlock.js";
import {
  apiEndpointSchema,
  apiEndpointMdx,
  type ApiEndpointData,
} from "./api-endpoint.config.js";
import { ApiEndpointRead, ApiEndpointEdit } from "./ApiEndpointBlock.js";
import { calloutBlock } from "./callout.js";
import { checklistBlock } from "./checklist.js";
import { codeTabsBlock } from "./code-tabs.js";
import { codeBlock } from "./code.js";
import { columnsBlock } from "./columns.js";
import {
  dataModelSchema,
  dataModelMdx,
  type DataModelData,
} from "./data-model.config.js";
import { DataModelRead, DataModelEdit } from "./DataModelBlock.js";
import { diagramBlock } from "./diagram.js";
import { diffSchema, diffMdx, type DiffData } from "./diff.config.js";
import { DiffRead, DiffEdit } from "./DiffBlock.js";
import {
  fileTreeSchema,
  fileTreeMdx,
  type FileTreeData,
} from "./file-tree.config.js";
import { FileTreeRead, FileTreeEdit } from "./FileTreeBlock.js";
import { htmlBlock } from "./html.js";
import {
  jsonExplorerSchema,
  jsonExplorerMdx,
  JSON_EXPLORER_DEFAULT_COLLAPSED_DEPTH,
  type JsonExplorerData,
} from "./json-explorer.config.js";
import { JsonExplorerRead, JsonExplorerEdit } from "./JsonExplorerBlock.js";
import {
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
} from "./mermaid.config.js";
import { MermaidRead, MermaidEdit } from "./MermaidBlock.js";
import {
  openApiSpecSchema,
  openApiSpecMdx,
  type OpenApiSpecData,
} from "./openapi-spec.config.js";
import { OpenApiSpecRead, OpenApiSpecEdit } from "./OpenApiSpecBlock.js";
import { questionFormBlock, visualQuestionsBlock } from "./question-form.js";
import { tableBlock } from "./table.js";
import { tabsBlock } from "./tabs.js";
import { wireframeBlock } from "./wireframe.js";

const devDocBlockSpecs: BlockSpec<any>[] = [
  defineBlock<MermaidData>({
    type: "mermaid",
    schema: mermaidSchema,
    mdx: mermaidMdx,
    Read: MermaidRead,
    Edit: MermaidEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Diagram (Mermaid)",
    description:
      "A Mermaid diagram (flowchart, sequence, etc.) defined as text and rendered as a diagram.",
    empty: () => ({
      source:
        "flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]",
    }),
  }),
  defineBlock<ApiEndpointData>({
    type: "api-endpoint",
    schema: apiEndpointSchema,
    mdx: apiEndpointMdx,
    Read: ApiEndpointRead,
    Edit: ApiEndpointEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "API endpoint",
    description:
      "A Swagger-style API endpoint reference: a colored method pill + path, collapsed by default, expanding to params, request body, and per-status response examples.",
    empty: () => ({ method: "GET", path: "/api/resource" }),
  }),
  defineBlock<OpenApiSpecData>({
    type: "openapi-spec",
    schema: openApiSpecSchema,
    mdx: openApiSpecMdx,
    Read: OpenApiSpecRead,
    Edit: OpenApiSpecEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "OpenAPI spec",
    description:
      "A whole-document API specification / Redoc / Swagger-UI-style API reference rendered from a complete OpenAPI 3 / Swagger 2 spec (JSON): operations grouped by tag, each a collapsible row expanding to params, request body, and per-status responses, with $ref models resolved.",
    empty: () => ({
      spec: JSON.stringify(
        {
          openapi: "3.0.0",
          info: { title: "Example API", version: "1.0.0" },
          tags: [{ name: "widgets", description: "Manage widgets" }],
          paths: {
            "/widgets": {
              get: {
                tags: ["widgets"],
                summary: "List widgets",
                responses: { "200": { description: "OK" } },
              },
            },
          },
        },
        null,
        2,
      ),
    }),
  }),
  defineBlock<DataModelData>({
    type: "data-model",
    schema: dataModelSchema,
    mdx: dataModelMdx,
    Read: DataModelRead,
    Edit: DataModelEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Data model",
    description:
      "A schema modeling / ERD / dbdiagram-style data model: entity cards with typed fields (PK/FK/nullable flags) and interactive foreign-key relations.",
    empty: () => ({
      entities: [
        {
          id: "e_user",
          name: "User",
          fields: [
            { name: "id", type: "uuid", pk: true },
            { name: "email", type: "text" },
          ],
        },
      ],
    }),
  }),
  defineBlock<DiffData>({
    type: "diff",
    schema: diffSchema,
    mdx: diffMdx,
    Read: DiffRead,
    Edit: DiffEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Diff",
    description:
      "A GitHub-style before/after line diff for a file, with unified or split (side-by-side) view, added/removed line highlighting, and collapsible unchanged runs.",
    empty: () => ({
      before: "function add(a, b) {\n  return a + b;\n}",
      after: "function add(a: number, b: number): number {\n  return a + b;\n}",
      language: "ts",
    }),
  }),
  defineBlock<FileTreeData>({
    type: "file-tree",
    schema: fileTreeSchema,
    mdx: fileTreeMdx,
    Read: FileTreeRead,
    Edit: FileTreeEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "File tree",
    description:
      "A VS Code / GitHub-explorer file and change tree derived from slash-delimited paths, with per-file change badges (added/modified/removed/renamed), notes, and code snippets.",
    empty: () => ({
      entries: [
        {
          path: "src/index.ts",
          change: "modified",
          note: "Wire the new route here.",
        },
        { path: "src/routes/git.ts", change: "added" },
      ],
    }),
  }),
  defineBlock<JsonExplorerData>({
    type: "json-explorer",
    schema: jsonExplorerSchema,
    mdx: jsonExplorerMdx,
    Read: JsonExplorerRead,
    Edit: JsonExplorerEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "JSON explorer",
    description:
      "A collapsible browser-devtools / Postman-style JSON tree with type-colored values and expand/collapse.",
    empty: () => ({
      json: JSON.stringify(
        {
          id: "abc123",
          active: true,
          tags: ["alpha", "beta"],
          meta: { count: 2, owner: null },
        },
        null,
        2,
      ),
      collapsedDepth: JSON_EXPLORER_DEFAULT_COLLAPSED_DEPTH,
    }),
  }),
  defineBlock<AnnotatedCodeData>({
    type: "annotated-code",
    schema: annotatedCodeSchema,
    mdx: annotatedCodeMdx,
    Read: AnnotatedCodeRead,
    Edit: AnnotatedCodeEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Annotated code",
    description:
      "A line-numbered code walkthrough whose line ranges carry anchored explanatory notes (Stripe-docs / Sourcegraph explain-this-code style).",
    empty: () => ({
      filename: "src/server/auth.ts",
      language: "ts",
      code: "export function resolveAuth(provider: string) {\n  const cfg = providers[provider];\n  return cfg.token;\n}",
      annotations: [
        {
          lines: "2",
          label: "Lookup",
          note: "Resolves the provider config by key.",
        },
      ],
    }),
  }),
];

export const libraryBlockSpecs: BlockSpec<any>[] = [
  checklistBlock,
  tableBlock,
  codeBlock,
  codeTabsBlock,
  htmlBlock,
  tabsBlock,
  columnsBlock,
  calloutBlock,
  questionFormBlock,
  visualQuestionsBlock,
  diagramBlock,
  wireframeBlock,
  ...devDocBlockSpecs,
];

export type LibraryBlockOverrides = Record<
  string,
  Partial<Pick<BlockSpec<any>, "type" | "label" | "description" | "empty">>
>;

export function registerLibraryBlocks(
  registry: BlockRegistry,
  options: { overrides?: LibraryBlockOverrides } = {},
): void {
  const overrides = options.overrides ?? {};
  const specs = libraryBlockSpecs.map((spec) => {
    const override = overrides[spec.type];
    return override ? ({ ...spec, ...override } as BlockSpec<any>) : spec;
  });
  registerBlocks(registry, specs);
}
