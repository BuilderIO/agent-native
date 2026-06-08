import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconMessageChatbot,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
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
  type BlockEditProps,
  type BlockReadProps,
  type NestedBlock,
  type BlockAiFieldActionProps,
} from "@agent-native/core/blocks";
import {
  PromptComposer,
  sendToAgentChat,
  type RichMarkdownCollabUser,
} from "@agent-native/core/client";
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
  visualQuestionsSchema,
  visualQuestionsMdx,
  type QuestionFormData,
  type VisualQuestionsData,
} from "@shared/blocks/question-form.config";
import {
  decisionSchema,
  decisionMdx,
  type DecisionData,
} from "@shared/blocks/decision.config";
import { CalloutBlock, CalloutBlockEdit } from "./blocks/CalloutBlock";
import { DiagramBlock, DiagramBlockEdit } from "./blocks/DiagramBlock";
import { WireframeBlock, WireframeEditor } from "./blocks/WireframeBlock";
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

function QuestionFormRead({
  data,
  blockId,
  title,
  summary,
  ctx,
}: BlockReadProps<QuestionFormData>) {
  return (
    <QuestionFormReadInner
      data={data}
      blockId={blockId}
      title={title}
      summary={summary}
      ctx={ctx}
      type="question-form"
    />
  );
}

function VisualQuestionsRead(props: BlockReadProps<VisualQuestionsData>) {
  return <QuestionFormReadInner {...props} type="visual-questions" />;
}

function QuestionFormReadInner({
  data,
  blockId,
  title,
  summary,
  ctx,
  type,
}: BlockReadProps<QuestionFormData> & {
  type: "question-form" | "visual-questions";
}) {
  const extras = ctx as BlockRenderContext & PlanBlockRenderContextExtras;
  return (
    <QuestionFormBlock
      block={{
        id: blockId,
        type,
        title,
        summary,
        data,
      }}
      onSubmit={extras.onQuestionFormSubmit}
    />
  );
}

