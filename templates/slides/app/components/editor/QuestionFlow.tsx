import { useState, useCallback, useMemo } from "react";
import {
  IconCheck,
  IconUpload,
  IconX,
  IconChevronRight,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DesignSystemData, QuestionFlowQuestion } from "@shared/api";

interface QuestionFlowProps {
  questions: QuestionFlowQuestion[];
  onSubmit: (answers: Record<string, any>) => void;
  onSkip: () => void;
  designSystem?: DesignSystemData;
}

export function QuestionFlow({
  questions,
  onSubmit,
  onSkip,
  designSystem,
}: QuestionFlowProps) {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const visibleQuestions = useMemo(
    () =>
      questions.map((question) =>
        question.type === "color-options" && designSystem
          ? {
              ...question,
              options: designSystemColorOptions(
                designSystem,
                question.options || [],
              ),
            }
          : question,
      ),
    [designSystem, questions],
  );

  const setAnswer = useCallback((id: string, value: any) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const toggleMultiSelect = useCallback(
    (id: string, value: string) => {
      const current: string[] = answers[id] || [];
      const next = current.includes(value)
        ? current.filter((v: string) => v !== value)
        : [...current, value];
      setAnswer(id, next);
    },
    [answers, setAnswer],
  );

  const handleSubmit = () => {
    onSubmit(answers);
  };

  const allRequiredAnswered = visibleQuestions
    .filter((q) => q.required)
    .every((q) => {
      const val = answers[q.id];
      if (val == null || val === "") return false;
      if (Array.isArray(val) && val.length === 0) return false;
      return true;
    });

  return (
    <div className="absolute inset-0 z-50 bg-background">
      <div className="h-full overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col">
          <h2 className="mb-6 text-2xl font-semibold text-foreground sm:mb-8">
          Before we begin...
          </h2>

          <div className="space-y-6 sm:space-y-8">
            {visibleQuestions.map((q) => (
            <QuestionRenderer
              key={q.id}
              question={q}
              value={answers[q.id]}
              onChange={(val) => setAnswer(q.id, val)}
              onToggleMulti={(val) => toggleMultiSelect(q.id, val)}
            />
            ))}
          </div>

          {/* Progress dots */}
          <div className="mt-8 flex items-center justify-center gap-1.5">
            {visibleQuestions.map((q, i) => {
            const answered = answers[q.id] != null && answers[q.id] !== "";
            return (
              <div
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  answered ? "bg-[#609FF8]" : "bg-muted",
                )}
              />
            );
            })}
          </div>

          {/* Actions */}
          <div className="sticky bottom-0 -mx-4 mt-8 flex items-center justify-between border-t border-border bg-background/95 px-4 py-4 backdrop-blur sm:-mx-8 sm:px-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={onSkip}
              className="text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!allRequiredAnswered}
              className="gap-2"
            >
              Continue
              <IconChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const DESIGN_SYSTEM_COLOR_KEYS: Array<
  [keyof DesignSystemData["colors"], string]
> = [
  ["primary", "Primary"],
  ["secondary", "Secondary"],
  ["accent", "Accent"],
  ["background", "Background"],
  ["surface", "Surface"],
];

function isUsableColor(value: string | undefined): value is string {
  if (!value) return false;
  const color = value.trim();
  return (
    /^#[0-9a-f]{3,8}$/i.test(color) ||
    /^rgba?\(/i.test(color) ||
    /^hsla?\(/i.test(color)
  );
}

function designSystemColorOptions(
  designSystem: DesignSystemData,
  fallback: NonNullable<QuestionFlowQuestion["options"]>,
): NonNullable<QuestionFlowQuestion["options"]> {
  const seen = new Set<string>();
  const options = DESIGN_SYSTEM_COLOR_KEYS.flatMap(([key, label]) => {
    const color = designSystem.colors[key]?.trim();
    const normalized = color?.toLowerCase();
    if (!isUsableColor(color) || !normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [{ label, value: color, color }];
  });

  return options.length >= 2 ? options : fallback;
}

function QuestionRenderer({
  question,
  value,
  onChange,
  onToggleMulti,
}: {
  question: QuestionFlowQuestion;
  value: any;
  onChange: (val: any) => void;
  onToggleMulti: (val: string) => void;
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium text-foreground">
        {question.question}
        {question.required && <span className="ml-1 text-red-400">*</span>}
      </h3>
      {question.description && (
        <p className="mb-3 text-xs text-muted-foreground">
          {question.description}
        </p>
      )}

      {question.type === "text-options" && (
        <TextOptions
          options={question.options || []}
          multiSelect={question.multiSelect}
          value={value}
          onChange={onChange}
          onToggleMulti={onToggleMulti}
        />
      )}
      {question.type === "color-options" && (
        <ColorOptions
          options={question.options || []}
          multiSelect={question.multiSelect}
          value={value}
          onChange={onChange}
          onToggleMulti={onToggleMulti}
        />
      )}
      {question.type === "slider" && (
        <SliderQuestion
          min={question.min ?? 0}
          max={question.max ?? 100}
          value={value}
          onChange={onChange}
        />
      )}
      {question.type === "file" && (
        <FileDropZone value={value} onChange={onChange} />
      )}
      {question.type === "freeform" && (
        <Textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer..."
          className="min-h-[80px] resize-none border-border bg-muted text-foreground placeholder:text-muted-foreground/70"
        />
      )}
    </div>
  );
}

function TextOptions({
  options,
  multiSelect,
  value,
  onChange,
  onToggleMulti,
}: {
  options: NonNullable<QuestionFlowQuestion["options"]>;
  multiSelect?: boolean;
  value: any;
  onChange: (val: any) => void;
  onToggleMulti: (val: string) => void;
}) {
  const allOptions = [
    ...options,
    { label: "Explore a few options", value: "__explore__" },
    { label: "Decide for me", value: "__decide__" },
  ];

  const isSelected = (optValue: string) => {
    if (multiSelect) {
      return Array.isArray(value) && value.includes(optValue);
    }
    return value === optValue;
  };

  return (
    <div className="flex flex-wrap gap-2">
      {allOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            if (multiSelect) {
              onToggleMulti(opt.value);
            } else {
              onChange(opt.value);
            }
          }}
          className={cn(
            "cursor-pointer rounded-lg border px-4 py-2 text-sm",
            isSelected(opt.value)
              ? "border-[#609FF8] bg-[#609FF8]/10 text-[#609FF8]"
              : "border-border bg-muted text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          )}
        >
          {multiSelect && (
            <Checkbox
              checked={isSelected(opt.value)}
              className="mr-2 inline-flex"
              tabIndex={-1}
            />
          )}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ColorOptions({
  options,
  multiSelect,
  value,
  onChange,
  onToggleMulti,
}: {
  options: NonNullable<QuestionFlowQuestion["options"]>;
  multiSelect?: boolean;
  value: any;
  onChange: (val: any) => void;
  onToggleMulti: (val: string) => void;
}) {
  const isSelected = (optValue: string) => {
    if (multiSelect) {
      return Array.isArray(value) && value.includes(optValue);
    }
    return value === optValue;
  };

  return (
    <div className="flex flex-wrap gap-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => {
            if (multiSelect) {
              onToggleMulti(opt.value);
            } else {
              onChange(opt.value);
            }
          }}
          className="group flex cursor-pointer flex-col items-center gap-1.5"
        >
          <div
            className={cn(
              "h-10 w-10 rounded-full",
              isSelected(opt.value)
                ? "ring-2 ring-[#609FF8] ring-offset-2 ring-offset-background"
                : "ring-1 ring-border group-hover:ring-foreground/30",
            )}
            style={{ backgroundColor: opt.color || opt.value }}
          />
          <span
            className={cn(
              "text-[10px]",
              isSelected(opt.value)
                ? "text-foreground"
                : "text-muted-foreground",
            )}
          >
            {opt.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function SliderQuestion({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: any;
  onChange: (val: number) => void;
}) {
  const current =
    typeof value === "number" ? value : Math.round((min + max) / 2);

  return (
    <div className="flex items-center gap-4">
      <span className="text-xs text-muted-foreground">{min}</span>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[current]}
        onValueChange={([v]) => onChange(v)}
        className="flex-1"
      />
      <span className="text-xs text-muted-foreground">{max}</span>
      <span className="min-w-[2rem] text-right text-sm font-medium text-foreground">
        {current}
      </span>
    </div>
  );
}

function FileDropZone({
  value,
  onChange,
}: {
  value: any;
  onChange: (val: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const files: File[] = Array.isArray(value) ? value : [];

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    onChange([...files, ...dropped]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      onChange([...files, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6",
          dragOver
            ? "border-[#609FF8] bg-[#609FF8]/5"
            : "border-border bg-muted/50 hover:border-foreground/30",
        )}
      >
        <IconUpload className="mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drag files here or{" "}
          <label className="cursor-pointer text-[#609FF8] hover:underline">
            browse
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.pptx,.docx"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground/70">
          Images, PDFs, PPTX, DOCX
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              <IconCheck className="h-3 w-3 text-[#609FF8]" />
              <span className="flex-1 truncate">{file.name}</span>
              <button
                onClick={() => removeFile(i)}
                className="cursor-pointer text-muted-foreground/70 hover:text-foreground"
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
