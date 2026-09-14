import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import { readCreativeContextState } from "@agent-native/creative-context/client";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  isPendingGenerationStale,
  patchPendingGeneration,
  readPendingGeneration,
  shouldSkipPendingGenerationResume,
} from "@/lib/pending-generation";
import { designPrecedentDirectives } from "@/pages/design-editor/creative-context-precedent";
import {
  designGenerationDirectives,
  designIntakeQuestionDirectives,
  designTemplateRefinementDirectives,
  designVariantGenerationDirectives,
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
  loadDesignSystemGenerationContext,
  promptRequestsVariantExploration,
} from "@/pages/design-editor/generation-prompt-directives";
import {
  allIntakeTopicsCovered,
  loadIntakeContextFromAppState,
} from "@/pages/design-editor/intake-question-topics";
import type { DesignData, DesignFile } from "@/pages/design-editor/types";

export interface ResumePendingGenerationArgs {
  agentSubmit: (
    message: string,
    context: string,
    options?: Omit<AgentChatMessage, "message" | "context">,
  ) => string;
  clearGenerationCompleteTimer: () => void;
  design: DesignData | null;
  files: DesignFile[];
  generationModelRef: RefObject<{
    model?: string;
    engine?: string;
    effort?: PromptComposerSubmitOptions["effort"];
  } | null>;
  id: string | undefined;
  markGenerationStale: () => void;
  setGenerationChatTabId: Dispatch<SetStateAction<string | null>>;
  setGenerationIssue: Dispatch<SetStateAction<string | null>>;
  setHasPendingGeneration: Dispatch<SetStateAction<boolean>>;
  trackAgentGeneration: (tabId: string) => void;
}

export function runResumePendingGeneration({
  agentSubmit,
  clearGenerationCompleteTimer,
  design,
  files,
  generationModelRef,
  id,
  markGenerationStale,
  setGenerationChatTabId,
  setGenerationIssue,
  setHasPendingGeneration,
  trackAgentGeneration,
}: ResumePendingGenerationArgs) {
  if (!id || !design) return;

  const pending = readPendingGeneration(id);
  if (!pending) {
    setHasPendingGeneration(false);
    return;
  }
  if (shouldSkipPendingGenerationResume(pending, files)) return;

  if (isPendingGenerationStale(pending)) {
    markGenerationStale();
    return;
  }

  if (pending.runTabId) {
    setGenerationIssue(null);
    setHasPendingGeneration(true);
    setGenerationChatTabId(pending.runTabId);
    trackAgentGeneration(pending.runTabId);
    return;
  }

  const prompt =
    pending.prompt && pending.prompt.trim().length > 0
      ? pending.prompt
      : `Create an initial design for ${design.title}.`;
  const uploadedFiles = Array.isArray(pending.files) ? pending.files : [];
  const fileContext = formatUploadedFileContext(uploadedFiles);
  const images = imageAttachmentsFromUploadedFiles(uploadedFiles);
  const sourceContext = pending.source
    ? `The user picked the "${pending.source}" template${pending.templateId ? ` (id: "${pending.templateId}")` : ""}.`
    : "The user just created a new empty design.";
  const pendingDesignSystemId =
    pending.designSystemId === undefined
      ? design.designSystemId
      : pending.designSystemId;

  if (pending.autoGenerate === false) {
    setGenerationIssue(null);
    setHasPendingGeneration(true);
    return;
  }

  let cancelled = false;
  void (async () => {
    const shouldExploreVariants = promptRequestsVariantExploration(prompt);
    // A reference screenshot already answers the questions the intake flow
    // asks. Spending the one turn that can see the image on a questionnaire
    // means the turn that writes HTML never sees it.
    const hasReferenceImages = images.length > 0;
    const explicitSkip =
      pending.skipQuestions === true ||
      shouldExploreVariants ||
      hasReferenceImages;
    const usesTemplate = Boolean(pending.templateId);
    const [designSystemContext, intake] = await Promise.all([
      loadDesignSystemGenerationContext(pendingDesignSystemId),
      usesTemplate || shouldExploreVariants
        ? Promise.resolve(null)
        : loadIntakeContextFromAppState(readCreativeContextState),
    ]);
    if (cancelled) return;
    const shouldSkipQuestions =
      explicitSkip ||
      (intake ? allIntakeTopicsCovered(intake.coverage) : false);
    const context = [
      sourceContext,
      `Design id: "${id}"`,
      `Design title: "${design.title}"`,
      `User request: "${prompt}"`,
      pendingDesignSystemId
        ? `Design system id: "${pendingDesignSystemId}"`
        : "",
      designSystemContext,
      fileContext,
      "",
      ...(pending.templateId
        ? designTemplateRefinementDirectives(
            id,
            pending.templateId,
            pendingDesignSystemId,
          )
        : shouldExploreVariants
          ? designVariantGenerationDirectives(id, pendingDesignSystemId)
          : shouldSkipQuestions
            ? [
                ...designGenerationDirectives(
                  id,
                  pendingDesignSystemId,
                  images.length,
                ),
                ...(intake?.explicitContext &&
                intake.precedent.status === "strong"
                  ? designPrecedentDirectives(
                      intake.precedent.contextId,
                      intake.precedent.matches,
                      id,
                    )
                  : []),
              ]
            : designIntakeQuestionDirectives(
                id,
                pendingDesignSystemId,
                images.length,
                intake
                  ? {
                      coverage: intake.coverage,
                      contextUnavailable: intake.unavailable,
                      unavailableReason: intake.unavailableReason,
                    }
                  : undefined,
              )),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    generationModelRef.current = {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
    };
    const runTabId = agentSubmit(prompt, context, {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
      newTab: true,
      images,
    });
    setGenerationChatTabId(runTabId);
    patchPendingGeneration(id, {
      runTabId,
      attempt: pending.attempt ?? 1,
      designSystemId: pendingDesignSystemId,
      startedAt: Date.now(),
    });
    setHasPendingGeneration(true);
  })();
  return () => {
    cancelled = true;
  };
}
