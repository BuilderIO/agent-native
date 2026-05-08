import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconCheck,
  IconChevronRight,
  IconHelpCircle,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { agentNativePath } from "./api-path.js";
import { sendToAgentChat } from "./agent-chat.js";
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
}

export interface GuidedQuestion {
  id: string;
  type: GuidedQuestionType;
  question: string;
  description?: string;
  options?: GuidedQuestionOption[];
  multiSelect?: boolean;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
  includeExplore?: boolean;
  includeDecide?: boolean;
}

export type GuidedQuestionAnswers = Record<string, unknown>;

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

function optionKey(option: GuidedQuestionOption): string {
  return `${option.value.toLowerCase()}::${option.label.toLowerCase()}`;
}

function withDefaultOptions(question: GuidedQuestion): GuidedQuestionOption[] {
  const base = question.options ?? [];
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
  title = "A few choices before I generate",
  description = "Pick what you know. Use Other for anything that does not fit, or let the agent decide.",
  skipLabel = "Skip",
  submitLabel = "Continue",
  className,
}: GuidedQuestionFlowProps) {
  const [answers, setAnswers] = useState<GuidedQuestionAnswers>({});

  useEffect(() => {
    setAnswers({});
  }, [questions]);

  const setAnswer = useCallback((id: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const allRequiredAnswered = questions
    .filter((question) => question.required)
    .every((question) => hasGuidedAnswer(answers[question.id]));

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center bg-background text-foreground",
        className,
      )}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-6 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-primary">
            <IconHelpCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-normal text-foreground sm:text-2xl">
              {title}
            </h2>
            {description && (
              <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              index={index}
              question={question}
              value={answers[question.id]}
              onChange={(value) => setAnswer(question.id, value)}
            />
          ))}
        </div>

        <div className="mt-5 flex shrink-0 items-center justify-between gap-4 border-t border-border pt-4">
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
              onClick={() => onSubmit(normalizeGuidedAnswers(answers))}
              disabled={!allRequiredAnswered}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitLabel}
              <IconChevronRight className="h-4 w-4" />
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
}: {
  index: number;
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card/65 p-4 shadow-sm">
      <div className="mb-3 flex gap-3">
        <div className="flex h-6 min-w-6 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
          {index + 1}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium leading-5 text-foreground">
            {question.question}
            {question.required && (
              <span className="ml-1 text-destructive">*</span>
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
        <TextOptions question={question} value={value} onChange={onChange} />
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
}: {
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
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
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
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
      className={cn(
        "group flex min-h-[56px] cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-muted/30 text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/45 hover:text-foreground",
      )}
    >
      {multiSelect && (
        <span
          className={cn(
            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
            selected ? "border-primary bg-primary text-primary-foreground" : "",
          )}
        >
          {selected && <IconCheck className="h-3 w-3" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-5">
          {option.label}
          {option.recommended && (
            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              Recommended
            </span>
          )}
        </span>
        {option.description && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {option.description}
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
  const options = question.options ?? [];
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
      <span className="w-8 text-right text-xs text-muted-foreground">
        {max}
      </span>
      <span className="min-w-10 text-right text-sm font-medium tabular-nums text-foreground">
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
                if (event.target.files) addFiles(Array.from(event.target.files));
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

export interface UseGuidedQuestionFlowOptions {
  stateKey?: string;
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
  queryKey = ["show-questions"],
  refetchInterval = 2_000,
  submitMessage = "Here are my answers — go ahead.",
  skipMessage = "Skip the questions — decide for me.",
  buildSubmitContext,
  buildSkipContext,
}: UseGuidedQuestionFlowOptions = {}) {
  const queryClient = useQueryClient();
  const [questions, setQuestions] = useState<GuidedQuestion[] | null>(null);
  const endpoint = agentNativePath(`/_agent-native/application-state/${stateKey}`);

  const { data } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch(endpoint);
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed?.questions) && parsed.questions.length > 0) {
          return { ...parsed, _ts: Date.now() };
        }
      } catch {
        return null;
      }
      return null;
    },
    refetchInterval,
    structuralSharing: false,
  });

  useEffect(() => {
    if (Array.isArray(data?.questions) && data.questions.length > 0) {
      setQuestions(data.questions);
    } else {
      setQuestions(null);
    }
  }, [data]);

  const clear = useCallback(() => {
    setQuestions(null);
    queryClient.setQueryData(queryKey, null);
    fetch(endpoint, {
      method: "DELETE",
      headers: { "X-Agent-Native-CSRF": "1" },
    }).catch(() => {});
  }, [endpoint, queryClient, queryKey]);

  const handleSubmit = useCallback(
    (answers: GuidedQuestionAnswers) => {
      const formattedAnswers = formatGuidedAnswersForAgent(answers);
      const context =
        buildSubmitContext?.({ answers, formattedAnswers }) ??
        [
          "The user answered the pre-generation questions.",
          "",
          "Answers:",
          formattedAnswers,
        ].join("\n");
      sendToAgentChat({ message: submitMessage, context, submit: true });
      clear();
    },
    [buildSubmitContext, clear, submitMessage],
  );

  const handleSkip = useCallback(() => {
    sendToAgentChat({
      message: skipMessage,
      context: buildSkipContext?.(),
      submit: true,
    });
    clear();
  }, [buildSkipContext, clear, skipMessage]);

  return { questions, clear, handleSubmit, handleSkip };
}
