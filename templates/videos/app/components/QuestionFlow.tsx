import {
  GuidedQuestionFlow,
  type GuidedQuestion,
} from "@agent-native/core/client";
import type { QuestionFlowQuestion } from "@shared/api";

interface QuestionFlowProps {
  questions: QuestionFlowQuestion[];
  onSubmit: (answers: Record<string, any>) => void;
  onSkip: () => void;
}

export function QuestionFlow({
  questions,
  onSubmit,
  onSkip,
}: QuestionFlowProps) {
  return (
    <GuidedQuestionFlow
      questions={questions as GuidedQuestion[]}
      onSubmit={onSubmit}
      onSkip={onSkip}
      title="Tune the video before generation"
      description="Pick the animation direction, timing, and audience. Use Other when the preset choices miss."
    />
  );
}
