import { useGuidedQuestionFlow } from "@agent-native/core/client";

/**
 * Polls `application-state/show-questions`. When the agent writes structured
 * questions, the editor surfaces a full-canvas overlay (Claude Design-style:
 * questions appear before generation begins). On submit, answers are formatted
 * and posted back to the agent chat; on skip, the agent is told to proceed.
 */
export function useQuestionFlow(designId: string | undefined) {
  return useGuidedQuestionFlow({
    submitMessage: "Here are my answers — go ahead.",
    skipMessage: "Skip the questions — decide for me.",
    buildSubmitContext: ({ formattedAnswers }) =>
      [
        "The user answered the pre-generation questions.",
        designId ? `Design ID: ${designId}` : "",
        "",
        "Answers:",
        formattedAnswers,
        "",
        designId
          ? "Now generate three variations of the design. Use the variants tool: write to application-state/design-variants with three candidate { id, label, content } entries; the user will pick one. Do NOT call generate-design directly until the user picks a variant."
          : "Now generate three variations of the design.",
      ]
        .filter(Boolean)
        .join("\n"),
    buildSkipContext: () =>
      designId
        ? `The user skipped the pre-generation questions for design ${designId}. Proceed with reasonable defaults and generate three variations.`
        : "The user skipped the pre-generation questions. Proceed with reasonable defaults and generate three variations.",
  });
}
