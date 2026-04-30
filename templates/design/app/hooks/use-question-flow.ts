import { useEffect, useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sendToAgentChat } from "@agent-native/core/client";
import type { QuestionFlowQuestion } from "@shared/api";

/**
 * Polls `application-state/show-questions`. When the agent writes structured
 * questions, the editor surfaces a full-canvas overlay (Claude Design-style:
 * questions appear before generation begins). On submit, answers are formatted
 * and posted back to the agent chat; on skip, the agent is told to proceed.
 */
export function useQuestionFlow(designId: string | undefined) {
  const qc = useQueryClient();
  const [questions, setQuestions] = useState<QuestionFlowQuestion[] | null>(
    null,
  );

  const { data } = useQuery({
    queryKey: ["show-questions"],
    queryFn: async () => {
      const res = await fetch(
        "/_agent-native/application-state/show-questions",
      );
      if (!res.ok) return null;
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    structuralSharing: false,
  });

  useEffect(() => {
    if (data?.questions && data.questions.length > 0) {
      setQuestions(data.questions);
    } else {
      setQuestions(null);
    }
  }, [data]);

  const clear = useCallback(() => {
    setQuestions(null);
    qc.setQueryData(["show-questions"], null);
    fetch("/_agent-native/application-state/show-questions", {
      method: "DELETE",
    }).catch(() => {});
  }, [qc]);

  const handleSubmit = useCallback(
    (answers: Record<string, any>) => {
      const lines = Object.entries(answers)
        .filter(([, v]) => v != null && v !== "")
        .map(([key, val]) => {
          if (Array.isArray(val)) return `${key}: ${val.join(", ")}`;
          return `${key}: ${val}`;
        });

      const context = [
        "The user answered the pre-generation questions.",
        designId ? `Design ID: ${designId}` : "",
        "",
        "Answers:",
        lines.join("\n"),
        "",
        designId
          ? `Now generate three variations of the design. Use the variants tool: write to application-state/design-variants with three candidate { id, label, content } entries; the user will pick one. Do NOT call generate-design directly until the user picks a variant.`
          : "Now generate three variations of the design.",
      ]
        .filter(Boolean)
        .join("\n");

      sendToAgentChat({
        message: "Here are my answers — go ahead.",
        context,
        submit: true,
      });
      clear();
    },
    [designId, clear],
  );

  const handleSkip = useCallback(() => {
    sendToAgentChat({
      message: "Skip the questions — decide for me.",
      context: designId
        ? `The user skipped the pre-generation questions for design ${designId}. Proceed with reasonable defaults and generate three variations.`
        : "The user skipped the pre-generation questions. Proceed with reasonable defaults and generate three variations.",
      submit: true,
    });
    clear();
  }, [designId, clear]);

  return { questions, handleSubmit, handleSkip };
}
