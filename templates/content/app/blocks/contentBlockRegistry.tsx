import {
  BlockRegistry,
  defineBlock,
  registerBlocks,
  // Standard library blocks — pre-built specs (schema + mdx + React Read/Edit).
  checklistBlock,
  tableBlock,
  codeTabsBlock,
  htmlBlock,
  tabsBlock,
  // Dev-doc block library: schema + MDX config (React-free) paired with the
  // shared React `Read`/`Edit` renderers. Content composes the app-specific spec
  // metadata (label/description/editSurface) with `defineBlock`, but the
  // schema/MDX config and renderers are the SAME core source plan uses, so render
  // and inline-MDX source round-trip can never drift.
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
  apiEndpointSchema,
  apiEndpointMdx,
  type ApiEndpointData,
  openApiSpecSchema,
  openApiSpecMdx,
  type OpenApiSpecData,
  dataModelSchema,
  dataModelMdx,
  type DataModelData,
  diffSchema,
  diffMdx,
  type DiffData,
  fileTreeSchema,
  fileTreeMdx,
  type FileTreeData,
  jsonExplorerSchema,
  jsonExplorerMdx,
  type JsonExplorerData,
  annotatedCodeSchema,
  annotatedCodeMdx,
  type AnnotatedCodeData,
  MermaidRead,
  MermaidEdit,
  ApiEndpointRead,
  ApiEndpointEdit,
  OpenApiSpecRead,
  OpenApiSpecEdit,
  DataModelRead,
  DataModelEdit,
  DiffRead,
  DiffEdit,
  FileTreeRead,
  FileTreeEdit,
  JsonExplorerRead,
  JsonExplorerEdit,
  AnnotatedCodeRead,
  AnnotatedCodeEdit,
  type BlockRenderContext,
  type TableData,
} from "@agent-native/core/blocks";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ContentBlockMarkdown,
  ContentBlockMarkdownEditor,
} from "./ContentBlockMarkdown";
import { uploadImageFile } from "@/components/editor/image-upload";

/**
 * Content's BROWSER block registry. Registers the same structured-block library
 * the server NFM registry (`shared/nfm-registry.ts`) registers, but WITH the real
 * React `Read`/`Edit` renderers. Both registries share the identical core
 * `schema` + `mdx` config per block, so what the editor renders and what the
 * inline NFM source serializes to can never drift.
 *
 * Block `type`s MUST match the server registry exactly: the NFM parser stamps a
 * `registryBlock` node's `blockType` from the server spec's `type`, and this
 * registry resolves the renderer back by that same `type`. The one place the two
 * diverge from the core default is the table — registered as `table-block` here
 * to match `nfm-registry.ts` (content already owns a Notion `table` node, so the
 * registry block can't reuse the bare `table` type). The core `tableBlock`'s
 * schema/mdx/Read/Edit are reused verbatim; only the discriminating `type`
 * changes.
 *
 * Mirrors `templates/plan/app/components/plan/planBlocks.tsx`.
 */
export const contentBlockRegistry = new BlockRegistry();

registerBlocks(contentBlockRegistry, [
  // Standard checklist block — its Read/Edit + schema/MDX config all come from
  // core; the React-free twin is registered server-side in `nfm-registry.ts`.
  checklistBlock,
  // Table block, re-typed to `table-block` to match the content server registry
  // (see note above). Reuses the core table spec's schema/mdx/Read/Edit.
  defineBlock<TableData>({ ...tableBlock, type: "table-block" }),
  // Vertical file-tab rail of syntax-highlighted code snippets.
  codeTabsBlock,
  // Author-supplied HTML (+ optional CSS) fragment in a sandboxed iframe.
  htmlBlock,
  // Horizontal pill-tab container; each tab holds its own block list. Children
  // render through `ctx.renderBlock` — content wires none (no legacy dispatcher),
  // so nested children render via their own spec when registered.
  tabsBlock,
  // Dev-doc blocks. Each renders differently from its props, so they edit through
  // a corner button + panel popover (`editSurface: "panel"`).
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
      "A whole-document Redoc / Swagger-UI-style API reference rendered from a complete OpenAPI 3 / Swagger 2 spec (JSON): operations grouped by tag, each a collapsible row expanding to params, request body, and per-status responses, with $ref models resolved.",
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
      "An ERD / dbdiagram-style data model: entity cards with typed fields (PK/FK/nullable flags) and interactive foreign-key relations.",
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
      "A line-numbered code walkthrough whose line ranges carry anchored explanatory notes (Stripe-docs / Sourcegraph 'explain this code' style).",
    empty: () => ({
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
]);

/**
 * Build the {@link BlockRenderContext} content's registry blocks render through.
 * Mirrors plan's `createPlanBlockRenderContext`, adapted to content:
 *  - `dialect: "nfm"` — content's prose dialect.
 *  - `renderMarkdown` / `renderMarkdownEditor` — block-internal prose (endpoint
 *    descriptions, file-tree notes, annotated-code notes) renders through a
 *    lightweight content markdown reader/editor rather than the document editor
 *    (block prose is small and read-mostly).
 *  - `renderEditSurface` — `editSurface: "panel"` blocks (the dev-doc blocks)
 *    open their editor in a shadcn Popover anchored to the corner edit button,
 *    non-modal so the rest of the document stays interactive.
 *  - `uploadFile` — routes block uploads through content's existing upload path.
 */
export function createContentBlockRenderContext(): BlockRenderContext {
  return {
    dialect: "nfm",
    renderMarkdown: (markdown) => <ContentBlockMarkdown markdown={markdown} />,
    renderMarkdownEditor: ({ value, onChange, editable }) => (
      <ContentBlockMarkdownEditor
        value={value}
        onChange={onChange}
        editable={editable}
      />
    ),
    uploadFile: async (file: File) => {
      const url = await uploadImageFile(file);
      return { url };
    },
    renderEditSurface: ({ title, trigger, children }) => (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          data-plan-interactive
          className="an-block-edit-popover flex max-h-[70vh] w-96 flex-col gap-3 overflow-auto"
        >
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {children}
        </PopoverContent>
      </Popover>
    ),
  };
}