function DecisionRead({ data, blockId, title }: BlockReadProps<DecisionData>) {
  return (
    <section className="plan-block" data-block-id={blockId}>
      {title && <div className="plan-block-label">{title}</div>}
      <p className="mt-3 max-w-3xl text-lg leading-8 text-plan-muted">
        {data.question}
      </p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {data.options.map((option) => (
          <article
            key={option.id}
            className={cn(
              "rounded-xl border border-plan-line bg-plan-block p-4",
              option.recommended
                ? "shadow-[inset_3px_0_0_hsl(var(--ring))]"
                : "opacity-85",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold tracking-tight text-plan-text">
                {option.label}
              </h3>
              {option.recommended && (
                <span className="rounded-full border border-plan-line px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-plan-muted">
                  Recommended
                </span>
              )}
            </div>
            {option.detail && (
              <p className="mt-3 text-sm leading-6 text-plan-muted">
                {option.detail}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

const inlineInputClass =
  "w-full rounded-md border border-plan-line bg-plan-document px-3 py-2 text-sm text-plan-text shadow-sm outline-none transition-colors placeholder:text-plan-muted focus:border-ring";
const inlineTextareaClass =
  "w-full resize-y rounded-md border border-plan-line bg-plan-document px-3 py-2 text-sm leading-6 text-plan-text shadow-sm outline-none transition-colors placeholder:text-plan-muted focus:border-ring";
const inlineLabelClass =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-plan-muted";

function newLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function DecisionEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<DecisionData>) {
  const updateOption = (
    optionId: string,
    patch: Partial<DecisionData["options"][number]>,
  ) =>
    onChange({
      ...data,
      options: data.options.map((option) =>
        option.id === optionId ? { ...option, ...patch } : option,
      ),
    });

  const removeOption = (optionId: string) => {
    if (data.options.length <= 1) return;
    onChange({
      ...data,
      options: data.options.filter((option) => option.id !== optionId),
    });
  };

  const addOption = () => {
    if (data.options.length >= 20) return;
    onChange({
      ...data,
      options: [
        ...data.options,
        { id: newLocalId("option"), label: "New option" },
      ],
    });
  };

  return (
    <div className="grid gap-5" data-plan-interactive>
      <div className="flex items-start gap-3">
        <label className="grid min-w-0 flex-1 gap-1.5">
          <span className={inlineLabelClass}>Question</span>
          <textarea
            className={inlineTextareaClass}
            rows={2}
            value={data.question}
            disabled={!editable}
            onChange={(event) =>
              onChange({ ...data, question: event.target.value })
            }
          />
        </label>
        {editable && (
          <DecisionSettingsPopover
            options={data.options}
            onToggleRecommended={(option) =>
              updateOption(option.id, { recommended: !option.recommended })
            }
            onRemove={removeOption}
            onAdd={addOption}
          />
        )}
      </div>
      <div className="grid gap-3">
        {data.options.map((option) => (
          <article
            key={option.id}
            className={cn(
              "rounded-lg border border-plan-line bg-plan-block p-4",
              option.recommended &&
                "border-ring/60 shadow-[inset_3px_0_0_hsl(var(--ring))]",
            )}
          >
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className={inlineLabelClass}>Option</span>
                <input
                  className={inlineInputClass}
                  value={option.label}
                  disabled={!editable}
                  onChange={(event) =>
                    updateOption(option.id, { label: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="mt-3 grid gap-1.5">
              <span className={inlineLabelClass}>Detail</span>
              <textarea
                className={inlineTextareaClass}
                rows={2}
                value={option.detail ?? ""}
                disabled={!editable}
                onChange={(event) =>
                  updateOption(option.id, {
                    detail: event.target.value || undefined,
                  })
                }
              />
            </label>
          </article>
        ))}
      </div>
    </div>
  );
}

function DecisionSettingsPopover({
  options,
  onToggleRecommended,
  onRemove,
  onAdd,
}: {
  options: DecisionData["options"];
  onToggleRecommended: (option: DecisionData["options"][number]) => void;
  onRemove: (optionId: string) => void;
  onAdd: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-plan-interactive
          aria-label="Edit decision options"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-plan-line bg-plan-block text-plan-muted transition-colors hover:bg-accent/60 hover:text-plan-text"
        >
          <IconPencil className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        collisionPadding={16}
        data-plan-interactive
        className="w-80 p-0"
      >
        <div className="border-b border-border px-3 py-2">
          <div className="text-sm font-semibold text-foreground">
            Decision settings
          </div>
        </div>
        <div className="grid gap-3 p-3">
          <div className="grid gap-2">
            {options.map((option, index) => (
              <div
                key={option.id}
                className="grid gap-2 rounded-md border border-border bg-muted/20 p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-medium text-foreground">
                    {option.label.trim() || `Option ${index + 1}`}
                  </span>
                  {option.recommended && (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-plan-interactive
                    onClick={() => onToggleRecommended(option)}
                    className={cn(
                      "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors",
                      option.recommended
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                    )}
                  >
                    {option.recommended && <IconCheck className="size-3.5" />}
                    {option.recommended ? "Recommended" : "Mark recommended"}
                  </button>
                  <button
                    type="button"
                    data-plan-interactive
                    aria-label={`Delete ${option.label || `option ${index + 1}`}`}
                    disabled={options.length <= 1}
                    onClick={() => onRemove(option.id)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-plan-interactive
            disabled={options.length >= 20}
            onClick={onAdd}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconPlus className="size-3.5" />
            Add option
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QuestionFormEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<QuestionFormData>) {
  const updateQuestion = (
    questionId: string,
    patch: Partial<QuestionFormData["questions"][number]>,
  ) =>
    onChange({
      ...data,
      questions: data.questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    });

  const addQuestion = () => {
    if (data.questions.length >= 40) return;
    onChange({
      ...data,
      questions: [
        ...data.questions,
        {
          id: newLocalId("question"),
          title: "New question",
          mode: "freeform",
          placeholder: "Type an answer...",
        },
      ],
    });
  };

  const removeQuestion = (questionId: string) => {
    if (data.questions.length <= 1) return;
    onChange({
      ...data,
      questions: data.questions.filter(
        (question) => question.id !== questionId,
      ),
    });
  };

  const setQuestionMode = (
    question: QuestionFormData["questions"][number],
    mode: QuestionFormData["questions"][number]["mode"],
  ) =>
    updateQuestion(question.id, {
      mode,
      options:
        mode === "freeform"
          ? question.options
          : question.options && question.options.length > 0
            ? question.options
            : [
                { id: newLocalId("option"), label: "Option A" },
                { id: newLocalId("option"), label: "Option B" },
              ],
    });

  const updateOption = (
    questionId: string,
    optionId: string,
    patch: Partial<
      NonNullable<QuestionFormData["questions"][number]["options"]>[number]
    >,
  ) =>
    onChange({
      ...data,
      questions: data.questions.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: (question.options ?? []).map((option) =>
                option.id === optionId ? { ...option, ...patch } : option,
              ),
            }
          : question,
      ),
    });

  const addOption = (questionId: string) =>
    onChange({
      ...data,
      questions: data.questions.map((question) =>
        question.id === questionId && (question.options?.length ?? 0) < 40
          ? {
              ...question,
              options: [
                ...(question.options ?? []),
                { id: newLocalId("option"), label: "New option" },
              ],
            }
          : question,
      ),
    });

  const removeOption = (questionId: string, optionId: string) =>
    onChange({
      ...data,
      questions: data.questions.map((question) => {
        if (question.id !== questionId) return question;
        const nextOptions = (question.options ?? []).filter(
          (option) => option.id !== optionId,
        );
        return { ...question, options: nextOptions };
      }),
    });

  return (
    <div className="grid gap-6" data-plan-interactive>
      <div className="grid gap-4">
        {data.questions.map((question, index) => {
          const options = question.options ?? [];
          return (
            <article
              key={question.id}
              className="rounded-lg border border-plan-line bg-plan-block p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className={inlineLabelClass}>Question {index + 1}</span>
                {data.questions.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete question ${index + 1}`}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-plan-line text-plan-muted hover:bg-muted hover:text-foreground"
                    disabled={!editable}
                    onClick={() => removeQuestion(question.id)}
                  >
                    <IconTrash className="size-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
                <label className="grid gap-1.5">
                  <span className={inlineLabelClass}>Title</span>
                  <input
                    className={inlineInputClass}
                    value={question.title}
                    disabled={!editable}
                    onChange={(event) =>
                      updateQuestion(question.id, {
                        title: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={inlineLabelClass}>Mode</span>
                  <select
                    className={inlineInputClass}
                    value={question.mode}
                    disabled={!editable}
                    onChange={(event) =>
                      setQuestionMode(
                        question,
                        event.target
                          .value as QuestionFormData["questions"][number]["mode"],
                      )
                    }
                  >
                    <option value="freeform">Freeform</option>
                    <option value="single">Single choice</option>
                    <option value="multi">Multi choice</option>
                  </select>
                </label>
              </div>
              <label className="mt-3 grid gap-1.5">
                <span className={inlineLabelClass}>Subtitle</span>
                <textarea
                  className={inlineTextareaClass}
                  rows={2}
                  value={question.subtitle ?? ""}
                  disabled={!editable}
                  onChange={(event) =>
                    updateQuestion(question.id, {
                      subtitle: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                <label className="grid gap-1.5">
                  <span className={inlineLabelClass}>Placeholder</span>
                  <input
                    className={inlineInputClass}
                    value={question.placeholder ?? ""}
                    disabled={!editable}
                    onChange={(event) =>
                      updateQuestion(question.id, {
                        placeholder: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="flex items-end gap-2 text-sm font-semibold text-plan-muted">
                  <input
                    type="checkbox"
                    className="mb-2 size-4"
                    checked={Boolean(question.required)}
                    disabled={!editable}
                    onChange={(event) =>
                      updateQuestion(question.id, {
                        required: event.target.checked || undefined,
                      })
                    }
                  />
                  Required
                </label>
                {question.mode !== "freeform" && (
                  <label className="flex items-end gap-2 text-sm font-semibold text-plan-muted">
                    <input
                      type="checkbox"
                      className="mb-2 size-4"
                      checked={question.allowOther !== false}
                      disabled={!editable}
                      onChange={(event) =>
                        updateQuestion(question.id, {
                          allowOther: event.target.checked ? undefined : false,
                        })
                      }
                    />
                    Allow write-in
                  </label>
                )}
              </div>
              {question.mode !== "freeform" && (
                <div className="mt-4 grid gap-3">
                  {options.map((option) => (
                    <div
                      key={option.id}
                      className="grid gap-3 rounded-md border border-plan-line/80 bg-plan-document p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                    >
                      <label className="grid gap-1.5">
                        <span className={inlineLabelClass}>Option</span>
                        <input
                          className={inlineInputClass}
                          value={option.label}
                          disabled={!editable}
                          onChange={(event) =>
                            updateOption(question.id, option.id, {
                              label: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className={inlineLabelClass}>Detail</span>
                        <input
                          className={inlineInputClass}
                          value={option.detail ?? ""}
                          disabled={!editable}
                          onChange={(event) =>
                            updateOption(question.id, option.id, {
                              detail: event.target.value || undefined,
                            })
                          }
                        />
                      </label>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          className={cn(
                            "inline-flex h-9 items-center gap-1.5 rounded-md border border-plan-line px-3 text-sm font-semibold text-plan-muted hover:bg-muted hover:text-foreground",
                            option.recommended && "border-ring text-plan-text",
                          )}
                          disabled={!editable}
                          onClick={() =>
                            updateOption(question.id, option.id, {
                              recommended: !option.recommended,
                            })
                          }
                        >
                          {option.recommended && (
                            <IconCheck className="size-4" />
                          )}
                          Recommended
                        </button>
                        {options.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Delete ${option.label}`}
                            className="inline-flex size-9 items-center justify-center rounded-md border border-plan-line text-plan-muted hover:bg-muted hover:text-foreground"
                            disabled={!editable}
                            onClick={() => removeOption(question.id, option.id)}
                          >
                            <IconTrash className="size-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-plan-line px-3 text-sm font-semibold text-plan-muted hover:bg-muted hover:text-foreground"
                    disabled={!editable || options.length >= 40}
                    onClick={() => addOption(question.id)}
                  >
                    <IconPlus className="size-4" />
                    Add option
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-plan-line px-3 text-sm font-semibold text-plan-muted hover:bg-muted hover:text-foreground"
        disabled={!editable || data.questions.length >= 40}
        onClick={addQuestion}
      >
        <IconPlus className="size-4" />
        Add question
      </button>
    </div>
  );
}

/**
 * Browser-side plan block registry. Registers the full specs (with their React
 * `Read`/`Edit`) used by `PlanBlockView` to render registered blocks. Shares the
 * exact `schema`/`mdx` config (`@shared/blocks/*.config`) with the server
 * registry (`shared/plan-block-registry.ts`) so rendering and source round-trip
 * never drift.
 *
 * Callout uses the shared `CalloutBlock` for read and a custom hybrid editor:
 * the body stays normal inline markdown prose, while tone/type metadata lives in
 * the block edit popover.
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
    Edit: CalloutBlockEdit,
    placement: ["block"],
    editSurface: "inline",
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
    // Diagram editing uses an explicit corner popover in the single-doc editor:
    // the read diagram stays stable, while the popover exposes html/css/caption
    // plus legacy node graph JSON for older diagrams.
    Edit: DiagramBlockEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Diagram",
    description:
      "A flexible inline architecture/code diagram. Prefer html/css with SVG or semantic HTML for polished two-dimensional layouts; use .diagram-* primitives and --wf-* tokens for theme/sketch compatibility. Legacy nodes/edges are only for simple previews.",
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
    Edit: QuestionFormEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Question form",
    description:
      "An interactive respondent-facing form block for open questions, single-choice or multi-choice option rows, freeform answers, recommended options, and optional wireframe/diagram previews. Edit the question schema from the block panel.",
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
  defineBlock<VisualQuestionsData>({
    type: "visual-questions",
    schema: visualQuestionsSchema,
    mdx: visualQuestionsMdx,
    Read: VisualQuestionsRead,
    Edit: QuestionFormEdit,
    placement: ["block"],
    editSurface: "panel",
    label: "Visual questions",
    description:
      "A compatibility visual-intake question block that renders the respondent-facing question UI and keeps schema editing in the block panel.",
    empty: () => ({
      submitLabel: "Send to agent",
      questions: [
        {
          id: "visual-question",
          title: "Which direction should this plan take?",
          mode: "single",
          options: [
            {
              id: "option-a",
              label: "Direction A",
              detail: "Keep the current shape and refine it.",
              recommended: true,
            },
            {
              id: "option-b",
              label: "Direction B",
              detail: "Try a larger structural revision.",
            },
          ],
          allowOther: true,
        },
      ],
    }),
  }),
  defineBlock<DecisionData>({
    type: "decision",
    schema: decisionSchema,
    mdx: decisionMdx,
    Read: DecisionRead,
    Edit: DecisionEdit,
    placement: ["block"],
    editSurface: "inline",
    label: "Decision",
    description:
      "A decision prompt with inline-editable option cards and an authored recommended choice.",
    empty: () => ({
      question: "Which implementation direction should we take?",
      options: [
        {
          id: "recommended",
          label: "Recommended path",
          detail: "Smallest useful slice with clear rollback.",
          recommended: true,
        },
        {
          id: "alternative",
          label: "Alternative",
          detail: "Broader pass that touches more surfaces.",
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
      blockId,
      blockType,
      blockTitle,
      blockSummary,
      blockData,
    }) => (
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
          className="an-block-edit-popover relative flex max-h-[calc(100vh-32px)] w-[min(42rem,calc(100vw-32px))] flex-col gap-3 overflow-y-auto"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-semibold text-foreground">
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
        </PopoverContent>
      </Popover>
    ),
  };
  return ctx;
}

function PlanAiBlockAction({
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
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusComposer = () => focusPromptComposer(popoverRef.current);
  useEffect(() => {
    if (open) focusComposer();
  }, [open]);
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
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) focusComposer();
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-plan-interactive
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
        >
          Edit with AI
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={popoverRef}
        align="end"
        side="left"
        sideOffset={8}
        collisionPadding={12}
        data-ai-edit-popover
        portalContainer={blockEditPopoverFor(triggerRef.current)}
        onPointerDownOutside={(event) => {
          event.preventDefault();
        }}
        onFocusOutside={(event) => {
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusComposer();
        }}
        className="z-[270] w-[calc(100vw-24px)] max-w-[420px] p-3"
        data-plan-interactive
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          Edit {label}
        </p>
        <PromptComposer
          autoFocus
          placeholder={`Tell the agent how to edit this ${label.toLowerCase()}...`}
          draftScope={`plan:block:${blockId}`}
          attachmentsEnabled={false}
          plusMenuMode="hidden"
          onSubmit={submitPrompt}
        />
      </PopoverContent>
    </Popover>
  );
}

function PlanAiFieldAction({
  blockId,
  blockType,
  blockTitle,
  blockSummary,
  fieldLabel,
  fieldValue,
  draftScope,
  disabled,
  instructions,
  companionFields = [],
}: BlockAiFieldActionProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const focusComposer = () => focusPromptComposer(popoverRef.current);
  useEffect(() => {
    if (open) focusComposer();
  }, [open]);
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
    setOpen(false);
  };

  const container = open ? blockEditPopoverFor(triggerRef.current) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-plan-interactive
        data-ai-field-action={fieldLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] font-medium text-muted-foreground opacity-80 shadow-sm transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/field:opacity-100 group-focus-within/field:opacity-100 data-[state=open]:opacity-100 disabled:pointer-events-none disabled:opacity-40"
        disabled={disabled}
        onClick={() => {
          setOpen((nextOpen) => {
            const shouldOpen = !nextOpen;
            if (shouldOpen) focusComposer();
            return shouldOpen;
          });
        }}
      >
        <IconMessageChatbot className="size-3.5" />
        Edit with AI
      </button>
      {open && container
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={`Edit ${fieldLabel}`}
              data-ai-edit-popover
              data-plan-interactive
              className="absolute right-3 top-12 z-[270] w-[calc(100%-24px)] max-w-[420px] rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
            >
              <p className="px-1 pb-2 text-sm font-semibold text-foreground">
                Edit {fieldLabel}
              </p>
              <PromptComposer
                autoFocus
                placeholder={`Tell the agent how to change the ${fieldLabel.toLowerCase()}...`}
                draftScope={draftScope}
                attachmentsEnabled={false}
                plusMenuMode="hidden"
                onSubmit={submitPrompt}
              />
            </div>,
            container,
          )
        : null}
    </>
  );
}

function focusPromptComposer(container: HTMLElement | null) {
  if (typeof window === "undefined") return;
  const focus = () => {
    const target = container?.querySelector<HTMLElement>(
      "[data-agent-composer-slot='editor-input'], .agent-composer-editor [contenteditable='true']",
    );
    target?.focus();
  };
  window.requestAnimationFrame(focus);
  window.setTimeout(focus, 80);
  window.setTimeout(focus, 180);
}

function isAiEditPopoverTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("[data-ai-edit-popover]"))
  );
}

function blockEditPopoverFor(element: HTMLElement | null): HTMLElement | null {
  const closest = element?.closest<HTMLElement>(".an-block-edit-popover");
  if (closest) return closest;
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(".an-block-edit-popover");
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
