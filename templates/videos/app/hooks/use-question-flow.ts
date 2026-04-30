import { useEffect, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentNativePath, sendToAgentChat } from "@agent-native/core/client";
import type { QuestionFlowQuestion } from "@shared/api";

/**
 * Polls the `show-questions` application state key.
 * When the agent writes questions there, they surface as an overlay.
 * On submit the answers are sent to the agent chat; on skip the state is cleared.
 */
export function useQuestionFlow() {
  const qc = useQueryClient();
  const [questions, setQuestions] = useState<QuestionFlowQuestion[] | null>(
    null,
  );

  const { data } = useQuery({
    queryKey: ["show-questions"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/show-questions"),
      );
      if (!res.ok) return null;
      const json = await res.json();
      if (json && json.questions && json.questions.length > 0) {
        return { ...json, _ts: Date.now() };
      }
      return null;
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  // When new questions arrive, surface them
  useEffect(() => {
    if (data?.questions) {
      setQuestions(data.questions);
    }
  }, [data]);

  const clearQuestions = useCallback(() => {
    setQuestions(null);
    fetch(agentNativePath("/_agent-native/application-state/show-questions"), {
      method: "DELETE",
    }).catch(() => {});
    qc.setQueryData(["show-questions"], null);
  }, [qc]);

  const handleSubmit = useCallback(
    (answers: Record<string, any>) => {
      // Format answers as readable text for the agent
      const lines = Object.entries(answers)
        .filter(([, v]) => v != null && v !== "")
        .map(([key, val]) => {
          if (Array.isArray(val)) return `${key}: ${val.join(", ")}`;
          return `${key}: ${val}`;
        });

      const message = "Here are my answers to the questions:";
      const context = lines.join("\n");

      sendToAgentChat({ message, context, submit: true });
      clearQuestions();
    },
    [clearQuestions],
  );

  const handleSkip = useCallback(() => {
    sendToAgentChat({
      message: "Skip the questions — just go ahead and decide for me.",
      submit: true,
    });
    clearQuestions();
  }, [clearQuestions]);

  return { questions, handleSubmit, handleSkip };
}
