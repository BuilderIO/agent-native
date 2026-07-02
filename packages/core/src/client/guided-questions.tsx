import {
  IconCheck,
  IconChevronRight,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { sendToAgentChat } from "./agent-chat.js";
import { agentNativePath } from "./api-path.js";
import { setClientAppState } from "./application-state.js";
import { cn } from "./utils.js";

export type GuidedQuestionType =
  | "text-options"
  | "color-options"
  | "slider"
  | "file"
  | "freeform";

export interface GuidedQuestionOption {
  label: string;
  value: string;
  color?: string;
  icon?: string;
  description?: string;
  recommended?: boolean;
  /** Optional preview content (mockup, code snippet, or short comparison)
   *  shown beneath the option to help the user compare choices. Mirrors the
   *  `preview` field of Claude Code's AskUserQuestion options. */
  preview?: string;
}

export interface GuidedQuestion {
  id: string;
  type: GuidedQuestionType;
  header?: string;
  question: string;
  description?: string;
  options?: GuidedQuestionOption[];
  choices?: GuidedQuestionOption[];
  multiSelect?: boolean;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
  includeExplore?: boolean;
  includeDecide?: boolean;
  /** Submit immediately when a single-select option is clicked. */
  submitOnSelect?: boolean;
}

export type GuidedQuestionAnswers = Record<string, unknown>;

export interface GuidedQuestionPayload {
  questions: GuidedQuestion[];
  title?: string;
  description?: string;
  skipLabel?: string;
  submitLabel?: string;
  submitMessage?: string;
  skipMessage?: string;
  /**
   * @internal Set by {@link askUserQuestion} for client-initiated questions.
   * When present, `useGuidedQuestionFlow` resolves the matching in-memory
   * promise with the answer instead of forwarding it to the agent chat.
   */
  clientResolveId?: string;
}

const OTHER_OPTION_PREFIX = "__other__:";
const EXPLORE_OPTION: GuidedQuestionOption = {
  label: "Explore a few options",
  value: "__explore__",
  description: "Show me a few distinct directions before committing.",
};
const DECIDE_OPTION: GuidedQuestionOption = {
  label: "Decide for me",
  value: "__decide__",
  description: "Use your judgment and keep moving.",
};

function isFileLike(value: unknown): value is { name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

export function isOtherGuidedAnswer(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(OTHER_OPTION_PREFIX);
}

export function getOtherGuidedAnswerText(value: unknown): string {
  return isOtherGuidedAnswer(value)
    ? value.slice(OTHER_OPTION_PREFIX.length)
    : "";
}

export function makeOtherGuidedAnswer(text = ""): string {
  return `${OTHER_OPTION_PREFIX}${text}`;
}

export function hasGuidedAnswer(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasGuidedAnswer);
  if (isOtherGuidedAnswer(value)) {
    return getOtherGuidedAnswerText(value).trim().length > 0;
  }
  return true;
}

export function formatGuidedAnswerValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(formatGuidedAnswerValue).filter(hasGuidedAnswer);
  }
  if (isOtherGuidedAnswer(value)) {
    const text = getOtherGuidedAnswerText(value).trim();
    return text ? `Other: ${text}` : "";
  }
  if (isFileLike(value)) return value.name;
  return value;
}

export function normalizeGuidedAnswers(
  answers: GuidedQuestionAnswers,
): GuidedQuestionAnswers {
  return Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [
      id,
      formatGuidedAnswerValue(value),
    ]),
  );
}

export function formatGuidedAnswersForAgent(
  answers: GuidedQuestionAnswers,
): string {
  return Object.entries(normalizeGuidedAnswers(answers))
    .filter(([, value]) => hasGuidedAnswer(value))
    .map(([id, value]) => {
      if (Array.isArray(value)) return `${id}: ${value.join(", ")}`;
      return `${id}: ${String(value)}`;
    })
    .join("\n");
}

function defaultGuidedSubmitContext(formattedAnswers: string): string {
  return [
    "The user answered the guided questions.",
    "Use the selected option values below as authoritative. If an answer includes exact ids, file names, or action instructions, follow those exact details instead of inferring them.",
    "",
    "Answers:",
    formattedAnswers,
  ].join("\n");
}

