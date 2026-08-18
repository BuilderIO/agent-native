import {
  formatGuidedAnswersForAgent,
  useGuidedQuestionFlow,
  type GuidedQuestionAnswers,
} from "@agent-native/core/client/agent-chat";
import { type PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import { useCallback } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";
import { loadDesignSystemGenerationContext } from "@/pages/design-editor/generation-prompt-directives";

export interface QuestionFlowModelSelection {
  model?: string;
  engine?: string;
  effort?: PromptComposerSubmitOptions["effort"];
}

/**
 * What the user actually supplied at kickoff. The intake turn is forced to emit
 * only a questionnaire and then stop, so THIS continuation is the turn that
 * writes HTML — and a fresh thread inherits nothing. Re-sending the brief here
 * is the only thing that puts the user's own prompt, reference screenshots, and
 * design system in front of the model at the moment it generates.
 */
export interface QuestionFlowGenerationBrief {
  /** The user's original words, replayed verbatim — never a paraphrase. */
  prompt?: string;
  designSystemId?: string | null;
  /** Data URLs; re-attached so the reference screenshot survives the hop. */
  images?: string[];
  /** Extracted text from uploaded files (specs, outlines, token dumps). */
  uploadedFileContext?: string;
}

interface UseQuestionFlowOptions {
  enabled?: boolean;
  continuationTabId?: string | null;
  onContinue?: (tabId: string) => void;
  /**
   * The model this generation started with, read AT SEND TIME. The continuation
   * is the turn that generates and it opens a fresh thread, which has no
   * override to inherit. A getter, not a value: the caller's source is a ref
   * filled after render, so a snapshot taken here would be the pre-kickoff one.
   */
  getModelSelection?: () => QuestionFlowModelSelection | null | undefined;
  /** Read at send time, for the same reason as `getModelSelection`. */
  getGenerationBrief?: () => QuestionFlowGenerationBrief | null | undefined;
}

function designQuestionsStateKey(designId: string | undefined): string {
  return designId ? `show-questions:${designId}` : "show-questions";
}

/**
 * Render the kickoff brief as prompt context for the continuation turn.
 * Exported and pure so the carry-through is testable without a DOM — this is
 * the whole fix for "the agent ignored my design system / screenshot / brief".
 */
export function buildGenerationBriefContext(
  brief: QuestionFlowGenerationBrief | null | undefined,
  designSystemContext: string,
): string {
  return [
    brief?.prompt?.trim()
      ? [
          "## The user's original request (verbatim)",
          "This is the spec for what to build. The answers below refine it;",
          "they do not replace it. Do not restate it as a looser paraphrase.",
          "",
          brief.prompt.trim(),
        ].join("\n")
      : "",
    brief?.images?.length
      ? [
          `## ${brief.images.length} reference image(s) re-attached to this message`,
          "Treat an attached UI screenshot as a layout specification to",
          "reproduce — its structure, hierarchy, density, and component",
          "grammar — not as loose inspiration. Match it unless an answer",
          "below explicitly overrides a part of it.",
        ].join("\n")
      : "",
    brief?.uploadedFileContext?.trim() ?? "",
    designSystemContext,
  ]
    .filter(Boolean)
    .join("\n\n");
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
  {
    enabled = true,
    continuationTabId,
    onContinue,
    getModelSelection,
    getGenerationBrief,
  }: UseQuestionFlowOptions = {},
) {
  const stateKey = designQuestionsStateKey(designId);
  const flow = useGuidedQuestionFlow({
    enabled,
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
    async (message: string, context?: string) => {
      const selection = getModelSelection?.() ?? {};
      const { model, engine, effort } = selection;
      const brief = getGenerationBrief?.() ?? null;
      // Re-hydrated rather than snapshotted at kickoff: the user can link or
      // change the design system while the questionnaire is open. This never
      // throws — a load failure returns instruction text telling the agent to
      // stop rather than improvise a generic style.
      const designSystemContext = brief?.designSystemId
        ? await loadDesignSystemGenerationContext(brief.designSystemId)
        : "";
      const briefContext = buildGenerationBriefContext(
        brief,
        designSystemContext,
      );
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
        context: [briefContext, context].filter(Boolean).join("\n\n"),
        submit: true,
        newTab: true,
        ...(brief?.images?.length ? { images: brief.images } : {}),
        ...(continuationTabId ? { tabId: continuationTabId } : {}),
        ...(model ? { model } : {}),
        ...(engine ? { engine } : {}),
        ...(effort ? { effort } : {}),
      });
      onContinue?.(tabId);
      flow.clear();
    },
    [
      continuationTabId,
      designId,
      flow,
      getGenerationBrief,
      getModelSelection,
      onContinue,
    ],
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

      void sendContinuation("Here are my answers — go ahead.", context);
    },
    [designId, sendContinuation],
  );

  const handleSkip = useCallback(() => {
    void sendContinuation(
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
