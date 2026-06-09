import { useEffect, useRef, useState } from "react";
import {
  BlockRegistry,
  registerBlocks,
  // The full block library (checklist/table/code-tabs/html/tabs/columns, the
  // eight dev-doc blocks, plus callout/decision/question-form/visual-questions/
  // diagram/wireframe) is registered in ONE shared place via
  // `registerLibraryBlocks`. Plan registers no app-only blocks of its own.
  registerLibraryBlocks,
  type LibraryBlockOverrides,
  type OpenApiSpecData,
  type BlockRenderContext,
  type NestedBlock,
  type BlockAiFieldActionProps,
} from "@agent-native/core/blocks";
import {
  sendToAgentChat,
  type RichMarkdownCollabUser,
} from "@agent-native/core/client";
import type { PlanBlock } from "@shared/plan-content";
import { PlanBlockView } from "./DocumentArea";
import { PlanMarkdownEditor } from "./PlanMarkdownEditor";
import { PlanMarkdownReader } from "./PlanMarkdownReader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PlanBlockRenderContextExtras = {
  onQuestionFormSubmit?: (summary: string) => void;
};

/**
 * Browser-side plan block registry. Registers the full library specs (with their
 * React `Read`/`Edit`) used by `PlanBlockView` to render registered blocks. The
 * same React-free `schema`/`mdx` config is registered server-side from the shared
 * core library (`shared/plan-block-registry.ts`) so rendering and source
 * round-trip never drift.
 *
 * Callout uses the shared `CalloutBlock` for read and a custom hybrid editor:
 * the body stays normal inline markdown prose, while tone/type metadata lives in
 * the block edit popover.
 */
export const planBlockRegistry = new BlockRegistry();

// All of plan's former plan-specific blocks (callout, diagram, wireframe,
// question-form, visual-questions, decision) now live in the shared core block
// library and register via `registerLibraryBlocks` below — so plan and content
// get them from one place. Plan registers no app-only blocks today.
registerBlocks(planBlockRegistry, []);

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

// The full shared library (checklist/table/code-tabs/html/tabs/columns, the
// eight dev-doc blocks, plus callout/decision/question-form/visual-questions/
// diagram/wireframe). The same React-free schema/MDX config is registered
// server-side in `shared/plan-block-registry`.
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
  renderBlocksEditor?: BlockRenderContext["renderBlocksEditor"];
  editingDisabled?: boolean;
}): BlockRenderContext {
  const ctx: BlockRenderContext & PlanBlockRenderContextExtras = {
    dialect: "gfm",
    onQuestionFormSubmit: options.onVisualQuestionsSubmit,
    renderMarkdown: (markdown, options) => (
      <PlanMarkdownReader markdown={markdown} className={options?.className} />
    ),
    renderMarkdownEditor: ({
      value,
      onChange,
      editable,
      blockId,
      className,
      ariaLabel,
    }) => (
      <PlanMarkdownEditor
        markdown={value}
        editable={editable}
        className={className}
        ariaLabel={ariaLabel}
        contentUpdatedAt={options.contentUpdatedAt}
        planId={options.planId}
        blockId={blockId}
        user={options.collabUser}
        onSave={onChange}
      />
    ),
    renderAiFieldAction: (props) => <PlanAiFieldAction {...props} />,
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
    renderBlocksEditor: options.renderBlocksEditor,
    // `editSurface: "panel"` blocks (diagram, custom HTML, and other rendered
    // artifacts/config blocks) keep their rendered `Read` view and expose the
    // editor in this shadcn popover anchored to the corner button. Prose and
    // containers stay inline.
    renderEditSurface: ({
      title,
      trigger,
      children,
      open,
      onOpenChange,
      variant,
      blockId,
      blockType,
      blockTitle,
      blockSummary,
      blockData,
    }) => {
      const compactMenu = variant === "menu";

      return (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={16}
            sideOffset={6}
            onInteractOutside={(event) => {
              if (isAiEditPopoverTarget(event.target)) {
                event.preventDefault();
              }
            }}
            data-plan-interactive
            className={cn(
              "relative flex max-h-[calc(100vh-32px)] overflow-y-auto",
              compactMenu
                ? "an-block-menu-popover w-64 flex-col gap-1 rounded-xl p-1"
                : "an-block-edit-popover w-[min(42rem,calc(100vw-32px))] flex-col gap-3",
            )}
          >
            {compactMenu ? (
              children
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 truncate pt-0.5 text-sm font-semibold text-foreground">
                    {title}
                  </div>
                  {blockId && blockType ? (
                    <PlanAiBlockAction
                      label={title}
                      blockId={blockId}
                      blockType={blockType}
                      blockTitle={blockTitle}
                      blockSummary={blockSummary}
                      blockData={blockData}
                      planId={options.planId}
                    />
                  ) : null}
                </div>
                {children}
              </>
            )}
          </PopoverContent>
        </Popover>
      );
    },
  };
  return ctx;
}

