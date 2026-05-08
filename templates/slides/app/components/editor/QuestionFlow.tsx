import { useMemo } from "react";
import {
  GuidedQuestionFlow,
  type GuidedQuestion,
} from "@agent-native/core/client";
import type { DesignSystemData, QuestionFlowQuestion } from "@shared/api";

interface QuestionFlowProps {
  questions: QuestionFlowQuestion[];
  onSubmit: (answers: Record<string, any>) => void;
  onSkip: () => void;
  designSystem?: DesignSystemData;
  title?: string;
  description?: string;
  skipLabel?: string;
  submitLabel?: string;
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

export function QuestionFlow({
  questions,
  onSubmit,
  onSkip,
  designSystem,
  title,
  description,
  skipLabel,
  submitLabel,
}: QuestionFlowProps) {
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

  return (
    <div className="absolute inset-0 z-50 bg-background">
      <GuidedQuestionFlow
        questions={visibleQuestions as GuidedQuestion[]}
        onSubmit={onSubmit}
        onSkip={onSkip}
        title={title ?? "Shape the deck first"}
        description={
          description ??
          "Answer the choices that matter. Use Other for a custom direction, or let the agent decide."
        }
        skipLabel={skipLabel}
        submitLabel={submitLabel}
      />
    </div>
  );
}
