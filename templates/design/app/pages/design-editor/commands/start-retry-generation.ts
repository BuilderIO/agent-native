import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import type { PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { UploadedFile } from "@/components/editor/PromptDialog";
import { patchPendingGeneration } from "@/lib/pending-generation";
import type { RetryablePrompt } from "@/pages/design-editor/command-types";
import { MAX_GENERATION_ATTEMPTS } from "@/pages/design-editor/editor-constants";
import {
  designGenerationDirectives,
  designTemplateRefinementDirectives,
  formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles,
  loadDesignSystemGenerationContext,
} from "@/pages/design-editor/generation-prompt-directives";
import type { DesignData } from "@/pages/design-editor/types";

export interface StartRetryGenerationArgs {
  agentSubmit: (
    message: string,
    context: string,
    options?: Omit<AgentChatMessage, "message" | "context">,
  ) => string;
  canEditDesign: boolean;
  clearAutoRetryTimer: () => void;
  clearGenerationCompleteTimer: () => void;
  design: DesignData | null;
  generationModelRef: RefObject<{
    model?: string;
    engine?: string;
    effort?: PromptComposerSubmitOptions["effort"];
  } | null>;
  id: string | undefined;
  setGenerationChatTabId: Dispatch<SetStateAction<string | null>>;
  setGenerationIssue: Dispatch<SetStateAction<string | null>>;
  setHasPendingGeneration: Dispatch<SetStateAction<boolean>>;
  setRetryablePrompt: Dispatch<
    SetStateAction<{
      prompt: string;
      files: UploadedFile[];
      model?: PromptComposerSubmitOptions["model"];
      engine?: PromptComposerSubmitOptions["engine"];
      effort?: PromptComposerSubmitOptions["effort"];
      designSystemId?: string | null;
      attempt?: number;
      source?: string;
      templateId?: string;
      templateBaselineFiles?: Array<{ id: string; contentHash: string }>;
    } | null>
  >;
}

export async function runStartRetryGeneration(
  {
    agentSubmit,
    canEditDesign,
    clearAutoRetryTimer,
    clearGenerationCompleteTimer,
    design,
    generationModelRef,
    id,
    setGenerationChatTabId,
    setGenerationIssue,
    setHasPendingGeneration,
    setRetryablePrompt,
  }: StartRetryGenerationArgs,
  promptState: RetryablePrompt,
  attempt: number,
  mode: "manual" | "auto",
) {
  if (!id || !design || !canEditDesign) return;
  clearAutoRetryTimer();
  const fileContext = formatUploadedFileContext(promptState.files);
  const images = imageAttachmentsFromUploadedFiles(promptState.files);
  const designSystemContext = await loadDesignSystemGenerationContext(
    promptState.designSystemId,
  );
  const retryLine =
    mode === "auto"
      ? `(Automatically retrying attempt ${attempt} of ${MAX_GENERATION_ATTEMPTS} — the previous attempt did not complete.)`
      : "(Retrying — the previous attempt did not complete.)";
  const context = [
    promptState.templateId
      ? `The user picked the "${promptState.source ?? "template"}" template (id: "${promptState.templateId}").`
      : `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
    `User request: "${promptState.prompt}"`,
    promptState.designSystemId
      ? `Design system id: "${promptState.designSystemId}"`
      : "",
    designSystemContext,
    fileContext,
    "",
    retryLine,
    ...(promptState.templateId
      ? designTemplateRefinementDirectives(
          id,
          promptState.templateId,
          promptState.designSystemId,
        )
      : designGenerationDirectives(id, promptState.designSystemId)),
  ].join("\n");
  clearGenerationCompleteTimer();
  setGenerationIssue(null);
  const startedAt = Date.now();
  patchPendingGeneration(id, {
    prompt: promptState.prompt,
    files: promptState.files,
    title: design.title,
    designSystemId: promptState.designSystemId,
    model: promptState.model,
    engine: promptState.engine,
    effort: promptState.effort,
    source: promptState.source,
    templateId: promptState.templateId,
    templateBaselineFiles: promptState.templateBaselineFiles,
    attempt,
    startedAt,
  });
  setHasPendingGeneration(true);
  setRetryablePrompt(null);
  generationModelRef.current = {
    model: promptState.model,
    engine: promptState.engine,
    effort: promptState.effort,
  };
  const runTabId = agentSubmit(
    `Generate design for "${design.title}": ${promptState.prompt}`,
    context,
    {
      model: promptState.model,
      engine: promptState.engine,
      effort: promptState.effort,
      images,
    },
  );
  setGenerationChatTabId(runTabId);
  patchPendingGeneration(id, {
    prompt: promptState.prompt,
    files: promptState.files,
    title: design.title,
    designSystemId: promptState.designSystemId,
    model: promptState.model,
    engine: promptState.engine,
    effort: promptState.effort,
    source: promptState.source,
    templateId: promptState.templateId,
    templateBaselineFiles: promptState.templateBaselineFiles,
    attempt,
    runTabId,
    startedAt,
  });
}
