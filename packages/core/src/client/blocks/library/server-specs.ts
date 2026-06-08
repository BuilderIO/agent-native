import { defineBlock, type BlockSpec } from "../types.js";
import { registerBlocks, type BlockRegistry } from "../registry.js";

// React-free schema + MDX config for the standard library. The matching React
// `Read`/`Edit` live in the full client entry; the server path only ever touches
// `spec.schema` / `spec.mdx`, so these configs register with a render-only stub.
import {
  checklistSchema,
  checklistMdx,
  type ChecklistData,
} from "./checklist.config.js";
import { tableSchema, tableMdx, type TableData } from "./table.config.js";
import {
  codeTabsSchema,
  codeTabsMdx,
  type CodeTabsData,
} from "./code-tabs.config.js";
import { htmlSchema, htmlMdx, type HtmlBlockData } from "./html.config.js";
import { tabsSchema, tabsMdx, type TabsData } from "./tabs.config.js";
import {
  columnsSchema,
  columnsMdx,
  type ColumnsData,
} from "./columns.config.js";
import {
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
} from "./mermaid.config.js";
import {
  apiEndpointSchema,
  apiEndpointMdx,
  type ApiEndpointData,
} from "./api-endpoint.config.js";
import {
  openApiSpecSchema,
  openApiSpecMdx,
  type OpenApiSpecData,
} from "./openapi-spec.config.js";
import {
  dataModelSchema,
  dataModelMdx,
  type DataModelData,
} from "./data-model.config.js";
import { diffSchema, diffMdx, type DiffData } from "./diff.config.js";
import {
  fileTreeSchema,
  fileTreeMdx,
  type FileTreeData,
} from "./file-tree.config.js";
import {
  jsonExplorerSchema,
  jsonExplorerMdx,
  type JsonExplorerData,
} from "./json-explorer.config.js";

/** Render-only stub for server / agent registries (never invoked off-browser). */
const ServerReadStub = () => null;

/**
 * Canonical React-free specs for the standard library, used by BOTH apps' server
 * / shared registries (`plan-block-registry.ts`, `nfm-registry.ts`). Each carries
 * only the parts the server path touches — `schema` + `mdx` + metadata for the
 * agent schema export — with a render-only `Read` stub. The full client specs
 * (with real React `Read`/`Edit`) live in `./specs.tsx`; both share the identical
 * `schema`/`mdx` config so inline source can never drift from what renders.
 *
 * `table` keeps the core default `type` here; content's server registry renames
 * it to `table-block` via {@link LibraryBlockConfigOverrides}. The descriptions
 * are the neutral agent-schema phrasing; an app that curates a longer
 * description for a block (e.g. plan's hand-drawn Mermaid, plan's detailed file
 * tree) passes an override rather than re-authoring the spec.
 */
