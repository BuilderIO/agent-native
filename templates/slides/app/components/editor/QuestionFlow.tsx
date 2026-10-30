import { type AgentEngineConfiguredState } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  GuidedQuestionFlow,
  type GuidedQuestion,
} from "@agent-native/toolkit/app/chat/agentkit-chat";
import type { DesignSystemData, QuestionFlowQuestion } from "@shared/api";
import { useMemo } from "react";

interface QuestionFlowProps {
  questions: QuestionFlowQuestion[];
  onSubmit: (answers: Record<string, any>) => void;
  onSkip: () => void;
  designSystem?: DesignSystemData;
  title?: string;
  description?: string;
  skipLabel?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
  isSubmissionBlocked?: boolean;
  providerStatus?: AgentEngineConfiguredState;
  onRetryProviderStatus?: () => void;
}

const DESIGN_SYSTEM_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
] as const satisfies ReadonlyArray<keyof DesignSystemData["colors"]>;

type DesignSystemColorKey = (typeof DESIGN_SYSTEM_COLOR_KEYS)[number];

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
  colorLabels: Record<DesignSystemColorKey, string>,
): NonNullable<QuestionFlowQuestion["options"]> {
  const seen = new Set<string>();
  const options = DESIGN_SYSTEM_COLOR_KEYS.flatMap((key) => {
    const color = designSystem.colors[key]?.trim();
    const normalized = color?.toLowerCase();
    if (!isUsableColor(color) || !normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [{ label: colorLabels[key], value: color, color }];
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
  isSubmitting,
  isSubmissionBlocked,
  providerStatus,
  onRetryProviderStatus,
}: QuestionFlowProps) {
  const t = useT();
  const visibleQuestions = useMemo(() => {
    const colorLabels = {
      primary: t("styleInspector.primary"),
      secondary: t("styleInspector.secondary"),
      accent: t("styleInspector.accent"),
      background: t("styleInspector.background"),
      surface: t("styleInspector.surface"),
    };
    const submitSingleChoiceOnSelect =
      questions.length === 1 &&
      questions[0]?.type === "text-options" &&
      questions[0].multiSelect !== true;

    return questions.map((question) => {
      const withDefaultRows = {
        ...question,
        includeExplore: question.includeExplore ?? true,
        includeDecide: question.includeDecide ?? true,
      };
      const resolvedQuestion = submitSingleChoiceOnSelect
        ? { ...withDefaultRows, submitOnSelect: true }
        : withDefaultRows;
      return resolvedQuestion.type === "color-options" && designSystem
        ? {
            ...resolvedQuestion,
            options: designSystemColorOptions(
              designSystem,
              resolvedQuestion.options || [],
              colorLabels,
            ),
          }
        : resolvedQuestion;
    });
  }, [designSystem, questions, t]);

  return (
    <div className="slides-question-flow absolute inset-0 z-50 bg-transparent">
      <GuidedQuestionFlow
        questions={visibleQuestions as GuidedQuestion[]}
        onSubmit={onSubmit}
        onSkip={onSkip}
        className="bg-background/65 backdrop-blur-sm"
        title={title ?? t("deckEditor.questionFlowTitle")}
        description={description ?? t("deckEditor.questionFlowDescription")}
        skipLabel={skipLabel}
        submitLabel={submitLabel}
        isSubmitting={isSubmitting}
        isSubmissionBlocked={isSubmissionBlocked}
        providerStatus={providerStatus}
        onRetryProviderStatus={onRetryProviderStatus}
      />
    </div>
  );
}
