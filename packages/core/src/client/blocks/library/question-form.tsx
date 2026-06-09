import { useEffect, useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconClipboardText,
  IconPlus,
  IconSend,
  IconTrash,
} from "@tabler/icons-react";
import { cn } from "../../utils.js";
import { defineBlock } from "../types.js";
import type {
  BlockReadProps,
  BlockEditProps,
  BlockRenderContext,
  NestedBlock,
} from "../types.js";
import {
  questionFormSchema,
  questionFormMdx,
  visualQuestionsSchema,
  visualQuestionsMdx,
  type QuestionFormData,
  type QuestionFormOption,
  type QuestionFormQuestion,
  type QuestionMode,
  type VisualQuestionsData,
} from "./question-form.config.js";

/**
 * Shared `question-form` and `visual-questions` blocks. A respondent-facing
 * intake form: single/multi/freeform questions, recommended options, optional
 * write-in answers, and optional inline wireframe/diagram previews per option.
 * Lives in core so any app can register it (it originated in the plan template).
 *
 * The block stays app-agnostic:
 * - It is shadcn-free. The "Send to agent" affordance uses `ctx.renderEditSurface`
 *   (the app-provided popover primitive); when no surface is wired it falls back
 *   to a plain button that submits directly.
 * - Submission routes through `ctx.onQuestionFormSubmit` so each app wires its own
 *   destination (plan posts the summary into the side agent). The readable summary
 *   string is built generically here from questions + collected answers.
 * - Per-option `wireframe`/`diagram` previews render through `ctx.renderBlock`
 *   (the same nested-block seam tabs/columns use), so core never imports an app's
 *   wireframe or diagram renderer.
 * - Colors map to shadcn theme tokens (`text-muted-foreground`, `border-border`,
 *   `bg-background`, `bg-card`, `primary`). The root section carries BOTH the
 *   app-neutral `an-questions-block` class and the legacy `plan-questions-block`
 *   class so plan renders byte-identically while other apps get the theme treatment.
 */

/**
 * `ctx.onQuestionFormSubmit` is the documented submit hook. It is read off the
 * render context as an optional extra so a host that has not yet added it to its
 * provider degrades to a no-op (the button disables) rather than throwing.
 */
type QuestionFormSubmitCtx = BlockRenderContext & {
  onQuestionFormSubmit?: (summary: string) => void;
};

/**
 * Reviewer answers are transient and never persisted on block data — they live
 * in local component state keyed by question id. `freeform` → a string;
 * `single`/`multi` → selected option ids (with an optional write-in `text`).
 */
type QuestionAnswer = { text?: string; selected?: string[] };
type QuestionAnswers = Record<string, QuestionAnswer>;

function isAnswered(
  question: QuestionFormQuestion,
  answer?: QuestionAnswer,
): boolean {
  if (question.mode === "freeform") return Boolean(answer?.text?.trim());
  return Boolean(answer?.selected?.length || answer?.text?.trim());
}

/**
 * Build a readable, agent-ready summary string from the questions + collected
 * answers. Generic replacement for the plan-specific `summarizeQuestionForm`.
 */
function summarizeAnswers(
  blockId: string | undefined,
  blockTitle: string | undefined,
  questions: QuestionFormQuestion[],
  answers: QuestionAnswers,
): string {
  const lines = [
    "Use these question answers to revise the plan:",
    blockId ? `Question block: ${blockId}` : "",
    blockTitle ? `Section: ${blockTitle}` : "",
    "",
  ].filter((line) => line !== "");
  for (const question of questions) {
    const answer = answers[question.id];
    const selectedLabels =
      question.options
        ?.filter((option) => answer?.selected?.includes(option.id))
        .map((option) => option.label) ?? [];
    const other = answer?.text?.trim();
    const value =
      question.mode === "freeform"
        ? other
        : [...selectedLabels, ...(other ? [`Other: ${other}`] : [])].join(", ");
    lines.push(`- ${question.title}: ${value || "No answer yet"}`);
  }
  return lines.join("\n");
}

/** Render an inline preview (wireframe or diagram) through the app's dispatcher. */
function OptionVisual({
  type,
  data,
  blockId,
  ctx,
}: {
  type: "wireframe" | "diagram";
  data: unknown;
  blockId: string;
  ctx: BlockRenderContext;
}) {
  if (!data || !ctx.renderBlock) return null;
  const block: NestedBlock = {
    id: `${blockId}-${type}`,
    type,
    data,
  };
  return (
    <>{ctx.renderBlock({ block, editing: false, compactVisuals: true })}</>
  );
}