export const libraryBlockConfigs: BlockSpec<any>[] = [
  defineBlock<ChecklistData>({
    type: "checklist",
    schema: checklistSchema,
    mdx: checklistMdx,
    Read: ServerReadStub,
    placement: ["block"],
    notionCompatible: true,
    label: "Checklist",
    description:
      "A list of toggleable items, each with a label and an optional note.",
  }),
  defineBlock<TableData>({
    type: "table",
    schema: tableSchema,
    mdx: tableMdx,
    Read: ServerReadStub,
    placement: ["block"],
    notionCompatible: true,
    label: "Table",
    description:
      "A simple grid with header columns and string rows for comparisons, parameters, or structured lists.",
  }),
  defineBlock<CodeTabsData>({
    type: "code-tabs",
    schema: codeTabsSchema,
    mdx: codeTabsMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Code tabs",
    description:
      "A vertical file tab rail of syntax-highlighted code snippets, one tab per file with an optional language and caption.",
  }),
  defineBlock<HtmlBlockData>({
    type: "custom-html",
    schema: htmlSchema,
    mdx: htmlMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "HTML / Tailwind",
    description:
      "An author-supplied HTML (with optional CSS) fragment rendered in a sandboxed iframe, with inline source editing.",
  }),
  defineBlock<TabsData>({
    type: "tabs",
    schema: tabsSchema,
    mdx: tabsMdx,
    Read: ServerReadStub,
    placement: ["block", "inline"],
    label: "Tabs",
    description:
      "A top or side tab container; each tab holds its own list of blocks.",
  }),
  defineBlock<ColumnsData>({
    type: "columns",
    schema: columnsSchema,
    mdx: columnsMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Columns",
    description:
      "A multi-column side-by-side layout container; each column holds its own list of blocks. Ideal for before/after or current/target comparisons.",
  }),
  defineBlock<MermaidData>({
    type: "mermaid",
    schema: mermaidSchema,
    mdx: mermaidMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Diagram (Mermaid)",
    description:
      "A Mermaid diagram (flowchart, sequence, etc.) defined as text and rendered as a diagram.",
  }),
  defineBlock<ApiEndpointData>({
    type: "api-endpoint",
    schema: apiEndpointSchema,
    mdx: apiEndpointMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "API endpoint",
    description:
      "A Swagger-style API endpoint reference: a colored method pill + path, collapsed by default, expanding to params, request body, and per-status response examples.",
  }),
  defineBlock<OpenApiSpecData>({
    type: "openapi-spec",
    schema: openApiSpecSchema,
    mdx: openApiSpecMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "OpenAPI spec",
    description:
      "A whole-document API specification / Redoc / Swagger-UI-style API reference rendered from a complete OpenAPI 3 / Swagger 2 spec (JSON).",
  }),
  defineBlock<DataModelData>({
    type: "data-model",
    schema: dataModelSchema,
    mdx: dataModelMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Data model",
    description:
      "A schema modeling / ERD / dbdiagram-style data model: entity cards with typed fields (PK/FK/nullable flags) and interactive foreign-key relations.",
  }),
  defineBlock<DiffData>({
    type: "diff",
    schema: diffSchema,
    mdx: diffMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Diff",
    description:
      "A GitHub-style before/after line diff for a file, with unified or split view and added/removed line highlighting.",
  }),
  defineBlock<FileTreeData>({
    type: "file-tree",
    schema: fileTreeSchema,
    mdx: fileTreeMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "File tree",
    description:
      "A VS Code / GitHub-explorer file and change tree with per-file change badges, notes, and code snippets.",
  }),
  defineBlock<JsonExplorerData>({
    type: "json-explorer",
    schema: jsonExplorerSchema,
    mdx: jsonExplorerMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "JSON explorer",
    description:
      "A collapsible browser-devtools / Postman-style JSON tree with type-colored values and expand/collapse.",
  }),
];

/**
 * Per-block overrides for {@link registerLibraryBlockConfigs}, keyed by canonical
 * `type`. Servers tweak only the agent-facing fields that legitimately differ:
 * content re-types `table` → `table-block`; plan curates a longer Mermaid and
 * file-tree description. The `schema` / `mdx` config always stays shared.
 */
export type LibraryBlockConfigOverrides = Record<
  string,
  Partial<
    Pick<BlockSpec<any>, "type" | "label" | "description" | "notionCompatible">
  >
>;

/**
 * Register the React-free standard-library config stubs into a server / shared
 * {@link BlockRegistry}. Both `plan-block-registry.ts` and `nfm-registry.ts` call
 * this, then register only their app-specific block configs (plan adds callout /
 * diagram / wireframe / question-form) on top — so the shared library lives in
 * exactly one place across browser AND server registries.
 */
export function registerLibraryBlockConfigs(
  registry: BlockRegistry,
  options: { overrides?: LibraryBlockConfigOverrides } = {},
): void {
  const overrides = options.overrides ?? {};
  const specs = libraryBlockConfigs.map((spec) => {
    const override = overrides[spec.type];
    return override ? ({ ...spec, ...override } as BlockSpec<any>) : spec;
  });
  registerBlocks(registry, specs);
}
