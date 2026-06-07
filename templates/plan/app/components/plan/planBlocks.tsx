import {
  BlockRegistry,
  defineBlock,
  registerBlocks,
  // The standard library (checklist, table, code-tabs, html, tabs + the eight
  // dev-doc blocks) is registered in ONE shared place. Plan registers it via
  // `registerLibraryBlocks` and then registers only its plan-specific blocks
  // (callout/diagram/wireframe/question-form) below.
  registerLibraryBlocks,
  type LibraryBlockOverrides,
  type OpenApiSpecData,
  type BlockRenderContext,
  type BlockReadProps,
  type NestedBlock,
} from "@agent-native/core/blocks";
import type { RichMarkdownCollabUser } from "@agent-native/core/client";
import type { PlanBlock } from "@shared/plan-content";
import { PlanBlockView, QuestionFormBlock } from "./DocumentArea";
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
import {
  questionFormSchema,
  questionFormMdx,
  type QuestionFormData,
} from "@shared/blocks/question-form.config";
import { CalloutBlock } from "./blocks/CalloutBlock";
import { DiagramBlock, DiagramBlockEdit } from "./blocks/DiagramBlock";
import { WireframeBlock, WireframeEditor } from "./blocks/WireframeBlock";
import { PlanMarkdownEditor } from "./PlanMarkdownEditor";
import { PlanMarkdownReader } from "./PlanMarkdownReader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type PlanBlockRenderContextExtras = {
  onQuestionFormSubmit?: (summary: string) => void;
};

function QuestionFormRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<QuestionFormData>) {
  const extras = ctx as BlockRenderContext & PlanBlockRenderContextExtras;
  return (
    <QuestionFormBlock
      block={{
        id: blockId,
        type: "question-form",
        title,
        summary,
        data,
      }}
      onSubmit={extras.onQuestionFormSubmit}
    />
  );
}

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
  // Plan-specific blocks (callout/diagram/wireframe/question-form). The standard
  // library (checklist, table, code-tabs, html, tabs + the eight dev-doc blocks)
  // is registered once via `registerLibraryBlocks` below — adding a library block
  // there lands in plan and content together.
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
      "A flexible inline architecture/code diagram. Prefer html/css with SVG or semantic HTML for polished two-dimensional layouts; legacy nodes/edges are only for simple previews.",
    // Seed the legacy fallback shape so a fresh block validates while agents can
    // replace it with html/css when layout quality matters.
    empty: () => ({ nodes: [{ id: "n1", label: "Module" }], edges: [] }),
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
  defineBlock<QuestionFormData>({
    type: "question-form",
    schema: questionFormSchema,
    mdx: questionFormMdx,
    Read: QuestionFormRead,
    placement: ["block"],
    label: "Question form",
    description:
      "An interactive form block for open questions, single-choice or multi-choice option rows, freeform answers, recommended options, and optional wireframe/diagram previews.",
    empty: () => ({
      submitLabel: "Send to agent",
      questions: [
        {
          id: "open-question",
          title: "What should the agent clarify before revising this plan?",
          mode: "freeform",
          placeholder: "Add constraints, preferences, or a decision...",
        },
      ],
    }),
  }),
]);

/**
 * Plan's per-block overrides for the shared standard library: the Mermaid
 * description is phrased for the plan's hand-drawn render style, and the OpenAPI
 * example seeds a richer spec (with a POST + `$ref` model). Everything else
 * (schema, MDX config, React `Read`/`Edit`, labels, placement) is the canonical
 * core value, so the library lives in exactly one place.
 */
const PLAN_LIBRARY_OVERRIDES: LibraryBlockOverrides = {
  mermaid: {
    description:
      "A Mermaid diagram for cases where textual sequence or flowchart grammar is clearer than a spatial layout; not the default for architecture maps.",
  },
  "openapi-spec": {
    empty: (): OpenApiSpecData => ({
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
                responses: {
                  "200": {
                    description: "OK",
                    content: {
                      "application/json": {
                        schema: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Widget" },
                        },
                      },
                    },
                  },
                },
              },
              post: {
                tags: ["widgets"],
                summary: "Create a widget",
                requestBody: {
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/Widget" },
                    },
                  },
                },
                responses: { "201": { description: "Created" } },
              },
            },
          },
          components: {
            schemas: {
              Widget: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    }),
  },
};

// Standard library (checklist, table, code-tabs, html, tabs + the eight dev-doc
// blocks). Registered AFTER the plan-specific blocks above; the same React-free
// schema/MDX config is registered server-side in `shared/plan-block-registry`.
registerLibraryBlocks(planBlockRegistry, {
  overrides: PLAN_LIBRARY_OVERRIDES,
});

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
  const ctx: BlockRenderContext & PlanBlockRenderContextExtras = {
    dialect: "gfm",
    onQuestionFormSubmit: options.onVisualQuestionsSubmit,
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
  return ctx;
}