/** A single option for {@link askUserQuestion}. Mirrors the agent `ask-question`
 *  tool and Claude Code's AskUserQuestion option shape. */
export interface AskUserQuestionOption {
  /** Display text the user picks (1-5 words). */
  label: string;
  /** Value reported back. Defaults to `label` when omitted. */
  value?: string;
  /** Short explanation of the trade-off. */
  description?: string;
  /** Optional preview (mockup, code snippet, short comparison) shown under the option. */
  preview?: string;
  /** Mark the most likely option so the UI highlights it. */
  recommended?: boolean;
}

/** Input for {@link askUserQuestion}. */
export interface AskUserQuestionInput {
  /** The complete question. Clear, specific, ends with a question mark. */
  question: string;
  /** Optional very short chip/heading (≈12 chars), e.g. "Date range". */
  header?: string;
  /** 2-4 distinct options (mutually exclusive unless `allowMultiple`). */
  options: AskUserQuestionOption[];
  /** Allow a free-text "Other" answer. Default `true`. */
  allowFreeText?: boolean;
  /** Allow selecting more than one option (multi-select). Default `false`. */
  allowMultiple?: boolean;
  /** Application-state key the agent panel polls. Default `"guided-questions"`. */
  stateKey?: string;
}

const GUIDED_QUESTIONS_STATE_KEY = "guided-questions";

/** The user's answer to an {@link askUserQuestion}: the selected option
 *  value(s), the free-text "Other" string, or `null` if the user skipped. */
export type AskUserQuestionResult = string | string[] | null;

// In-memory resolver registry shared between `askUserQuestion` (which registers
// a resolver and writes the question to application state) and
// `useGuidedQuestionFlow` (which renders the question and, on submit/skip,
// resolves the matching promise). Same module → the map is shared.
type AskQuestionResolver = (answer: AskUserQuestionResult) => void;
const clientQuestionResolvers = new Map<string, AskQuestionResolver>();
let askQuestionCounter = 0;

function nextClientResolveId(): string {
  askQuestionCounter += 1;
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `askq-${askQuestionCounter}-${rand}`;
}

/** Resolve a pending client-initiated question by id. Returns false when no
 *  resolver is registered (e.g. an agent-initiated question, or a reload). */
function resolveClientQuestion(
  id: string,
  answer: AskUserQuestionResult,
): boolean {
  const resolver = clientQuestionResolvers.get(id);
  if (!resolver) return false;
  clientQuestionResolvers.delete(id);
  resolver(answer);
  return true;
}

/** Pull the answer for a single guided question out of the answers map,
 *  normalizing "Other" free-text and multi-select arrays. */
function extractSingleAnswer(
  answers: GuidedQuestionAnswers,
  questionId: string,
): AskUserQuestionResult {
  const raw = answers[questionId];
  if (!hasGuidedAnswer(raw)) return null;
  if (Array.isArray(raw)) {
    const values = raw
      .map((v) =>
        isOtherGuidedAnswer(v) ? getOtherGuidedAnswerText(v).trim() : String(v),
      )
      .filter((s) => s.length > 0);
    return values.length ? values : null;
  }
  if (isOtherGuidedAnswer(raw)) {
    const text = getOtherGuidedAnswerText(raw).trim();
    return text.length ? text : null;
  }
  return String(raw);
}

/**
 * Ask the user a multiple-choice question from app code and render it inline in
 * the agent panel — the client-side twin of the agent's `ask-question` tool.
 *
 * The question is written to application state (`"guided-questions"` by
 * default), where the mounted `GuidedQuestionFlow` (driven by
 * {@link useGuidedQuestionFlow}) renders it, and the agent panel is revealed so
 * it's visible. **Resolves with the user's answer** — the selected option
 * value (or `value[]` when `allowMultiple`), the free-text "Other" string, or
 * `null` if they skip — so the caller can branch on it (e.g. build the right
 * generate prompt before kicking off agent work):
 *
 * ```ts
 * const length = await askUserQuestion({
 *   question: "How long should this deck be?",
 *   header: "Deck length",
 *   options: [{ label: "Short", recommended: true }, { label: "Long" }],
 * });
 * if (length) sendToAgentChat({ message: `Make a ${length} deck`, submit: true });
 * ```
 *
 * Requires the agent panel (the mounted `GuidedQuestionFlow`) to exist, which
 * it does in every template. The returned promise stays pending until the user
 * answers or skips.
 */
