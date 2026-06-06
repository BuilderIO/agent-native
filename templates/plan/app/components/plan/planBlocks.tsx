import {
  BlockRegistry,
  defineBlock,
  registerBlocks,
  checklistBlock,
  tableBlock,
  codeTabsBlock,
  htmlBlock,
  tabsBlock,
  type BlockRenderContext,
  type NestedBlock,
} from "@agent-native/core/blocks";
import type { RichMarkdownCollabUser } from "@agent-native/core/client";
import type { PlanBlock } from "@shared/plan-content";
import { PlanBlockView } from "./DocumentArea";
import {
  calloutSchema,
  calloutMdx,
  type CalloutData,
} from "@shared/blocks/callout.config";
import {
  diagramSchema,
  diagramMdx,
  type DiagramData,
} from "@shared/blocks/diagram.config";
import {
  wireframeSchema,
  wireframeMdx,
  type WireframeData,
} from "@shared/blocks/wireframe.config";
import { CalloutBlock } from "./blocks/CalloutBlock";
import { DiagramBlock, DiagramBlockEdit } from "./blocks/DiagramBlock";
import { WireframeBlock, WireframeEditor } from "./blocks/WireframeBlock";
import {
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
} from "@shared/blocks/mermaid.config";
import {
  apiEndpointSchema,
  apiEndpointMdx,
  type ApiEndpointData,
} from "@shared/blocks/api-endpoint.config";
import {
  dataModelSchema,
  dataModelMdx,
  type DataModelData,
} from "@shared/blocks/data-model.config";
import { diffSchema, diffMdx, type DiffData } from "@shared/blocks/diff.config";
import {
  fileTreeSchema,
  fileTreeMdx,
  type FileTreeData,
} from "@shared/blocks/file-tree.config";
import {
  jsonExplorerSchema,
  jsonExplorerMdx,
  type JsonExplorerData,
} from "@shared/blocks/json-explorer.config";
import {
  annotatedCodeSchema,
  annotatedCodeMdx,
  type AnnotatedCodeData,
} from "@shared/blocks/annotated-code.config";
import { MermaidRead, MermaidEdit } from "./blocks/MermaidBlock";
import { ApiEndpointRead, ApiEndpointEdit } from "./blocks/ApiEndpointBlock";
import { DataModelRead, DataModelEdit } from "./blocks/DataModelBlock";
import { DiffRead, DiffEdit } from "./blocks/DiffBlock";
import { FileTreeRead, FileTreeEdit } from "./blocks/FileTreeBlock";
import { JsonExplorerRead, JsonExplorerEdit } from "./blocks/JsonExplorerBlock";
import {
  AnnotatedCodeRead,
  AnnotatedCodeEdit,
} from "./blocks/AnnotatedCodeBlock";
import { PlanMarkdownEditor } from "./PlanMarkdownEditor";
import { PlanMarkdownReader } from "./PlanMarkdownReader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Browser-side plan block registry. Registers the full specs (with their React
 * `Read`/`Edit`) used by `PlanBlockView` to render registered blocks. Shares the
 * exact `schema`/`mdx` config (`@shared/blocks/*.config`) with the server
 * registry (`shared/plan-block-registry.ts`) so rendering and source round-trip
 * never drift.
 *
 * Callout uses the shared `CalloutBlock` for read and OMITS `Edit`, so the
 * registry's `SchemaBlockEditor` is used: tone → a select, and the
 * `markdown()`-tagged body → the shared `PlanMarkdownEditor` (inline, Notion
 * style) via `ctx.renderMarkdownEditor`.
 */
export const planBlockRegistry = new BlockRegistry();

