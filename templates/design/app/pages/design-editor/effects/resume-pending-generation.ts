import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  isPendingGenerationStale,
  patchPendingGeneration,
  readPendingGeneration,
} from "@/lib/pending-generation";
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
  const templateRefinement = Boolean(pending.templateId && files.length > 0);
  if (files.length > 0 && !templateRefinement) return;

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
    pending.prompt?.trim() || `Create an initial design for ${design.title}.`;
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
    const shouldSkipQuestions =
      pending.skipQuestions === true ||
      shouldExploreVariants ||
      hasReferenceImages;
    const designSystemContext = await loadDesignSystemGenerationContext(
      pendingDesignSystemId,
    );
    if (cancelled) return;
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
            ? designGenerationDirectives(
                id,
                pendingDesignSystemId,
                images.length,
              )
            : designIntakeQuestionDirectives(
                id,
                pendingDesignSystemId,
                images.length,
              )),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    generationModelRef.current = {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
    };
    const runTabId = agentSubmit(
      shouldSkipQuestions
        ? `Generate design for "${design.title}": ${prompt}`
        : `Create design: ${prompt}`,
      context,
      {
        model: pending.model,
        engine: pending.engine,
        effort: pending.effort,
        newTab: true,
        images,
      },
    );
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