function QuestionView({
  question,
  index,
  answer,
  blockId,
  ctx,
  onAnswer,
}: {
  question: QuestionFormQuestion;
  index: number;
  answer?: QuestionAnswer;
  blockId: string;
  ctx: BlockRenderContext;
  onAnswer: (answer: QuestionAnswer) => void;
}) {
  const selected = answer?.selected ?? [];
  const hasVisualOptions = Boolean(
    question.options?.some((option) => option.wireframe || option.diagram),
  );
  return (
    <article className="grid gap-4 sm:grid-cols-[36px_minmax(0,1fr)]">
      <div className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground">
        {index + 1}
      </div>
      <div>
        <h3 className="text-lg font-semibold leading-7 text-foreground">
          {question.title}
        </h3>
        {question.subtitle && (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
            {question.subtitle}
          </p>
        )}
        {question.mode === "freeform" ? (
          <textarea
            value={answer?.text ?? ""}
            onChange={(event) => onAnswer({ text: event.target.value })}
            className="mt-4 min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            data-plan-interactive
            placeholder={question.placeholder || "Add details..."}
          />
        ) : (
          <div
            className={cn(
              "mt-4",
              hasVisualOptions
                ? "grid gap-4 md:grid-cols-2"
                : "grid max-w-4xl gap-3",
            )}
          >
            {question.options?.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  data-plan-interactive
                  aria-pressed={isSelected}
                  className={cn(
                    hasVisualOptions
                      ? "grid gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/30"
                      : "grid w-full gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left text-foreground transition-colors hover:border-primary/40 hover:bg-accent/30",
                    isSelected && "border-primary/40 bg-primary/10",
                  )}
                  onClick={() => {
                    if (question.mode === "single") {
                      onAnswer({ ...answer, selected: [option.id] });
                      return;
                    }
                    onAnswer({
                      ...answer,
                      selected: isSelected
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id],
                    });
                  }}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center border",
                        question.mode === "single" ? "rounded-full" : "rounded",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {isSelected && <IconCheck className="size-3.5" />}
                    </span>
                    <span>
                      <span className="text-base font-semibold leading-6 text-foreground">
                        {option.label}
                      </span>
                      {option.recommended && (
                        <>
                          {" "}
                          <span className="ml-3 rounded-md border border-primary/30 px-2 py-0.5 align-middle text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                            Recommended
                          </span>
                        </>
                      )}
                      {option.detail && (
                        <span className="mt-1 block max-w-2xl whitespace-pre-line text-sm font-normal leading-6 text-muted-foreground">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </div>
                  {hasVisualOptions && (option.wireframe || option.diagram) && (
                    <div className="ml-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                      {option.wireframe != null && (
                        <OptionVisual
                          type="wireframe"
                          data={option.wireframe}
                          blockId={`${blockId}-${option.id}`}
                          ctx={ctx}
                        />
                      )}
                      {option.diagram != null && (
                        <OptionVisual
                          type="diagram"
                          data={option.diagram}
                          blockId={`${blockId}-${option.id}`}
                          ctx={ctx}
                        />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
            {/* Multiple-choice questions always offer a write-in answer so a
                reviewer can give a custom response instead of the listed
                options. Authors opt out only by setting allowOther: false. */}
            {question.allowOther !== false && (
              <input
                value={answer?.text ?? ""}
                onChange={(event) =>
                  onAnswer({ ...answer, text: event.target.value })
                }
                className={cn(
                  "h-10 w-full rounded-lg border border-border bg-card px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring",
                  hasVisualOptions ? "md:col-span-2" : "sm:w-80",
                )}
                data-plan-interactive
                placeholder={
                  question.placeholder || "Other — type your own answer…"
                }
              />
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** The "Send to agent" affordance: a popover (via the app surface) when wired. */
function SubmitMenu({
  ctx,
  onSubmit,
  buildSummary,
}: {
  ctx: BlockRenderContext;
  onSubmit?: (summary: string) => void;
  buildSummary: () => string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <button
      type="button"
      data-plan-interactive
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      Send to agent
      <IconChevronDown className="size-3.5 opacity-70" />
    </button>
  );

  const menu = (
    <div className="grid gap-1">
      <div className="px-1 py-1 text-xs font-semibold text-muted-foreground">
        Send feedback
      </div>
      <button
        type="button"
        data-plan-interactive
        onClick={() => {
          void navigator.clipboard.writeText(buildSummary());
          setOpen(false);
        }}
        className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent"
      >
        <IconClipboardText className="mt-0.5 size-4" />
        <span className="grid gap-0.5">
          <span>Copy for your agent</span>
          <span className="text-xs font-normal leading-4 text-muted-foreground">
            Copies a prompt you can paste into chat.
          </span>
        </span>
      </button>
      <button
        type="button"
        data-plan-interactive
        disabled={!onSubmit}
        onClick={() => {
          onSubmit?.(buildSummary());
          setOpen(false);
        }}
        className="grid grid-cols-[auto_1fr] items-start gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconSend className="mt-0.5 size-4" />
        <span className="grid gap-0.5">
          <span>Send to inline agent</span>
          <span className="text-xs font-normal leading-4 text-muted-foreground">
            Posts answered questions into the app side agent.
          </span>
        </span>
      </button>
    </div>
  );

  // Prefer the app-provided popover surface (shadcn Popover in plan/content);
  // core stays shadcn-free. Without a surface, fall back to a single button that
  // submits directly so the form still works.
  const surface = ctx.renderEditSurface?.({
    title: "Send to agent",
    open,
    onOpenChange: setOpen,
    variant: "menu",
    trigger,
    children: menu,
  });
  if (surface) return <>{surface}</>;

  return (
    <button
      type="button"
      data-plan-interactive
      disabled={!onSubmit}
      onClick={() => onSubmit?.(buildSummary())}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Send to agent
    </button>
  );
}

/** Shared read renderer for both `question-form` and `visual-questions`. */
function QuestionFormReadInner({
  data,
  blockId,
  title,
  ctx,
}: BlockReadProps<QuestionFormData>) {
  const questions = data.questions;
  const [answers, setAnswers] = useState<QuestionAnswers>({});
  const submitCtx = ctx as QuestionFormSubmitCtx;

  useEffect(() => {
    setAnswers({});
  }, [blockId]);

  const setAnswer = (questionId: string, next: QuestionAnswer) => {
    setAnswers((current) => ({ ...current, [questionId]: next }));
  };

  const answered = questions.filter((question) =>
    isAnswered(question, answers[question.id]),
  ).length;
  const buildSummary = () =>
    summarizeAnswers(blockId, title, questions, answers);

  return (
    <section
      className="an-questions-block plan-questions-block"
      data-block-id={blockId}
    >
      {title && (
        <h2 className="text-[1.45rem] font-semibold leading-tight text-foreground">
          {title}
        </h2>
      )}
      <div className="mt-7 grid gap-8">
        {questions.map((question, index) => (
          <QuestionView
            key={question.id}
            question={question}
            index={index}
            answer={answers[question.id]}
            blockId={blockId}
            ctx={ctx}
            onAnswer={(next) => setAnswer(question.id, next)}
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-10 flex items-center justify-between gap-4 border-t border-border py-4">
        <p className="text-sm font-semibold text-muted-foreground">
          {answered}/{questions.length} answered
        </p>
        <div data-plan-interactive>
          <SubmitMenu
            ctx={ctx}
            onSubmit={submitCtx.onQuestionFormSubmit}
            buildSummary={buildSummary}
          />
        </div>
      </div>
    </section>
  );
}

export function QuestionFormRead(props: BlockReadProps<QuestionFormData>) {
  return <QuestionFormReadInner {...props} />;
}

export function VisualQuestionsRead(
  props: BlockReadProps<VisualQuestionsData>,
) {
  return <QuestionFormReadInner {...props} />;
}

const inlineInputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring";
const inlineTextareaClass =
  "w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring";
const inlineLabelClass =
  "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

function newLocalId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Shared editor for both `question-form` and `visual-questions`. */
export function QuestionFormEdit({
  data,
  onChange,
  editable,
}: BlockEditProps<QuestionFormData>) {
  const updateQuestion = (
    questionId: string,
    patch: Partial<QuestionFormQuestion>,
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
    question: QuestionFormQuestion,
    mode: QuestionMode,
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
    patch: Partial<QuestionFormOption>,
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
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className={inlineLabelClass}>Question {index + 1}</span>
                {data.questions.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete question ${index + 1}`}
                    className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
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
                        event.target.value as QuestionMode,
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
                <label className="flex items-end gap-2 text-sm font-semibold text-muted-foreground">
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
                  <label className="flex items-end gap-2 text-sm font-semibold text-muted-foreground">
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
                      className="grid gap-3 rounded-md border border-border/80 bg-background p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
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
                            "inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
                            option.recommended && "border-ring text-foreground",
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
                            className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
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
                    className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
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
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
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
 * Full client spec for the shared `question-form` block. A respondent-facing
 * intake form edited from the block panel (the schema-ish question shape lives
 * behind the edit surface, not inline).
 */
export const questionFormBlock = defineBlock<QuestionFormData>({
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
});

/**
 * Full client spec for the shared `visual-questions` block — the same form UI
 * and data shape as `question-form`, branded for explicit visual intake before a
 * plan. Shares the Read/Edit internals; only the type, MDX tag, label, and seed
 * differ.
 */
export const visualQuestionsBlock = defineBlock<VisualQuestionsData>({
  type: "visual-questions",
  schema: visualQuestionsSchema,
  mdx: visualQuestionsMdx,
  Read: VisualQuestionsRead,
  Edit: QuestionFormEdit,
  placement: ["block"],
  editSurface: "panel",
  label: "Visual questions",
  description:
    "A visual-intake question block that renders the respondent-facing question UI (single/multi/freeform, recommended options, inline wireframe/diagram previews) and keeps schema editing in the block panel.",
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
});
