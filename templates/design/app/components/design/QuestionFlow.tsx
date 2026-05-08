import {
  GuidedQuestionFlow,
  type GuidedQuestion,
} from "@agent-native/core/client";
import type { QuestionFlowQuestion } from "@shared/api";

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
  return (
    <GuidedQuestionFlow
      questions={questions as GuidedQuestion[]}
      onSubmit={onSubmit}
      onSkip={onSkip}
      title={title ?? "Shape the design first"}
      description={
        description ??
        "Choose the direction that matters. Use Other for anything specific, or let the agent decide."
      }
      skipLabel={skipLabel}
      submitLabel={submitLabel}
    />
  );
}