export async function askUserQuestion(
  input: AskUserQuestionInput,
): Promise<AskUserQuestionResult> {
  const question = String(input?.question ?? "").trim();
  if (!question) {
    throw new TypeError("askUserQuestion: `question` is required.");
  }
  const header =
    typeof input.header === "string" && input.header.trim()
      ? input.header.trim()
      : undefined;
  const allowMultiple = input.allowMultiple === true;
  const allowFreeText = input.allowFreeText !== false;

  const options: GuidedQuestionOption[] = (
    Array.isArray(input.options) ? input.options : []
  )
    .map((raw): GuidedQuestionOption | null => {
      const label =
        typeof raw?.label === "string" && raw.label.trim()
          ? raw.label.trim()
          : typeof raw?.value === "string"
            ? String(raw.value).trim()
            : "";
      if (!label) return null;
      const value =
        typeof raw?.value === "string" && raw.value.trim()
          ? raw.value.trim()
          : label;
      const option: GuidedQuestionOption = { label, value };
      if (typeof raw.description === "string" && raw.description.trim()) {
        option.description = raw.description.trim();
      }
      if (typeof raw.preview === "string" && raw.preview.trim()) {
        option.preview = raw.preview;
      }
      if (raw.recommended === true) option.recommended = true;
      return option;
    })
    .filter((opt): opt is GuidedQuestionOption => opt !== null);

  if (options.length === 0) {
    throw new TypeError(
      "askUserQuestion: `options` must contain at least one option with a label.",
    );
  }

  const resolveId = nextClientResolveId();
  const payload: GuidedQuestionPayload = {
    clientResolveId: resolveId,
    questions: [
      {
        id: "q1",
        type: "text-options",
        question,
        ...(header ? { header } : {}),
        required: !allowFreeText,
        multiSelect: allowMultiple,
        allowOther: allowFreeText,
        includeExplore: false,
        includeDecide: false,
        options,
      },
    ],
  };

  const answerPromise = new Promise<AskUserQuestionResult>((resolve) => {
    clientQuestionResolvers.set(resolveId, resolve);
  });

  // Reveal the agent panel so the inline question is visible even if collapsed.
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("agent-panel:open"));
    } catch {
      // best-effort — the question still renders if the panel is already open
    }
  }

  try {
    await setClientAppState(
      input.stateKey ?? GUIDED_QUESTIONS_STATE_KEY,
      payload,
    );
  } catch (err) {
    clientQuestionResolvers.delete(resolveId);
    throw err;
  }

  return answerPromise;
}

function optionKey(option: GuidedQuestionOption): string {
  return `${option.value.toLowerCase()}::${option.label.toLowerCase()}`;
}

/** Stable content hash so poll refreshes do not reset in-progress answers. */
export function guidedQuestionsFingerprint(
  questions: GuidedQuestion[],
): string {
  return JSON.stringify(
    questions.map((question) => ({
      id: question.id,
      type: question.type,
      header: question.header ?? null,
      question: question.question,
      description: question.description ?? null,
      multiSelect: question.multiSelect ?? false,
      required: question.required ?? false,
      allowOther: question.allowOther ?? null,
      includeExplore: question.includeExplore ?? null,
      includeDecide: question.includeDecide ?? null,
      submitOnSelect: question.submitOnSelect ?? false,
      min: question.min ?? null,
      max: question.max ?? null,
      step: question.step ?? null,
      placeholder: question.placeholder ?? null,
      options: (question.options ?? question.choices ?? []).map((option) => ({
        label: option.label,
        value: option.value,
        color: option.color ?? null,
        description: option.description ?? null,
        recommended: option.recommended ?? false,
      })),
    })),
  );
}

