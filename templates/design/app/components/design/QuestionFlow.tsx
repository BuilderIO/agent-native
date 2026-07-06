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
import { Button } from "@agent-native/toolkit/ui/button";
import { Slider } from "@agent-native/toolkit/ui/slider";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import type { QuestionFlowQuestion } from "@shared/api";
import { IconCheck, IconPalette, IconUpload, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

  const isAnswered = (q: GuidedQuestion) => {
    const v = answers[q.id];
    if (q.type === "freeform" && typeof v === "string")
      return v.trim().length > 0;
    return hasGuidedAnswer(v);
  };
  const answeredCount = guidedQuestions.filter(isAnswered).length;
  const requiredQuestions = guidedQuestions.filter(
    (question) => question.required,
  );
  const requiredAnswered = requiredQuestions.filter(isAnswered).length;
  const allRequiredAnswered = requiredAnswered === requiredQuestions.length;
  const progress =
    guidedQuestions.length === 0
      ? 0
      : Math.round((answeredCount / guidedQuestions.length) * 100);

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto bg-transparent px-5 py-8 text-[13px] text-foreground sm:px-8 lg:px-10">
      <main className="w-full max-w-[820px] pb-8">
        <div className="mb-6 border-b border-[var(--design-editor-panel-divider-color)] pb-5">
          <h2 className="text-[22px] font-semibold leading-7 tracking-normal text-foreground sm:text-2xl sm:leading-8">
            {title ?? t("questionFlow.defaultTitle")}
          </h2>
          {description ? (
            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        <div className="divide-y divide-[var(--design-editor-panel-divider-color)]">
          {guidedQuestions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              value={answers[question.id]}
              onChange={(value) => setAnswer(question.id, value)}
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-[var(--design-editor-panel-divider-color)] pt-4">
          <Button
            type="button"
            size="sm"
            onClick={() => onSubmit(normalizeGuidedAnswers(answers))}
            disabled={!allRequiredAnswered}
            className="h-8 cursor-pointer rounded-md bg-[var(--design-editor-accent-color)] px-3 text-[12px] text-[var(--design-editor-accent-contrast-color)] shadow-none hover:bg-[var(--design-editor-accent-hover-color)] hover:text-[var(--design-editor-accent-contrast-color)] focus-visible:ring-[var(--design-editor-accent-color)]"
          >
            {submitLabel ?? t("questionFlow.continue")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSkip}
            className="h-8 cursor-pointer rounded-md px-3 text-[12px] text-muted-foreground hover:bg-[var(--design-editor-layer-hover-color)] hover:text-foreground"
          >
            {skipLabel ?? t("questionFlow.skip")}
          </Button>
        </div>
      </main>
    </div>
  );
}

function QuestionCard({
  question,
  value,
  onChange,
}: {
  question: GuidedQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = useT();

  return (
    <section className="min-w-0 py-5 first:pt-0 last:pb-0">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold leading-5 text-foreground">
          {question.question}
        </h3>
        {question.description && (
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
            {question.description}
          </p>
        )}
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
          className="min-h-[88px] resize-none rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[12px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
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
      !option.preview && option.label.length <= 32, // i18n-ignore scanner false positive
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
        <p className="sr-only">
          {selectedCount > 0
            ? t("questionFlow.selectedCount", { count: selectedCount })
            : t("questionFlow.selectUseful")}
        </p>
      )}
      <div
        className={cn(
          "flex flex-wrap gap-2",
          compact ? "max-w-3xl" : "max-w-4xl",
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
          className="min-h-[72px] max-w-xl resize-none rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[12px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
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
        "group inline-flex min-h-8 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md border text-start transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0",
        compact ? "px-2.5 py-1.5" : "px-3 py-2",
        selected
          ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)] text-foreground"
          : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-foreground hover:bg-[var(--design-editor-panel-raised-bg)]",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center border",
          multiSelect ? "rounded-[3px]" : "rounded-full",
          selected
            ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] text-[var(--design-editor-accent-contrast-color)]"
            : "border-muted-foreground/40 bg-[var(--design-editor-panel-bg)]",
        )}
        aria-hidden
      >
        {selected && <IconCheck className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] font-semibold leading-4">
          <span className="min-w-0 truncate">{option.label}</span>
          {option.recommended && (
            <span className="rounded bg-[var(--design-editor-panel-raised-bg)] px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none text-muted-foreground">
              {t("questionFlow.recommended")}
            </span>
          )}
        </span>
        {option.description && (
          <span className="sr-only">{option.description}</span>
        )}
        {option.preview && (
          <span className="mt-2 block max-h-36 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] px-2 py-1.5 font-mono !text-[11px] leading-4 text-muted-foreground">
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
    <div className="flex max-w-4xl flex-wrap gap-2">
      {options.map((option) => {
        const selected = isSelected(option.value);
        return (
          <button
            type="button"
            key={`${option.value}:${option.label}`}
            onClick={() => toggleOption(option.value)}
            aria-pressed={selected}
            className={cn(
              "group inline-flex min-h-8 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0",
              selected
                ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)] text-foreground"
                : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-foreground hover:bg-[var(--design-editor-panel-raised-bg)]",
            )}
          >
            <span
              className={cn(
                "size-5 shrink-0 rounded-full border border-[var(--design-editor-control-border)]",
                selected &&
                  "ring-1 ring-[var(--design-editor-accent-color)] ring-offset-1 ring-offset-[var(--design-editor-control-bg)]",
              )}
              style={{ backgroundColor: option.color || option.value }}
            />
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4">
              {option.label}
            </span>
            {selected && <IconPalette className="size-3.5 shrink-0" />}
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

  // Do not auto-fill on mount: a required slider must be explicitly moved by
  // the user before it counts as answered. `current` already provides a
  // display-only midpoint fallback for the rendered slider position.

  return (
    <div className="max-w-xl rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-3 py-3">
      <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{min}</span>
        <span className="font-medium tabular-nums text-foreground">
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
          "flex max-w-xl cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-5 transition-colors",
          dragOver
            ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)]"
            : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] hover:bg-[var(--design-editor-panel-raised-bg)]",
        )}
      >
        <IconUpload className="mb-2 size-5 text-muted-foreground" />
        <p className="text-[12px] text-muted-foreground">
          {t("questionFlow.dragFiles")}{" "}
          <label className="cursor-pointer text-[var(--design-editor-accent-color)] hover:underline">
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
              className="flex items-center gap-2 rounded-md bg-[var(--design-editor-control-bg)] px-2 py-1 text-[11px] text-muted-foreground"
            >
              <IconCheck className="size-3 text-[var(--design-editor-accent-color)]" />
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
