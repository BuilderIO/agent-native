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
import { PlanMarkdownEditor } from "./PlanMarkdownEditor";
import { PlanMarkdownReader } from "./PlanMarkdownReader";

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
  };
}