function withDefaultOptions(question: GuidedQuestion): GuidedQuestionOption[] {
  const base = question.options ?? question.choices ?? [];
  const seen = new Set(base.map(optionKey));
  const result = [...base];
  const maybePush = (option: GuidedQuestionOption, enabled: boolean) => {
    if (!enabled) return;
    const key = optionKey(option);
    const label = option.label.toLowerCase();
    const value = option.value.toLowerCase();
    const duplicate = result.some(
      (existing) =>
        optionKey(existing) === key ||
        existing.label.toLowerCase() === label ||
        existing.value.toLowerCase() === value,
    );
    if (duplicate || seen.has(key)) return;
    seen.add(key);
    result.push(option);
  };
  maybePush(EXPLORE_OPTION, question.includeExplore !== false);
  maybePush(DECIDE_OPTION, question.includeDecide !== false);
  return result;
}

export interface GuidedQuestionFlowProps {
  questions: GuidedQuestion[];
  onSubmit: (answers: GuidedQuestionAnswers) => void;
  onSkip: () => void;
  title?: string;
  description?: string;
  skipLabel?: string;
  submitLabel?: string;
  className?: string;
}

export function GuidedQuestionFlow({
  questions,
  onSubmit,
  onSkip,
  title = "Before I generate",
  description = "Use Other for custom details, or let the agent decide.",
  skipLabel = "Skip",
  submitLabel = "Continue",
  className,
}: GuidedQuestionFlowProps) {
  const [answers, setAnswers] = useState<GuidedQuestionAnswers>({});
  const questionsFingerprint = useMemo(
    () => guidedQuestionsFingerprint(questions),
    [questions],
  );

  useEffect(() => {
    setAnswers({});
  }, [questionsFingerprint]);

  const setAnswer = useCallback((id: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);
  const submitAnswers = useCallback(
    (nextAnswers: GuidedQuestionAnswers = answers) =>
      onSubmit(normalizeGuidedAnswers(nextAnswers)),
    [answers, onSubmit],
  );

  const allRequiredAnswered = questions
    .filter((question) => question.required)
    .every((question) => hasGuidedAnswer(answers[question.id]));

  return (
    <div
      className={cn(
        "guided-question-flow flex h-full w-full items-center justify-center bg-background text-foreground",
        className,
      )}
    >
      <div className="guided-question-flow-inner flex max-h-full w-full max-w-3xl flex-col px-3 py-4">
        <div className="guided-question-flow-header mb-4 min-w-0">
          <h2 className="guided-question-flow-title text-lg font-semibold leading-tight tracking-normal text-foreground">
            {title}
          </h2>
          {description && (
            <p className="guided-question-flow-description mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        <div className="guided-question-flow-list min-h-0 flex-1 overflow-y-auto pe-1">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              index={index}
              question={question}
              value={answers[question.id]}
              onChange={(value) => setAnswer(question.id, value)}
              onSubmitAnswer={(value) =>
                submitAnswers({ ...answers, [question.id]: value })
              }
            />
          ))}
        </div>

        <div className="guided-question-flow-footer mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            {questions.map((question, index) => (
              <span
                key={question.id || index}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  hasGuidedAnswer(answers[question.id])
                    ? "bg-primary"
                    : "bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSkip}
              className="cursor-pointer rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              {skipLabel}
            </button>
            <button
              type="button"
              onClick={() => submitAnswers()}
              disabled={!allRequiredAnswered}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitLabel}
              <IconChevronRight className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({
  index,
  question,
  value,
  onChange,
  onSubmitAnswer,
}: {
  index: number;
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onSubmitAnswer: (value: unknown) => void;
}) {
  return (
    <section className="guided-question-card border-t border-border/60 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="mb-2 flex gap-2.5">
        <div className="guided-question-index mt-0.5 min-w-4 text-xs font-medium tabular-nums text-muted-foreground">
          {index + 1}
        </div>
        <div className="min-w-0">
          {question.header && (
            <p className="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
              {question.header}
            </p>
          )}
          <h3 className="text-sm font-medium leading-5 text-foreground">
            {question.question}
            {question.required && (
              <span className="ms-1 text-destructive">*</span>
            )}
          </h3>
          {question.description && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {question.description}
            </p>
          )}
        </div>
      </div>

      {question.type === "text-options" && (
        <TextOptions
          question={question}
          value={value}
          onChange={onChange}
          onSubmitAnswer={onSubmitAnswer}
        />
      )}
      {question.type === "color-options" && (
        <ColorOptions question={question} value={value} onChange={onChange} />
      )}
      {question.type === "slider" && (
        <SliderQuestion question={question} value={value} onChange={onChange} />
      )}
      {question.type === "file" && (
        <FileDropZone value={value} onChange={onChange} />
      )}
      {question.type === "freeform" && (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder ?? "Type your answer..."}
          className="min-h-[84px] w-full resize-none rounded-md border border-border bg-muted/45 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary"
        />
      )}
    </section>
  );
}

