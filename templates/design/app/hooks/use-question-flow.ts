import {
  formatGuidedAnswersForAgent,
  useGuidedQuestionFlow,
  type GuidedQuestionAnswers,
} from "@agent-native/core/client/agent-chat";
import { type PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import { DESIGN_MUTATION_REQUIRED_DIRECTIVE } from "@shared/mutation-turn";
import { useCallback } from "react";

import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  formatComposerContext,
  hasComposerSystemContext,
} from "@/lib/composer-context";
import { loadDesignSystemGenerationContext } from "@/pages/design-editor/generation-prompt-directives";

export interface QuestionFlowModelSelection {
  model?: string;
  engine?: string;
  effort?: PromptComposerSubmitOptions["effort"];
}

export interface QuestionFlowGenerationBrief {
  contextItems?: PromptComposerSubmitOptions["contextItems"];
  prompt?: string;
  designSystemId?: string | null;
  images?: string[];
  uploadedFileContext?: string;
}

interface UseQuestionFlowOptions {
  enabled?: boolean;
  continuationTabId?: string | null;
  onContinue?: (tabId: string) => void;
  getModelSelection?: () => QuestionFlowModelSelection | null | undefined;
  getGenerationBrief?: () => QuestionFlowGenerationBrief | null | undefined;
}

function designQuestionsStateKey(designId: string | undefined): string {
  return designId ? `show-questions:${designId}` : "show-questions";
}

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
    formatComposerContext(brief?.contextItems),
    designSystemContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const RESPONSIVE_GENERATION_REQUIREMENTS =
  'Responsive behavior is mandatory for every web design. Read the form-factor answer above: for Desktop or Both/responsive, call generate-design with `primaryViewport: "desktop"` and a 1440x1024 canvas frame; use `primaryViewport: "mobile"` only for an explicitly mobile-primary choice. Use mobile-first responsive CSS, then take desktop and mobile screenshots and fix any overflow before reporting the design complete.';

function existingDesignContinuationContext(
  designId: string | undefined,
): string {
  return designId
    ? [
        `This is a continuation of the new-design flow for existing design "${designId}".`,
        "The design shell already exists and is the only design to modify.",
        `Use designId "${designId}" for generation. Never call create-design or create-design-from-template in this continuation.`,
      ].join(" ")
    : "";
}

const SETTLED_ANSWERS_INSTRUCTION =
  "Treat every question below as settled: do not ask it again, and do not ask for a confirmation of it. Continue the work these answers were blocking.";

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
  const existingDesignContext = existingDesignContinuationContext(designId);
  const flow = useGuidedQuestionFlow({
    enabled,
    stateKey,
    queryKey: [stateKey],
    submitMessage: "Here are my answers — go ahead.",
    skipMessage: "Skip the questions — decide for me.",
    buildSubmitContext: ({ formattedAnswers }) =>
      [
        "The user answered the pre-generation questions.",
        existingDesignContext,
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
      [
        existingDesignContext,
        designId
          ? `The user skipped the pre-generation questions for design ${designId}. Proceed with reasonable defaults. Generate one polished first direction unless the original prompt explicitly requested options.`
          : "The user skipped the pre-generation questions. Proceed with reasonable defaults. Generate one polished first direction unless the original prompt explicitly requested options.",
      ]
        .filter(Boolean)
        .join(" "),
  });

  const sendContinuation = useCallback(
    async (message: string, context?: string) => {
      flow.clear();
      const selection = getModelSelection?.() ?? {};
      const { model, engine, effort } = selection;
      const brief = getGenerationBrief?.() ?? null;
      const designSystemContext =
        brief?.designSystemId && !hasComposerSystemContext(brief.contextItems)
          ? await loadDesignSystemGenerationContext(brief.designSystemId)
          : "";
      const briefContext = buildGenerationBriefContext(
        brief,
        designSystemContext,
      );
      const tabId = sendToDesignAgentChat({
        message,
        context: [briefContext, context, DESIGN_MUTATION_REQUIRED_DIRECTIVE]
          .filter(Boolean)
          .join("\n\n"),
        submit: true,
        newTab: true,
        ...(brief?.images?.length ? { images: brief.images } : {}),
        ...(continuationTabId ? { tabId: continuationTabId } : {}),
        ...(model ? { model } : {}),
        ...(engine ? { engine } : {}),
        ...(effort ? { effort } : {}),
      });
      onContinue?.(tabId);
    },
    [
      continuationTabId,
      flow,
      getGenerationBrief,
      getModelSelection,
      onContinue,
    ],
  );

  const handleSubmit = useCallback(
    (answers: GuidedQuestionAnswers) => {
      const formattedAnswers = formatGuidedAnswersForAgent(
        answers,
        flow.questions ?? undefined,
      );
      const context = [
        "The user answered the pre-generation questions.",
        existingDesignContext,
        SETTLED_ANSWERS_INSTRUCTION,
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
    [designId, flow.questions, sendContinuation],
  );

  const handleSkip = useCallback(() => {
    void sendContinuation(
      "Skip the questions — decide for me.",
      designId
        ? `${existingDesignContext} The user skipped the pre-generation questions for design ${designId}. Proceed with reasonable defaults. ${RESPONSIVE_GENERATION_REQUIREMENTS} Generate one polished first direction unless the original prompt explicitly requested options.`
        : `The user skipped the pre-generation questions. Proceed with reasonable defaults. ${RESPONSIVE_GENERATION_REQUIREMENTS} Generate one polished first direction unless the original prompt explicitly requested options.`,
    );
  }, [designId, sendContinuation]);

  return {
    ...flow,
    handleSubmit,
    handleSkip,
  };
}
