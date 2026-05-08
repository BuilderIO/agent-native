import { useGuidedQuestionFlow } from "@agent-native/core/client";

/**
 * Polls the `show-questions` application state key.
 * When the agent writes questions there, they surface as an overlay.
 * On submit the answers are sent to the agent chat; on skip the state is cleared.
 */
export function useQuestionFlow() {
  return useGuidedQuestionFlow({
    submitMessage: "Here are my answers to the questions:",
    skipMessage: "Skip the questions — just go ahead and decide for me.",
    buildSubmitContext: ({ formattedAnswers }) => formattedAnswers,
  });
}
