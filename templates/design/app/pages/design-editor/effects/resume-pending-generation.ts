import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import type { PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";
import { InvalidCanvasDimensionsError } from "@shared/canvas-dimensions";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { formatComposerContext } from "@/lib/composer-context";
import { figmaReferenceDirectives } from "@/lib/figma-attachment";
import {
  clearPendingGeneration,
  failPendingGenerationForMissingImagePayload,
  isPendingGenerationStale,
  patchPendingGeneration,
  readPendingGeneration,
  snapshotGenerationOutputBaseline,
  shouldSkipPendingGenerationResume,
} from "@/lib/pending-generation";
import {
  designGenerationDirectives,
  designIntakeQuestionDirectives,
  designTemplateRefinementDirectives,
  designVariantGenerationDirectives,
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
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
    references?: PromptComposerSubmitOptions["references"];
  } | null>;
  imageAttachmentUnavailableMessage: string;
  invalidCanvasDimensionsMessage: string;
  id: string | undefined;
  markGenerationStale: () => void;
  setGenerationChatTabId: Dispatch<SetStateAction<string | null>>;
  setGenerationIssue: Dispatch<SetStateAction<string | null>>;
  setHasPendingGeneration: Dispatch<SetStateAction<boolean>>;
}

export function runResumePendingGeneration({
  agentSubmit,
  clearGenerationCompleteTimer,
  design,
  files,
  generationModelRef,
  imageAttachmentUnavailableMessage,
  invalidCanvasDimensionsMessage,
  id,
  markGenerationStale,
  setGenerationChatTabId,
  setGenerationIssue,
  setHasPendingGeneration,
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
    return;
  }

  if (pending.autoGenerate === false) {
    setGenerationIssue(null);
    setHasPendingGeneration(true);
    return;
  }

  const prompt =
    pending.prompt && pending.prompt.trim().length > 0
      ? pending.prompt
      : `Create an initial design for ${design.title}.`;
  const uploadedFiles = Array.isArray(pending.files) ? pending.files : [];
  const fileContext = formatUploadedFileContext(uploadedFiles);
  let images: string[];
  try {
    images = imageAttachmentsFromUploadedFiles(uploadedFiles);
  } catch (error) {
    if (
      !failPendingGenerationForMissingImagePayload(
        id,
        error,
        imageAttachmentUnavailableMessage,
        setGenerationIssue,
        setHasPendingGeneration,
      )
    ) {
      throw error;
    }
    return;
  }
  const sourceContext = pending.source
    ? `The user picked the "${pending.source}" template${pending.templateId ? ` (id: "${pending.templateId}")` : ""}.`
    : "The user just created a new empty design.";

  {
    const hasReferenceImages = images.length > 0;
    const shouldExploreVariants =
      !hasReferenceImages && promptRequestsVariantExploration(prompt);
    const explicitSkip =
      pending.skipQuestions === true ||
      shouldExploreVariants ||
      hasReferenceImages;
    const shouldSkipQuestions = explicitSkip;
    let generationDirectives: string[];
    try {
      generationDirectives = pending.templateId
        ? designTemplateRefinementDirectives(
            id,
            pending.templateId,
            images.length,
          )
        : shouldExploreVariants
          ? designVariantGenerationDirectives(id, prompt)
          : shouldSkipQuestions
            ? designGenerationDirectives(id, images.length, prompt)
            : designIntakeQuestionDirectives(id, images.length, prompt);
    } catch (error) {
      if (!(error instanceof InvalidCanvasDimensionsError)) throw error;
      clearPendingGeneration(id);
      setGenerationIssue(invalidCanvasDimensionsMessage);
      setHasPendingGeneration(false);
      return;
    }
    const context = [
      sourceContext,
      `Design id: "${id}"`,
      `Design title: "${design.title}"`,
      `User request: "${prompt}"`,
      formatComposerContext(pending.contextItems),
      fileContext,
      "",
      ...generationDirectives,
      ...figmaReferenceDirectives(pending.contextItems),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    generationModelRef.current = {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
      references: pending.references,
    };
    const runTabId = agentSubmit(prompt, context, {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
      references: pending.references,
      newTab: true,
      images,
    });
    setGenerationChatTabId(runTabId);
    patchPendingGeneration(id, {
      runTabId,
      attempt: pending.attempt ?? 1,
      startedAt: Date.now(),
      ...(!pending.templateId
        ? {
            outputBaselineFiles:
              pending.outputBaselineFiles ??
              snapshotGenerationOutputBaseline(files),
          }
        : {}),
    });
    setHasPendingGeneration(true);
  }
  return () => undefined;
}