function TextOptions({
  question,
  value,
  onChange,
  onSubmitAnswer,
}: {
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onSubmitAnswer: (value: unknown) => void;
}) {
  const options = useMemo(() => withDefaultOptions(question), [question]);
  const multiSelect = question.multiSelect === true;
  const selectedValues = Array.isArray(value) ? value : [];
  const otherSelected = multiSelect
    ? selectedValues.some(isOtherGuidedAnswer)
    : isOtherGuidedAnswer(value);
  const otherText = multiSelect
    ? getOtherGuidedAnswerText(selectedValues.find(isOtherGuidedAnswer))
    : getOtherGuidedAnswerText(value);

  const isSelected = (optionValue: string) =>
    multiSelect ? selectedValues.includes(optionValue) : value === optionValue;

  const toggleOption = (optionValue: string) => {
    if (!multiSelect) {
      onChange(optionValue);
      if (question.submitOnSelect) onSubmitAnswer(optionValue);
      return;
    }
    const next = selectedValues.includes(optionValue)
      ? selectedValues.filter((item) => item !== optionValue)
      : [...selectedValues, optionValue];
    onChange(next);
  };

  const toggleOther = () => {
    if (!multiSelect) {
      onChange(otherSelected ? "" : makeOtherGuidedAnswer());
      return;
    }
    if (otherSelected) {
      onChange(selectedValues.filter((item) => !isOtherGuidedAnswer(item)));
      return;
    }
    onChange([...selectedValues, makeOtherGuidedAnswer()]);
  };

  const setOtherText = (text: string) => {
    const nextOther = makeOtherGuidedAnswer(text);
    if (!multiSelect) {
      onChange(nextOther);
      return;
    }
    onChange([
      ...selectedValues.filter((item) => !isOtherGuidedAnswer(item)),
      nextOther,
    ]);
  };

  const allowOther = question.allowOther !== false;

  return (
    <div className="space-y-2.5">
      <div className="guided-question-flow-options grid grid-cols-1 gap-2">
        {options.map((option) => (
          <OptionButton
            key={`${option.value}:${option.label}`}
            option={option}
            selected={isSelected(option.value)}
            multiSelect={multiSelect}
            onClick={() => toggleOption(option.value)}
          />
        ))}
        {allowOther && (
          <OptionButton
            option={{
              label: "Other...",
              value: "__other__",
              description: "Tell the agent exactly what you mean.",
            }}
            selected={otherSelected}
            multiSelect={multiSelect}
            onClick={toggleOther}
          />
        )}
      </div>
      {allowOther && otherSelected && (
        <textarea
          autoFocus
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          placeholder={question.placeholder ?? "Type a custom answer..."}
          className="min-h-[72px] w-full resize-none rounded-md border border-border bg-muted/45 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary"
        />
      )}
    </div>
  );
}

function OptionButton({
  option,
  selected,
  multiSelect,
  onClick,
}: {
  option: GuidedQuestionOption;
  selected: boolean;
  multiSelect?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group flex min-h-11 min-w-0 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-start transition-colors",
        selected
          ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/25"
          : "border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/45 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border",
          multiSelect ? "rounded-sm" : "rounded-full",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background",
        )}
        aria-hidden
      >
        {selected && <IconCheck className="h-3 w-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-5">
          {option.label}
          {option.recommended && (
            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
              Recommended
            </span>
          )}
        </span>
        {option.description && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {option.description}
          </span>
        )}
        {option.preview && (
          <span className="mt-1.5 block max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
            {option.preview}
          </span>
        )}
      </span>
    </button>
  );
}