registerBlocks(planBlockRegistry, [
  defineBlock<CalloutData>({
    type: "callout",
    schema: calloutSchema,
    mdx: calloutMdx,
    Read: CalloutBlock,
    placement: ["block"],
    label: "Callout",
    description:
      "An emphasized note with a tone (info/decision/risk/warning/success) and a markdown body.",
    // `body` is a `markdown(min(1))` field, so a fresh callout needs non-empty
    // placeholder prose; `tone` defaults to the neutral "info" register.
    empty: () => ({ tone: "info", body: "Callout text" }),
  }),
  defineBlock<DiagramData>({
    type: "diagram",
    schema: diagramSchema,
    mdx: diagramMdx,
    Read: DiagramBlock,
    // Diagram editing stays comment/patch-driven; the custom Edit renders the
    // same read-only canvas so edit mode does not fall back to the schema
    // auto-editor (which can't render the positional node/edge/note arrays).
    Edit: DiagramBlockEdit,
    placement: ["block"],
    label: "Diagram",
    description:
      "A sketch flow diagram of labeled nodes connected by edges, with optional notes.",
    // `nodes` requires at least one entry; seed a single labeled node with no
    // edges so the schema validates and the canvas has something to render.
    empty: () => ({ nodes: [{ id: "n1", label: "Step 1" }], edges: [] }),
  }),
  defineBlock<WireframeData>({
    type: "wireframe",
    schema: wireframeSchema,
    mdx: wireframeMdx,
    Read: WireframeBlock,
    // The wireframe is canvas / agent-patch edited (node-addressable
    // `update-wireframe-node` / `replace-wireframe-screen` content patches), not
    // schema-form edited. The custom Edit reuses the read render so edit mode
    // does not fall back to the schema auto-editor (which can't render the kit
    // tree) and preserves today's patch-driven behavior.
    Edit: WireframeEditor,
    placement: ["block"],
    label: "Wireframe",
    description:
      "A sketch wireframe of one screen built from kit primitives (or an HTML mockup), rendered in a chosen surface frame (desktop/mobile/popover/panel/browser).",
    // `surface` is the only required field; `screen` defaults to []. Start on the
    // desktop surface with an empty screen so the canvas/agent can fill it in.
    empty: () => ({ surface: "desktop", screen: [] }),
  }),
  // Standard checklist block from the core library. Its `Read`/`Edit`
  // (toggle/add/remove) and schema + MDX config all come from core; the same
  // React-free config is registered server-side in `shared/plan-block-registry`.
  checklistBlock,
  // Standard table block from the core library. Its `Read` (the legacy
  // `<Table>` grid markup) and `Edit` (an editable column/row grid) and the
  // schema + MDX config all come from core; the same React-free config is
  // registered server-side in `shared/plan-block-registry`.
  tableBlock,
  // Standard code-tabs block from the core library: a vertical file tab rail of
  // Shiki-highlighted code. Its `Read` (moved verbatim from the legacy plan
  // `CodeTabsBlock`), its `Edit` (a code-style text area per tab), and the
  // schema + MDX config all come from core; the same React-free config is
  // registered server-side in `shared/plan-block-registry`.
  codeTabsBlock,
  // Standard HTML / Tailwind block from the core library (the registry form of
  // the legacy `custom-html` block): an author-supplied HTML (+ optional CSS)
  // fragment rendered in a sandboxed iframe, with an inline source editor. Its
  // `Read`/`Edit` and the schema + MDX config all come from core; the same
  // React-free config is registered server-side in `shared/plan-block-registry`.
  htmlBlock,
  // Standard horizontal-tabs block from the core library (the registry form of
  // the legacy plan `tabs` block): a pill-tab container whose tabs each hold a
  // list of child blocks. Children render RECURSIVELY through `ctx.renderBlock`
  // (wired to `PlanBlockView` below), so registered children render via their
  // spec and unconverted children still fall through the legacy switch. Its
  // `Read`/`Edit` and the schema + MDX config all come from core; the same
  // React-free config is registered server-side in `shared/plan-block-registry`.
  tabsBlock,
  // Dev-doc blocks: Mermaid diagram (hand-drawn, theme-aware), Swagger-style API
  // endpoint, ERD data model, and a GitHub-style diff. Each renders differently
  // from its props, so they edit through a corner button + panel popover.
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
      "A Mermaid diagram (flowchart, sequence, etc.) defined as text and rendered in the plan's hand-drawn style.",
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
 * Build the {@link BlockRenderContext} that the auto-editor and block `Read`
 * components receive. Wires the markdown field to the shared plan editor/reader
 * so the body stays inline-editable and source-syncable through the same GFM
 * pipeline the `rich-text` block uses, and wires `renderBlock` to the plan's own
 * `PlanBlockView` so container blocks (e.g. tabs) recurse through the same
 * dispatcher the top-level document uses — registered children via their spec,
 * unconverted children via the legacy switch (the coexistence seam).
 */
export function createPlanBlockRenderContext(options: {
  contentUpdatedAt?: string | null;
  planId?: string | null;
  collabUser?: RichMarkdownCollabUser | null;
  /** Document-level handlers threaded to nested child blocks (e.g. in tabs). */
  onRichTextChange?: (
    blockId: string,
    markdown: string,
  ) => Promise<void> | void;
  onVisualQuestionsSubmit?: (summary: string) => void;
  editingDisabled?: boolean;
}): BlockRenderContext {
  return {
    dialect: "gfm",
    renderMarkdown: (markdown) => <PlanMarkdownReader markdown={markdown} />,
    renderMarkdownEditor: ({ value, onChange, editable, blockId }) => (
      <PlanMarkdownEditor
        markdown={value}
        editable={editable}
        contentUpdatedAt={options.contentUpdatedAt}
        planId={options.planId}
        blockId={blockId}
        user={options.collabUser}
        onSave={onChange}
      />
    ),
    // Recursively render a nested child block through the plan dispatcher. The
    // child's `onChange` (when provided by an editable container) bubbles the
    // updated child back up — mirroring the legacy `TabsBlock` onChange path so
    // the recursive `updateBlocks`/`findBlock` in `PlanContentRenderer` keep
    // working unchanged.
    renderBlock: ({ block, onChange, compactVisuals }) => (
      <PlanBlockView
        block={block as PlanBlock}
        onChange={
          onChange
            ? (nextChild) => onChange(nextChild as NestedBlock)
            : undefined
        }
        onRichTextChange={options.onRichTextChange}
        onVisualQuestionsSubmit={options.onVisualQuestionsSubmit}
        compactVisuals={compactVisuals}
        contentUpdatedAt={options.contentUpdatedAt}
        editingDisabled={options.editingDisabled}
        planId={options.planId}
        collabUser={options.collabUser}
      />
    ),
    // `editSurface: "panel"` blocks (custom HTML, callout, any auto-form block)
    // render their `Read` with a corner edit button; clicking it opens the block
    // editor in this shadcn popover anchored to the button. Non-modal so the rest
    // of the doc stays interactive and the inline rich editor's portals behave.
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
