import {
  formatGuidedAnswersForAgent,
  useGuidedQuestionFlow,
  type GuidedQuestionAnswers,
} from "@agent-native/core/client";
import { useCallback } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

interface UseQuestionFlowOptions {
  continuationTabId?: string | null;
  onContinue?: (tabId: string) => void;
}

function designQuestionsStateKey(designId: string | undefined): string {
  return designId ? `show-questions:${designId}` : "show-questions";
}

const RESPONSIVE_GENERATION_REQUIREMENTS =
  'Responsive behavior is mandatory for every web design. Read the form-factor answer above: for Desktop or Both/responsive, call generate-design with `primaryViewport: "desktop"` and a 1440x1024 canvas frame; use `primaryViewport: "mobile"` only for an explicitly mobile-primary choice. Use mobile-first responsive CSS, then take desktop and mobile screenshots and fix any overflow before reporting the design complete.';

/**
 * Polls design-scoped question state. When the agent writes structured
 * questions, the editor surfaces a full-canvas overlay for only this design.
 * On submit, answers are formatted and posted back to the agent chat; on skip,
 * the agent is told to proceed.
 */
export function useQuestionFlow(
  designId: string | undefined,
  { continuationTabId, onContinue }: UseQuestionFlowOptions = {},
) {
  const stateKey = designQuestionsStateKey(designId);
  const flow = useGuidedQuestionFlow({
    stateKey,
    queryKey: [stateKey],
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
        RESPONSIVE_GENERATION_REQUIREMENTS,
        "",
        designId
          ? 'Now continue the design. Honor any answer about variations: if the user asked to explore options, call present-design-variants with 2-5 concise directions using label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens - wait for their chat pick, delete each unchosen variant screen at most once, call get-design-snapshot exactly once with fileId for the kept screen, then call edit-design exactly once on that same fileId in a bounded pass. Use mode "replace-file" when expanding the representative placeholder into a complete but compact product UI in the chosen direction. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the feature list is too large for one reliable edit. Do not repeat delete/snapshot cycles. Do not call generate-design after a variant pick. Stop after the first successful edit-design save. Otherwise call generate-design with one complete, renderable index.html first. Do not ask another question unless a required decision is still genuinely missing.'
          : "Now continue the design. Honor any answer about variations: use variants only if requested; otherwise generate one polished direction.",
      ]
        .filter(Boolean)
        .join("\n"),
    buildSkipContext: () =>
      designId
        ? `The user skipped the pre-generation questions for design ${designId}. Proceed with reasonable defaults. Generate one polished first direction unless the original prompt explicitly requested options.`
        : "The user skipped the pre-generation questions. Proceed with reasonable defaults. Generate one polished first direction unless the original prompt explicitly requested options.",
  });

  const sendContinuation = useCallback(
    (message: string, context?: string) => {
      // Always request `newTab` (mirroring useAgentGenerating.submit's
      // default). Without it, when there is no continuationTabId yet the
      // message goes to whatever tab is currently active, but the id we
      // return here would still be a freshly generated one that was never
      // actually used — trackAgentGeneration/onContinue would then watch a
      // tabId that never matches real chatRunning events, so the design
      // "generating" UI silently desyncs (false "stopped, please retry"
      // toasts, completion never detected). Passing tabId only when we have
      // a continuationTabId still reuses that existing thread (addOptimistic
      // thread is idempotent for known ids); omitting it lets a fresh id be
      // generated and actually created, so the returned tabId is always the
      // real destination thread.
      const tabId = sendToDesignAgentChat({
        message,
        context,
        submit: true,
        newTab: true,
        ...(continuationTabId ? { tabId: continuationTabId } : {}),
      });
      onContinue?.(tabId);
      flow.clear();
    },
    [continuationTabId, flow, onContinue],
  );

  const handleSubmit = useCallback(
    (answers: GuidedQuestionAnswers) => {
      const formattedAnswers = formatGuidedAnswersForAgent(answers);
      const context = [
        "The user answered the pre-generation questions.",
        designId ? `Design ID: ${designId}` : "",
        "",
        "Answers:",
        formattedAnswers,
        "",
        RESPONSIVE_GENERATION_REQUIREMENTS,
        "",
        designId
          ? 'Now continue the design. Honor any answer about variations: if the user asked to explore options, call present-design-variants with 2-5 concise directions using label, description, accentColor, and feature bullets; omit large content HTML when needed because the action can render compact representative screens - wait for their chat pick, delete each unchosen variant screen at most once, call get-design-snapshot exactly once with fileId for the kept screen, then call edit-design exactly once on that same fileId in a bounded pass. Use mode "replace-file" when expanding the representative placeholder into a complete but compact product UI in the chosen direction. Prioritize the primary workflow and render secondary details as visible controls, states, or affordances if the feature list is too large for one reliable edit. Do not repeat delete/snapshot cycles. Do not call generate-design after a variant pick. Stop after the first successful edit-design save. Otherwise call generate-design with one complete, renderable index.html first. Do not ask another question unless a required decision is still genuinely missing.'
          : "Now continue the design. Honor any answer about variations: use variants only if requested; otherwise generate one polished direction.",
      ]
        .filter(Boolean)
        .join("\n");

      sendContinuation("Here are my answers — go ahead.", context);
    },
    [designId, sendContinuation],
  );

  const handleSkip = useCallback(() => {
    sendContinuation(
      "Skip the questions — decide for me.",
      designId
        ? `The user skipped the pre-generation questions for design ${designId}. Proceed with reasonable defaults. ${RESPONSIVE_GENERATION_REQUIREMENTS} Generate one polished first direction unless the original prompt explicitly requested options.`
        : `The user skipped the pre-generation questions. Proceed with reasonable defaults. ${RESPONSIVE_GENERATION_REQUIREMENTS} Generate one polished first direction unless the original prompt explicitly requested options.`,
    );
  }, [designId, sendContinuation]);

  return {
    ...flow,
    handleSubmit,
    handleSkip,
  };
}
