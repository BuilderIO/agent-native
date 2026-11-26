import {
  IconHelpCircle,
  IconPaperclip,
  IconPencil,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { ActionButton, IconButton } from "../../../agentkit.js";
import { useAgentKitLabels } from "./context.js";

const SESSION_REPLAY_MASK_PROPS = { "data-an-mask": "" } as const;
/** Matches the composer toolbar's controls. */
const QUESTION_CONTROL_CLASS =
  "h-6 rounded-[var(--agent-kit-radius-xs,0.25rem)] px-2 text-xs";

export interface AgentKitQuestionOption {
  value: string;
  label: string;
  recommended?: boolean;
  /** A CSS color for a swatch before the label. */
  color?: string;
}

export interface AgentKitQuestion {
  id: string;
  question: string;
  description?: string;
  /** None, with no `range` or `files`, makes it a written-answer question. */
  options: readonly AgentKitQuestionOption[];
  /** Answered on a slider. */
  range?: { min: number; max: number; step: number; initial: number };
  /** Files the user chooses or drops on the card. */
  files?: boolean;
  multiSelect?: boolean;
  /** Offers the written response beside the options. On by default. */
  allowOther?: boolean;
  required?: boolean;
  /** Picking an option answers this question without pressing Next. */
  submitOnSelect?: boolean;
  placeholder?: string;
}

export interface AgentKitQuestionAnswer {
  values: string[];
  other?: string;
  files?: File[];
}

/** By question id; a skipped question has no entry. */
export type AgentKitQuestionAnswers = Record<string, AgentKitQuestionAnswer>;

export interface QuestionCardProps {
  questions: readonly AgentKitQuestion[];
  /** All answers at once, after the last question. */
  onSubmit: (answers: AgentKitQuestionAnswers) => void;
  /** Closing the card, or skipping every question. */
  onDismiss: () => void;
  title?: string;
  /** Shown under the title, for every question. */
  description?: string;
  /** The last step's send label, such as "Generate". */
  submitLabel?: string;
  skipLabel?: string;
  busy?: boolean;
  /** Locks the answers too. */
  disabled?: boolean;
  /** Answers can be picked, but nothing is sent or skipped. */
  submitBlocked?: boolean;
  /** Shown under the actions, such as a setup notice. */
  footer?: ReactNode;
  /** A control beside the written response, such as dictation. */
  renderResponseControl?: (control: {
    append: (text: string) => void;
    disabled: boolean;
  }) => ReactNode;
  className?: string;
}

function hasAnswer(answer: AgentKitQuestionAnswer | undefined): boolean {
  return Boolean(
    answer &&
    (answer.values.length > 0 ||
      answer.other?.trim() ||
      (answer.files?.length ?? 0) > 0),
  );
}

function recommendedFirst(
  options: readonly AgentKitQuestionOption[],
): AgentKitQuestionOption[] {
  return [
    ...options.filter((option) => option.recommended),
    ...options.filter((option) => !option.recommended),
  ];
}

/** Asks one question at a time and sends every answer in one message. */
export function QuestionCard({
  questions,
  onSubmit,
  onDismiss,
  title,
  description,
  submitLabel,
  skipLabel,
  busy = false,
  disabled = false,
  submitBlocked = false,
  footer,
  renderResponseControl,
  className,
}: QuestionCardProps) {
  const labels = useAgentKitLabels();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AgentKitQuestionAnswers>({});
  const rootRef = useRef<HTMLElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const otherRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseFilesRef = useRef<HTMLButtonElement>(null);
  const focusStepRef = useRef(false);
  const titleId = useId();
  const questionId = useId();
  const total = questions.length;
  const question = questions.at(Math.min(step, total - 1));

  // Only when the old step had focus, so a late reply doesn't steal it.
  useEffect(() => {
    if (!focusStepRef.current) return;
    focusStepRef.current = false;
    const selected = optionRefs.current.find(
      (button) => button?.getAttribute("aria-checked") === "true",
    );
    (
      selected ??
      optionRefs.current[0] ??
      rangeRef.current ??
      chooseFilesRef.current ??
      otherRef.current
    )?.focus();
  }, [step]);

  if (!question) return null;
  const options = recommendedFirst(question.options);
  const multiSelect = question.multiSelect === true;
  const range = question.range;
  // A slider's shown value is its answer, even untouched.
  const answer = answers[question.id] ?? {
    values: range ? [String(range.initial)] : [],
  };
  const showOther =
    (options.length === 0 && !range && !question.files) ||
    question.allowOther !== false;
  const last = step >= total - 1;
  const locked = busy || disabled;
  const sendLocked = locked || submitBlocked;
  const answered = hasAnswer(answer);

  const setAnswer = (next: AgentKitQuestionAnswer) =>
    setAnswers((current) => ({ ...current, [question.id]: next }));
  const choose = (value: string, { fromArrow = false } = {}) => {
    if (locked) return;
    if (!multiSelect) {
      // Single choice: an option and a written answer replace each other.
      const picked = { values: [value] };
      setAnswer(picked);
      // Arrows only move the choice; a click or a number key answers.
      if (question.submitOnSelect && !fromArrow && !(last && sendLocked)) {
        advance({ ...answers, [question.id]: picked });
      }
      return;
    }
    const values = answer.values.includes(value)
      ? answer.values.filter((item) => item !== value)
      : [...answer.values, value];
    setAnswer({ ...answer, values });
  };
  const write = (text: string) =>
    setAnswer(
      multiSelect ? { ...answer, other: text } : { values: [], other: text },
    );
  const append = (text: string) => {
    const added = text.trim();
    if (!added || locked) return;
    const current = answer.other?.trimEnd() ?? "";
    write(current ? `${current} ${added}` : added);
    otherRef.current?.focus();
  };
  const advance = (next: AgentKitQuestionAnswers) => {
    if (!last) {
      focusStepRef.current = Boolean(
        rootRef.current?.contains(document.activeElement),
      );
      setStep(step + 1);
      return;
    }
    const given = Object.fromEntries(
      Object.entries(next).filter(([, value]) => hasAnswer(value)),
    );
    if (Object.keys(given).length === 0) onDismiss();
    else onSubmit(given);
  };
  const next = () => {
    if (locked || !answered || (last && sendLocked)) return;
    advance({ ...answers, [question.id]: answer });
  };
  const addFiles = (incoming: File[]) => {
    if (locked || incoming.length === 0) return;
    setAnswer({ ...answer, files: [...(answer.files ?? []), ...incoming] });
  };
  const removeFile = (index: number) =>
    setAnswer({
      ...answer,
      files: (answer.files ?? []).filter((_, item) => item !== index),
    });
  const skip = () => {
    if (locked || question.required || (last && sendLocked)) return;
    const rest = Object.fromEntries(
      Object.entries(answers).filter(([id]) => id !== question.id),
    );
    setAnswers(rest);
    advance(rest);
  };
  const onOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const delta =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const target = (index + delta + options.length) % options.length;
    optionRefs.current[target]?.focus();
    // Arrows move the choice in a radio group, not only the focus.
    const option = options.at(target);
    if (!multiSelect && option) choose(option.value, { fromArrow: true });
  };
  const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }
    if (!/^[1-9]$/.test(event.key)) return;
    const index = Number(event.key) - 1;
    const option = options.at(index);
    if (!option) return;
    event.preventDefault();
    choose(option.value);
    optionRefs.current[index]?.focus();
  };
  const tabStop = multiSelect
    ? -1
    : Math.max(
        0,
        options.findIndex((option) => answer.values.includes(option.value)),
      );

  return (
    <section
      ref={rootRef}
      className={["agentkit-question", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-step={step + 1}
      data-total={total}
      onKeyDown={onCardKeyDown}
      {...(question.files
        ? {
            onDragOver: (event: DragEvent<HTMLElement>) =>
              event.preventDefault(),
            onDrop: (event: DragEvent<HTMLElement>) => {
              event.preventDefault();
              addFiles(Array.from(event.dataTransfer.files));
            },
          }
        : {})}
    >
      <header className="agentkit-question-header">
        <IconHelpCircle aria-hidden="true" className="agentkit-icon" />
        <h2 id={titleId} className="agentkit-question-title">
          {title ?? labels.question}
          {total > 1 ? (
            <span className="agentkit-visually-hidden">
              {` ${labels.questionProgressLabel
                .replace("{{current}}", () => String(step + 1))
                .replace("{{total}}", () => String(total))}`}
            </span>
          ) : null}
        </h2>
        {total > 1 ? (
          <span className="agentkit-question-progress" aria-hidden="true">
            {labels.questionProgress
              .replace("{{current}}", () => String(step + 1))
              .replace("{{total}}", () => String(total))}
          </span>
        ) : null}
        <IconButton
          size="compact"
          intent="neutral"
          emphasis="ghost"
          label={labels.questionDismiss}
          disabled={busy || submitBlocked}
          className="agentkit-question-dismiss size-6 rounded-[var(--agent-kit-radius-xs,0.25rem)] text-muted-foreground"
          icon={<IconX aria-hidden="true" className="size-3.5" />}
          onPress={onDismiss}
        />
      </header>
      {description ? (
        <p
          {...SESSION_REPLAY_MASK_PROPS}
          className="agentkit-question-description"
        >
          {description}
        </p>
      ) : null}
      <p
        {...SESSION_REPLAY_MASK_PROPS}
        id={questionId}
        className="agentkit-question-text"
      >
        {question.question}
      </p>
      {question.description ? (
        <p
          {...SESSION_REPLAY_MASK_PROPS}
          className="agentkit-question-description"
        >
          {question.description}
        </p>
      ) : null}
      {options.length ? (
        <div
          {...SESSION_REPLAY_MASK_PROPS}
          className="agentkit-question-options"
          role={multiSelect ? "group" : "radiogroup"}
          aria-labelledby={questionId}
        >
          {options.map((option, index) => {
            const selected = answer.values.includes(option.value);
            return (
              <button
                key={`${question.id}:${option.value}`}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role={multiSelect ? "checkbox" : "radio"}
                aria-checked={selected}
                aria-disabled={locked || undefined}
                tabIndex={multiSelect || index === tabStop ? 0 : -1}
                className="agentkit-question-option"
                data-selected={selected ? "true" : "false"}
                onClick={() => choose(option.value)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                <span className="agentkit-question-key" aria-hidden="true">
                  {index + 1}
                </span>
                {option.color ? (
                  <span
                    className="agentkit-question-swatch"
                    aria-hidden="true"
                    // The agent's color is the content, so it is not a token.
                    style={{ background: option.color }}
                  />
                ) : null}
                <span className="agentkit-question-option-label">
                  {option.label}
                </span>
                {option.recommended ? (
                  <span className="agentkit-question-recommended">
                    {labels.questionRecommended}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {range ? (
        <div className="agentkit-question-range">
          <span aria-hidden="true">{range.min}</span>
          <input
            ref={rangeRef}
            type="range"
            min={range.min}
            max={range.max}
            step={range.step}
            value={answer.values[0] ?? String(range.initial)}
            disabled={locked}
            aria-labelledby={questionId}
            onChange={(event) => setAnswer({ values: [event.target.value] })}
          />
          <span aria-hidden="true">{range.max}</span>
          <output className="agentkit-question-range-value">
            {answer.values[0] ?? String(range.initial)}
          </output>
        </div>
      ) : null}
      {question.files ? (
        <div className="agentkit-question-files">
          <ActionButton
            size="compact"
            intent="neutral"
            emphasis="outline"
            className={QUESTION_CONTROL_CLASS}
            elementRef={chooseFilesRef}
            disabled={locked}
            leadingIcon={
              <IconPaperclip aria-hidden="true" className="size-3.5" />
            }
            onPress={() => fileInputRef.current?.click()}
          >
            {labels.questionChooseFiles}
          </ActionButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(event) => {
              if (event.target.files) addFiles(Array.from(event.target.files));
              event.currentTarget.value = "";
            }}
          />
          {(answer.files ?? []).map((file, index) => (
            <span
              key={`${file.name}:${index}`}
              {...SESSION_REPLAY_MASK_PROPS}
              className="agentkit-question-file"
            >
              <span className="agentkit-question-file-name">{file.name}</span>
              <button
                type="button"
                className="agentkit-question-file-remove"
                disabled={locked}
                aria-label={labels.questionRemoveFile.replace(
                  "{{name}}",
                  () => file.name,
                )}
                onClick={() => removeFile(index)}
              >
                <IconX aria-hidden="true" className="agentkit-icon" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="agentkit-question-footer">
        {showOther ? (
          <label className="agentkit-question-other">
            <IconPencil aria-hidden="true" className="agentkit-icon" />
            <input
              {...SESSION_REPLAY_MASK_PROPS}
              ref={otherRef}
              type="text"
              value={answer.other ?? ""}
              disabled={locked}
              placeholder={
                options.length
                  ? labels.questionOwnResponse
                  : (question.placeholder ?? labels.questionAnswer)
              }
              aria-label={
                options.length ? labels.questionOwnResponse : question.question
              }
              onChange={(event) => write(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                  return;
                }
                event.preventDefault();
                next();
              }}
            />
          </label>
        ) : (
          <span className="agentkit-question-spacer" />
        )}
        <div className="agentkit-question-actions">
          {showOther && renderResponseControl
            ? renderResponseControl({ append, disabled: locked })
            : null}
          <ActionButton
            size="compact"
            intent="neutral"
            emphasis="outline"
            className={QUESTION_CONTROL_CLASS}
            disabled={
              locked || question.required === true || (last && sendLocked)
            }
            onPress={skip}
          >
            {skipLabel ?? labels.questionSkip}
          </ActionButton>
          <ActionButton
            size="compact"
            intent="primary"
            emphasis="solid"
            className={QUESTION_CONTROL_CLASS}
            disabled={locked || !answered || (last && sendLocked)}
            pending={busy && last}
            onPress={next}
          >
            {last ? (submitLabel ?? labels.questionSend) : labels.questionNext}
          </ActionButton>
        </div>
      </div>
      {footer}
    </section>
  );
}