export function PlanAiBlockAction({
  label,
  blockId,
  blockType,
  blockTitle,
  blockSummary,
  blockData,
  planId,
}: {
  label: string;
  blockId: string;
  blockType: string;
  blockTitle?: string;
  blockSummary?: string;
  blockData: unknown;
  planId?: string | null;
}) {
  const submitPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    sendToAgentChat({
      type: "content",
      submit: true,
      openSidebar: true,
      message: trimmed,
      context: [
        "The user is asking the agent to edit a focused block from a visual plan block editor popover.",
        planId ? `Plan id: ${planId}` : null,
        `Plan block id: ${blockId}`,
        `Plan block type: ${blockType}`,
        blockTitle ? `Block title: ${blockTitle}` : null,
        blockSummary ? `Block summary: ${blockSummary}` : null,
        "",
        "Current block data:",
        fencedValue("Block data", stringifyBlockData(blockData), "json"),
        "",
        "Patch only this block unless the user's instruction explicitly asks for a broader document change. Preserve existing block fields that the user did not ask to change.",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  };

  return (
    <InlinePromptField
      placeholder="Describe a change…"
      ariaLabel={`Describe a change to ${label.toLowerCase()}`}
      onSubmit={submitPrompt}
    />
  );
}

function PlanAiFieldAction({
  blockId,
  blockType,
  blockTitle,
  blockSummary,
  fieldLabel,
  fieldValue,
  disabled,
  instructions,
  companionFields = [],
}: BlockAiFieldActionProps) {
  const submitPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    sendToAgentChat({
      type: "content",
      submit: true,
      openSidebar: true,
      message: trimmed,
      context: [
        "The user is asking the agent to edit a focused field from a visual plan block editor.",
        `Plan block id: ${blockId}`,
        `Plan block type: ${blockType}`,
        blockTitle ? `Block title: ${blockTitle}` : null,
        blockSummary ? `Block summary: ${blockSummary}` : null,
        `Focused field: ${fieldLabel}`,
        "",
        "Focused field value:",
        fencedValue(fieldLabel, fieldValue, languageForField(fieldLabel)),
        "",
        companionFields.length ? "Current companion fields:" : null,
        ...companionFields.flatMap((field) => [
          fencedValue(
            field.label,
            field.value || "(empty)",
            field.language ?? languageForField(field.label),
          ),
        ]),
        "",
        instructions,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  };

  return (
    <InlinePromptField
      size="sm"
      subtle
      placeholder="Describe a change…"
      ariaLabel={`Describe a change to the ${fieldLabel.toLowerCase()}`}
      onSubmit={submitPrompt}
      disabled={disabled}
      fieldActionLabel={fieldLabel}
    />
  );
}

function InlinePromptField({
  placeholder,
  ariaLabel,
  onSubmit,
  disabled,
  size = "md",
  subtle,
  fieldActionLabel,
}: {
  placeholder: string;
  ariaLabel?: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  subtle?: boolean;
  fieldActionLabel?: string;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Grow the field to fit wrapped lines as the user types (capped, then scrolls).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    if (ref.current) ref.current.style.height = "";
    ref.current?.blur();
  };

  const sm = size === "sm";

  return (
    <div
      data-plan-interactive
      className={cn(
        // Static width (about halfway between the resting and expanded sizes),
        // no width animation: the field is autofocused when the popover opens,
        // so an on-focus width transition would fire immediately and look janky.
        "relative inline-flex shrink-0 items-start overflow-hidden rounded-2xl border border-input bg-background shadow-sm transition-[border-color,opacity] focus-within:border-ring",
        sm ? "w-[225px]" : "w-[290px]",
        subtle &&
          "opacity-80 focus-within:opacity-100 group-hover/field:opacity-100 group-focus-within/field:opacity-100",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        data-ai-field-action={fieldActionLabel}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className={cn(
          "max-h-[220px] w-full cursor-text resize-none bg-transparent leading-snug text-foreground outline-none placeholder:text-muted-foreground",
          sm ? "py-1.5 pl-2.5 pr-7 text-[11px]" : "py-1.5 pl-3 pr-8 text-xs",
        )}
      />
      <kbd
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-1.5 top-1.5 rounded border border-border bg-background/80 font-sans leading-tight text-muted-foreground opacity-60",
          sm ? "px-1 text-[9px]" : "px-1 text-[10px]",
        )}
      >
        ⏎
      </kbd>
    </div>
  );
}

function isAiEditPopoverTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("[data-ai-edit-popover]"))
  );
}

function languageForField(field: string): string {
  const normalized = field.toLowerCase();
  if (normalized.includes("css")) return "css";
  if (normalized.includes("json")) return "json";
  if (normalized.includes("html") || normalized.includes("svg")) return "html";
  return "text";
}

function fencedValue(label: string, value: string, language: string): string {
  return [`${label}:`, `\`\`\`${language}`, value || "(empty)", "```"].join(
    "\n",
  );
}

function stringifyBlockData(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}
