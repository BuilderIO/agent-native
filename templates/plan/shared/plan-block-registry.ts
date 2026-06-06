import {
  BlockRegistry,
  defineBlock,
  registerBlocks,
  describeBlocksForAgent,
  renderBlockVocabularyReference,
  type BlockAgentDoc,
} from "@agent-native/core/blocks/server";
import {
  calloutSchema,
  calloutMdx,
  type CalloutData,
} from "./blocks/callout.config.js";
import {
  diagramSchema,
  diagramMdx,
  type DiagramData,
} from "./blocks/diagram.config.js";
import {
  wireframeSchema,
  wireframeMdx,
  type WireframeData,
} from "./blocks/wireframe.config.js";
import {
  questionFormSchema,
  questionFormMdx,
  type QuestionFormData,
} from "./blocks/question-form.config.js";
import {
  checklistSchema,
  checklistMdx,
  type ChecklistData,
  tableSchema,
  tableMdx,
  type TableData,
  codeTabsSchema,
  codeTabsMdx,
  type CodeTabsData,
  htmlSchema,
  htmlMdx,
  type HtmlBlockData,
  tabsSchema,
  tabsMdx,
  type TabsData,
  // Dev-doc block config (schema + MDX round-trip) now lives in core, shared
  // with the client registry (`planBlocks.tsx`) — same objects, so source
  // round-trip can never drift.
  mermaidSchema,
  mermaidMdx,
  type MermaidData,
  apiEndpointSchema,
  apiEndpointMdx,
  type ApiEndpointData,
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
} from "@agent-native/core/blocks/server";

/**
 * Server / shared plan block registry. Registers the React-free parts of each
 * converted block (schema + MDX config) so the MDX adapter (`plan-mdx.ts`) and
 * agent schema export can serialize/parse/describe blocks without importing
 * React. The CLIENT registry (`app/components/plan/planBlocks.tsx`) registers the
 * same blocks WITH their `Read`/`Edit` React components for rendering — both use
 * the identical `mdx`/`schema` config (`shared/blocks/*.config.ts`) so source
 * round-trip stays consistent.
 *
 * `Read` is required on `BlockSpec`, so each server spec gets a render-only stub
 * (`() => null`) that is never invoked on the server. Unregistered block types
 * keep using the legacy `serializeBlock`/`parseBlock` path unchanged.
 */