function ColorOptions({
  question,
  value,
  onChange,
}: {
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = question.options ?? question.choices ?? [];
  const multiSelect = question.multiSelect === true;
  const selectedValues = Array.isArray(value) ? value : [];
  const isSelected = (optionValue: string) =>
    multiSelect ? selectedValues.includes(optionValue) : value === optionValue;

  const toggleOption = (optionValue: string) => {
    if (!multiSelect) {
      onChange(optionValue);
      return;
    }
    onChange(
      selectedValues.includes(optionValue)
        ? selectedValues.filter((item) => item !== optionValue)
        : [...selectedValues, optionValue],
    );
  };

  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <button
            type="button"
            key={`${option.value}:${option.label}`}
            onClick={() => toggleOption(option.value)}
            className="group flex cursor-pointer flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                "h-10 w-10 rounded-full",
                selected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "ring-1 ring-border group-hover:ring-muted-foreground/50",
              )}
              style={{ backgroundColor: option.color || option.value }}
            />
            <span
              className={cn(
                "max-w-20 truncate text-[10px]",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SliderQuestion({
  question,
  value,
  onChange,
}: {
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const min = question.min ?? 0;
  const max = question.max ?? 100;
  const step = question.step ?? 1;
  const current =
    typeof value === "number" ? value : Math.round((min + max) / 2);

  return (
    <div className="flex items-center gap-4">
      <span className="w-8 text-xs text-muted-foreground">{min}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-8 text-end text-xs text-muted-foreground">{max}</span>
      <span className="min-w-10 text-end text-sm font-medium tabular-nums text-foreground">
        {current}
      </span>
    </div>
  );
}

function FileDropZone({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const files: File[] = Array.isArray(value) ? (value as File[]) : [];

  const addFiles = (incoming: File[]) => onChange([...files, ...incoming]);
  const removeFile = (index: number) =>
    onChange(files.filter((_, fileIndex) => fileIndex !== index));

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-5 transition-colors",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-muted-foreground/50",
        )}
      >
        <IconUpload className="mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drag files here or{" "}
          <label className="cursor-pointer text-primary hover:underline">
            browse
            <input
              type="file"
              multiple
              onChange={(event) => {
                if (event.target.files)
                  addFiles(Array.from(event.target.files));
                event.currentTarget.value = "";
              }}
              className="hidden"
            />
          </label>
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((file, index) => (
            <div
              key={`${file.name}:${index}`}
              className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
            >
              <IconCheck className="h-3 w-3 text-primary" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="cursor-pointer text-muted-foreground/70 hover:text-foreground"
                aria-label={`Remove ${file.name}`}
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SAFE_BROWSER_TAB_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;

function normalizeBrowserTabId(browserTabId?: string): string | undefined {
  if (typeof browserTabId !== "string") return undefined;
  const trimmed = browserTabId.trim();
  return SAFE_BROWSER_TAB_ID_RE.test(trimmed) ? trimmed : undefined;
}

export interface UseGuidedQuestionFlowOptions {
  stateKey?: string;
  /**
   * The current browser tab id. Agent actions that write the guided-questions
   * payload scope the application-state key per tab (`<key>:<tabId>`), so the
   * client must read the scoped key first and fall back to the bare key. Without
   * this, the question card never renders when the agent run carries a tab id
   * (which it almost always does — see `sessionBrowserTabId`).
   */
  browserTabId?: string;
  queryKey?: readonly unknown[];
  refetchInterval?: number | false;
  submitMessage?: string;
  skipMessage?: string;
  buildSubmitContext?: (args: {
    answers: GuidedQuestionAnswers;
    formattedAnswers: string;
  }) => string;
  buildSkipContext?: () => string;
}

export function useGuidedQuestionFlow({
  stateKey = "show-questions",
  browserTabId,
  queryKey = ["show-questions"],
  refetchInterval = 2_000,
  submitMessage = "Here are my answers — go ahead.",
  skipMessage = "Skip the questions — decide for me.",
  buildSubmitContext,
  buildSkipContext,
}: UseGuidedQuestionFlowOptions = {}) {
  const queryClient = useQueryClient();
  const [payload, setPayload] = useState<GuidedQuestionPayload | null>(null);
  const normalizedBrowserTabId = useMemo(
    () => normalizeBrowserTabId(browserTabId),
    [browserTabId],
  );
  const endpointFor = useCallback(
    (key: string) => agentNativePath(`/_agent-native/application-state/${key}`),
    [],
  );
  const scopedKey = normalizedBrowserTabId
    ? `${stateKey}:${normalizedBrowserTabId}`
    : stateKey;
  // Match the queryKey to the scope so two tabs polling different scoped keys
  // don't share a cache entry.
  const resolvedQueryKey = useMemo(
    () => [...queryKey, normalizedBrowserTabId ?? "global"],
    [queryKey, normalizedBrowserTabId],
  );

  const resolvedRefetchInterval =
    refetchInterval === false
      ? false
      : (query: { state: { data?: GuidedQuestionPayload | null } }) => {
          const activeQuestions = query.state.data?.questions;
          if (Array.isArray(activeQuestions) && activeQuestions.length > 0) {
            return false;
          }
          return refetchInterval;
        };

  const { data } = useQuery({
    queryKey: resolvedQueryKey,
    queryFn: async () => {
      const read = async (key: string) => {
        const res = await fetch(endpointFor(key));
        if (!res.ok) return null;
        const text = await res.text();
        if (!text) return null;
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed?.questions) && parsed.questions.length > 0) {
            return parsed as GuidedQuestionPayload;
          }
        } catch {
          return null;
        }
        return null;
      };
      // Agent writes are tab-scoped; read the scoped key first, then fall back
      // to the bare key (e.g. a deterministic write that omits the tab id).
      return (
        (normalizedBrowserTabId ? await read(scopedKey) : null) ??
        (await read(stateKey))
      );
    },
    refetchInterval: resolvedRefetchInterval,
    structuralSharing: false,
  });

  useEffect(() => {
    if (Array.isArray(data?.questions) && data.questions.length > 0) {
      setPayload((prev) => {
        if (
          prev &&
          guidedQuestionsFingerprint(prev.questions) ===
            guidedQuestionsFingerprint(data.questions)
        ) {
          return prev;
        }
        return data;
      });
    } else {
      setPayload(null);
    }
  }, [data]);

  const clear = useCallback(() => {
    setPayload(null);
    queryClient.setQueryData(resolvedQueryKey, null);
    const del = (key: string) =>
      fetch(endpointFor(key), {
        method: "DELETE",
        headers: { "X-Agent-Native-CSRF": "1" },
      }).catch(() => {});
    // Clear whichever key actually held the payload (scoped or bare) so the
    // card doesn't reappear on the next poll.
    del(scopedKey);
    if (scopedKey !== stateKey) del(stateKey);
  }, [endpointFor, queryClient, resolvedQueryKey, scopedKey, stateKey]);

  const handleSubmit = useCallback(
    (answers: GuidedQuestionAnswers) => {
      // Client-initiated question (askUserQuestion): resolve the caller's
      // promise with the answer instead of forwarding it to the agent chat.
      const resolveId = payload?.clientResolveId;
      if (resolveId) {
        const firstId = payload?.questions?.[0]?.id ?? "q1";
        resolveClientQuestion(resolveId, extractSingleAnswer(answers, firstId));
        clear();
        return;
      }
      const formattedAnswers = formatGuidedAnswersForAgent(answers);
      const resolvedSubmitMessage = payload?.submitMessage ?? submitMessage;
      const context =
        buildSubmitContext?.({ answers, formattedAnswers }) ??
        defaultGuidedSubmitContext(formattedAnswers);
      sendToAgentChat({
        message: resolvedSubmitMessage,
        context,
        submit: true,
      });
      clear();
    },
    [buildSubmitContext, clear, payload, submitMessage],
  );

  const handleSkip = useCallback(() => {
    const resolveId = payload?.clientResolveId;
    if (resolveId) {
      resolveClientQuestion(resolveId, null);
      clear();
      return;
    }
    sendToAgentChat({
      message: payload?.skipMessage ?? skipMessage,
      context: buildSkipContext?.(),
      submit: true,
    });
    clear();
  }, [buildSkipContext, clear, payload, skipMessage]);

  return {
    payload,
    questions: payload?.questions ?? null,
    title: payload?.title,
    description: payload?.description,
    skipLabel: payload?.skipLabel,
    submitLabel: payload?.submitLabel,
    clear,
    handleSubmit,
    handleSkip,
  };
}
