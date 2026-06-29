import {
  getOtherGuidedAnswerText,
  hasGuidedAnswer,
  isOtherGuidedAnswer,
  makeOtherGuidedAnswer,
  normalizeGuidedAnswers,
  useT,
  type GuidedQuestion,
  type GuidedQuestionOption,
} from "@agent-native/core/client";
import type { QuestionFlowQuestion } from "@shared/api";
import {
  IconCheck,
  IconChevronRight,
  IconPalette,
  IconSparkles,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface QuestionFlowProps {
  questions: QuestionFlowQuestion[];
  onSubmit: (answers: Record<string, any>) => void;
  onSkip: () => void;
  title?: string;
  description?: string;
  skipLabel?: string;
  submitLabel?: string;
}

export function QuestionFlow({
  questions,
  onSubmit,
  onSkip,
  title,
  description,
  skipLabel,
  submitLabel,
}: QuestionFlowProps) {
  const t = useT();
  const guidedQuestions = questions as GuidedQuestion[];
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const questionsFingerprint = useMemo(
    () => questionFlowFingerprint(guidedQuestions),
    [guidedQuestions],
  );

  useEffect(() => {
    setAnswers({});
  }, [questionsFingerprint]);

  const setAnswer = useCallback((id: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const answeredCount = guidedQuestions.filter((question) =>
    hasGuidedAnswer(answers[question.id]),
  ).length;
  const requiredQuestions = guidedQuestions.filter(
    (question) => question.required,
  );
  const requiredAnswered = requiredQuestions.filter((question) =>
    hasGuidedAnswer(answers[question.id]),
  ).length;
  const allRequiredAnswered = requiredAnswered === requiredQuestions.length;
  const progress =
    guidedQuestions.length === 0
      ? 0
      : Math.round((answeredCount / guidedQuestions.length) * 100);

  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-4 py-5 text-foreground sm:px-8 sm:py-8">
      <div className="grid h-full max-h-[820px] w-full max-w-6xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-muted/25 p-4 lg:border-b-0 lg:border-e lg:p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm">
              <IconSparkles className="size-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-normal text-foreground">
                {title ?? t("questionFlow.defaultTitle")}
              </h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                {description ?? t("questionFlow.defaultDescription")}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("questionFlow.answeredCount", {
                  answered: answeredCount,
                  total: guidedQuestions.length,
                })}
              </span>
              {requiredQuestions.length > 0 && (
                <span>
                  {t("questionFlow.requiredCount", {
                    answered: requiredAnswered,
                    total: requiredQuestions.length,
                  })}
                </span>
              )}
            </div>
            <Progress value={progress} className="h-1.5 bg-muted" />
          </div>

          <ol className="mt-5 hidden min-h-0 flex-1 overflow-y-auto pe-1 lg:block">
            {guidedQuestions.map((question, index) => {
              const answered = hasGuidedAnswer(answers[question.id]);
              return (
                <li
                  key={question.id}
                  className={cn(
                    "mb-2 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs",
                    answered
                      ? "border-primary/25 bg-primary/5 text-foreground"
                      : "border-transparent bg-background/45 text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                      answered
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {answered ? <IconCheck className="size-3" /> : index + 1}
                  </span>
                  <span className="line-clamp-2">
                    {question.header ?? question.question}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 hidden rounded-md border border-border bg-background/60 p-3 text-xs leading-5 text-muted-foreground lg:block">
            {t("questionFlow.multiSelectHelp")}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            <div className="grid gap-3 xl:grid-cols-2">
              {guidedQuestions.map((question, index) => (
                <QuestionCard
                  key={question.id}
                  index={index}
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) => setAnswer(question.id, value)}
                />
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-background/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="text-xs text-muted-foreground">
              {allRequiredAnswered
                ? t("questionFlow.ready")
                : t("questionFlow.answerRequired")}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSkip}
                className="cursor-pointer"
              >
                {skipLabel ?? t("questionFlow.skip")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => onSubmit(normalizeGuidedAnswers(answers))}
                disabled={!allRequiredAnswered}
                className="cursor-pointer"
              >
                {submitLabel ?? t("questionFlow.continue")}
                <IconChevronRight className="size-4 rtl:-scale-x-100" />
              </Button>
            </div>
          </div>
        </main>
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
  const t = useT();
  const answered = hasGuidedAnswer(value);
  const guidance = question.multiSelect
    ? t("questionFlow.chooseAny")
    : t("questionFlow.chooseOne");

  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border bg-background p-4 shadow-sm transition-colors",
        answered ? "border-primary/35" : "border-border",
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-medium",
            answered
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted text-muted-foreground",
          )}
        >
          {answered ? <IconCheck className="size-4" /> : index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {question.header && (
              <p className="text-[11px] font-medium uppercase text-muted-foreground">
                {question.header}
              </p>
            )}
            <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {guidance}
            </span>
            {question.required && (
              <span className="rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                {t("questionFlow.required")}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold leading-5 text-foreground">
            {question.question}
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
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            question.placeholder ?? t("questionFlow.textPlaceholder")
          }
          className="min-h-[92px] resize-none bg-muted/35 text-sm"
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
  const t = useT();
  const options = useMemo(() => withDefaultOptions(question, t), [question, t]);
  const multiSelect = question.multiSelect === true;
  const selectedValues = Array.isArray(value) ? value : [];
  const otherSelected = multiSelect
    ? selectedValues.some(isOtherGuidedAnswer)
    : isOtherGuidedAnswer(value);
  const otherText = multiSelect
    ? getOtherGuidedAnswerText(selectedValues.find(isOtherGuidedAnswer))
    : getOtherGuidedAnswerText(value);
  const allowOther = question.allowOther !== false;
  const selectedCount = multiSelect
    ? selectedValues.filter((item) => hasGuidedAnswer(item)).length
    : hasGuidedAnswer(value)
      ? 1
      : 0;
  const compact = options.every(
    (option) =>
      // i18n-ignore scanner false positive
      !option.description && !option.preview && option.label.length <= 24, // i18n-ignore scanner false positive
  );

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

  return (
    <div className="space-y-3">
      {multiSelect && (
        <p className="text-[11px] leading-4 text-muted-foreground">
          {selectedCount > 0
            ? t("questionFlow.selectedCount", { count: selectedCount })
            : t("questionFlow.selectUseful")}
        </p>
      )}
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2",
        )}
      >
        {options.map((option) => (
          <OptionButton
            key={`${option.value}:${option.label}`}
            option={option}
            selected={isSelected(option.value)}
            compact={compact}
            multiSelect={multiSelect}
            onClick={() => toggleOption(option.value)}
          />
        ))}
        {allowOther && (
          <OptionButton
            option={{
              label: t("questionFlow.other"),
              value: "__other__",
              description: compact
                ? undefined
                : t("questionFlow.otherDescription"),
            }}
            selected={otherSelected}
            compact={compact}
            multiSelect={multiSelect}
            onClick={toggleOther}
          />
        )}
      </div>
      {allowOther && otherSelected && (
        <Textarea
          autoFocus
          value={otherText}
          onChange={(event) => setOtherText(event.target.value)}
          placeholder={
            question.placeholder ?? t("questionFlow.customPlaceholder")
          }
          className="min-h-[72px] resize-none bg-muted/35 text-sm"
        />
      )}
    </div>
  );
}

function OptionButton({
  option,
  selected,
  compact,
  multiSelect,
  onClick,
}: {
  option: GuidedQuestionOption;
  selected: boolean;
  compact: boolean;
  multiSelect?: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group flex min-w-0 cursor-pointer items-start gap-2 rounded-md border text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        compact ? "min-h-10 px-2.5 py-2" : "min-h-[68px] px-3 py-2.5",
        selected
          ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary/25"
          : "border-border bg-muted/25 text-muted-foreground hover:border-muted-foreground/45 hover:bg-muted/45 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
          multiSelect ? "rounded-sm" : "rounded-full",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background",
        )}
        aria-hidden
      >
        {selected && <IconCheck className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium leading-5">
          <span className="truncate">{option.label}</span>
          {option.recommended && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
              {t("questionFlow.recommended")}
            </span>
          )}
        </span>
        {option.description && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {option.description}
          </span>
        )}
        {option.preview && (
          <span className="mt-2 block max-h-36 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
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
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <button
            type="button"
            key={`${option.value}:${option.label}`}
            onClick={() => toggleOption(option.value)}
            aria-pressed={selected}
            className={cn(
              "group flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-muted/25 hover:border-muted-foreground/45 hover:bg-muted/45",
            )}
          >
            <span
              className={cn(
                "size-7 shrink-0 rounded-full border border-border",
                selected &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: option.color || option.value }}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
              {option.label}
            </span>
            {selected && (
              <IconPalette className="size-3.5 shrink-0 text-primary" />
            )}
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

  useEffect(() => {
    if (typeof value !== "number") {
      onChange(Math.round((min + max) / 2));
    }
  }, []);

  return (
    <div className="rounded-md border border-border bg-muted/25 px-3 py-3">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{min}</span>
        <span className="rounded-full bg-background px-2 py-0.5 font-medium tabular-nums text-foreground">
          {current}
        </span>
        <span>{max}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[current]}
        onValueChange={(next) => onChange(next[0] ?? current)}
      />
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
  const t = useT();
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
            : "border-border bg-muted/25 hover:border-muted-foreground/50",
        )}
      >
        <IconUpload className="mb-2 size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("questionFlow.dragFiles")}{" "}
          <label className="cursor-pointer text-primary hover:underline">
            {t("questionFlow.browse")}
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
              <IconCheck className="size-3 text-primary" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="cursor-pointer text-muted-foreground/70 hover:text-foreground"
                aria-label={t("questionFlow.removeFile", { name: file.name })}
              >
                <IconX className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function optionKey(option: GuidedQuestionOption): string {
  return `${option.value.toLowerCase()}::${option.label.toLowerCase()}`;
}

function questionFlowFingerprint(questions: GuidedQuestion[]): string {
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

function withDefaultOptions(
  question: GuidedQuestion,
  t: (key: string, options?: Record<string, unknown>) => string,
): GuidedQuestionOption[] {
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
  maybePush(
    {
      label: t("questionFlow.exploreLabel"),
      value: "__explore__",
      description: t("questionFlow.exploreDescription"),
    },
    question.includeExplore !== false,
  );
  maybePush(
    {
      label: t("questionFlow.decideLabel"),
      value: "__decide__",
      description: t("questionFlow.decideDescription"),
    },
    question.includeDecide !== false,
  );
  return result;
}