export function registerPlanBlocks(registry: BlockRegistry): void {
  registerBlocks(registry, [
    defineBlock<CalloutData>({
      type: "callout",
      schema: calloutSchema,
      mdx: calloutMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Callout",
      description:
        "An emphasized note with a tone (info/decision/risk/warning/success) and a markdown body.",
    }),
    defineBlock<DiagramData>({
      type: "diagram",
      schema: diagramSchema,
      mdx: diagramMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Diagram",
      description:
        "A sketch flow diagram of labeled nodes connected by edges, with optional notes.",
    }),
    defineBlock<ChecklistData>({
      type: "checklist",
      schema: checklistSchema,
      mdx: checklistMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Checklist",
      description:
        "A list of toggleable items, each with a label and an optional note.",
    }),
    defineBlock<CodeTabsData>({
      type: "code-tabs",
      schema: codeTabsSchema,
      mdx: codeTabsMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Code tabs",
      description:
        "A vertical file tab rail of syntax-highlighted code snippets, one tab per file with an optional language and caption.",
    }),
    defineBlock<TableData>({
      type: "table",
      schema: tableSchema,
      mdx: tableMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Table",
      description:
        "A simple grid with header columns and string rows for comparisons, parameters, or structured lists.",
    }),
    defineBlock<WireframeData>({
      type: "wireframe",
      schema: wireframeSchema,
      mdx: wireframeMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Wireframe",
      description:
        "A sketch wireframe of one screen built from kit primitives (or an HTML mockup), rendered in a chosen surface frame (desktop/mobile/popover/panel/browser).",
    }),
    defineBlock<HtmlBlockData>({
      type: "custom-html",
      schema: htmlSchema,
      mdx: htmlMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "HTML / Tailwind",
      description:
        "An author-supplied HTML (with optional CSS) fragment rendered in a sandboxed iframe, with inline source editing.",
    }),
    defineBlock<QuestionFormData>({
      type: "question-form",
      schema: questionFormSchema,
      mdx: questionFormMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Question form",
      description:
        "An interactive form block for open questions, single-choice or multi-choice chips, freeform answers, recommended options, and optional wireframe/diagram previews.",
    }),
    defineBlock<TabsData>({
      type: "tabs",
      schema: tabsSchema,
      mdx: tabsMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block", "inline"],
      label: "Tabs",
      description:
        "A horizontal pill-tab container; each tab holds its own list of blocks.",
    }),
    defineBlock<MermaidData>({
      type: "mermaid",
      schema: mermaidSchema,
      mdx: mermaidMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Diagram (Mermaid)",
      description:
        "A Mermaid diagram (flowchart, sequence, etc.) defined as text and rendered in the plan's hand-drawn style.",
    }),
    defineBlock<ApiEndpointData>({
      type: "api-endpoint",
      schema: apiEndpointSchema,
      mdx: apiEndpointMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "API endpoint",
      description:
        "A Swagger-style API endpoint reference: a colored method pill + path, collapsed by default, expanding to params, request body, and per-status response examples.",
    }),
    defineBlock<DataModelData>({
      type: "data-model",
      schema: dataModelSchema,
      mdx: dataModelMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Data model",
      description:
        "An ERD / dbdiagram-style data model: entity cards with typed fields (PK/FK/nullable flags) and interactive foreign-key relations.",
    }),
    defineBlock<DiffData>({
      type: "diff",
      schema: diffSchema,
      mdx: diffMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Diff",
      description:
        "A GitHub-style before/after line diff for a file, with unified or split (side-by-side) view, added/removed line highlighting, and collapsible unchanged runs.",
    }),
    defineBlock<FileTreeData>({
      type: "file-tree",
      schema: fileTreeSchema,
      mdx: fileTreeMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "File tree",
      description:
        "A VS Code / GitHub-explorer file and change tree derived from slash-delimited paths, with per-file change badges (added/modified/removed/renamed), notes, and code snippets.",
    }),
    defineBlock<JsonExplorerData>({
      type: "json-explorer",
      schema: jsonExplorerSchema,
      mdx: jsonExplorerMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "JSON explorer",
      description:
        "A collapsible browser-devtools / Postman-style JSON tree with type-colored values and expand/collapse.",
    }),
    defineBlock<AnnotatedCodeData>({
      type: "annotated-code",
      schema: annotatedCodeSchema,
      mdx: annotatedCodeMdx,
      // Server stub — the browser registry supplies the real renderer.
      Read: () => null,
      placement: ["block"],
      label: "Annotated code",
      description:
        "A line-numbered code walkthrough whose line ranges carry anchored explanatory notes (Stripe-docs / Sourcegraph 'explain this code' style).",
    }),
  ]);
}

/**
 * A shared, React-free registry of every converted plan block, built once for
 * the agent-facing schema export. Uses the same `registerPlanBlocks` config the
 * MDX adapter uses, so the vocabulary the agent reads can never drift from what
 * the app serializes/renders.
 */
let cachedAgentRegistry: BlockRegistry | null = null;
function planAgentRegistry(): BlockRegistry {
  if (!cachedAgentRegistry) {
    cachedAgentRegistry = new BlockRegistry();
    registerPlanBlocks(cachedAgentRegistry);
  }
  return cachedAgentRegistry;
}

/**
 * Structured per-block agent docs (type, label, placement, MDX tag, JSON schema,
 * example) for the registered plan blocks. Exposed to the agent so `/visual-plan`
 * generates only blocks the app can actually render and round-trip.
 */
export function describePlanBlocksForAgent(): BlockAgentDoc[] {
  return describeBlocksForAgent(planAgentRegistry());
}

/**
 * A compact markdown block-vocabulary reference for the plan agent, generated
 * from the live registry. Surfaced through the `get-plan-blocks` action and
 * referenced by the plan skills so the agent's block vocabulary stays accurate.
 */
export function renderPlanBlockVocabulary(): string {
  return renderBlockVocabularyReference(planAgentRegistry());
}
