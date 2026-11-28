import {
  actionErrorCode,
  actionErrorMessage,
} from "@agent-native/core/client/hooks";
import { type PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";
import { InvalidCanvasDimensionsError } from "@shared/canvas-dimensions";
import { getOverviewScreenFileIds } from "@shared/design-files";
import { toast } from "sonner";

import { HistoryPanel } from "@/components/design/editor/HistoryPanel";
import { MakeRealDialog } from "@/components/design/editor/MakeRealDialog";
import { SaveTemplateDialog } from "@/components/design/editor/SaveTemplateDialog";
import PromptPopover, {
  type UploadedFile,
} from "@/components/editor/PromptDialog";
import { getDesignHostChannel } from "@/host/design-host-channel";
import { figmaReferenceDirectives } from "@/lib/figma-attachment";
import { patchPendingGeneration } from "@/lib/pending-generation";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorToolsAndVectors } from "../domains/use-editor-tools-and-vectors";
import {
  imageAttachmentsFromUploadedFiles,
  builderDesignEmbedSubmitData,
  formatUploadedFileContext,
  promptRequestsVariantExploration,
  designVariantGenerationDirectives,
  designGenerationDirectives,
  designIntakeQuestionDirectives,
} from "../generation-prompt-directives";
import type { DesignData } from "../types";

export function renderPromptPopovers({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorLiveEditsAndPresence,
  editorToolsAndVectors,
  editorLayoutAndStructure,
  id,
  design,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorToolsAndVectors: EditorToolsAndVectors;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  id: string;
  design: DesignData;
}) {
  const { isSignedIn, t, queryClient } = editorCore;
  const { isBuilderDesignEmbed } = editorHistory;
  const {
    canEditDesign,
    setGenerationIssue,
    clearGenerationCompleteTimer,
    generationModelRef,
    setHasPendingGeneration,
    generationOutputBaselineRef,
    agentSubmit,
    setGenerationChatTabId,
    generating,
    promptAnchorRef,
    migrateMutation,
    saveDesignAsTemplateMutation,
  } = editorGenerationAndAccess;
  const {
    showPrompt,
    handlePromptOpenChange,
    files,
    showTweakPrompt,
    handleTweakPromptOpenChange,
    tweakPromptAnchorRef,
  } = editorFilesAndSaving;
  const {
    makeRealDialogOpen,
    setMakeRealDialogOpen,
    migrationResult,
    handleConfirmMakeReal,
  } = editorActiveScreenAndGeometry;
  const { saveTemplateOpen, setSaveTemplateOpen, durableLockedLayerCount } =
    editorLiveEditsAndPresence;
  const { handleTweakPromptSubmit } = editorToolsAndVectors;
  const { historyOpen, setHistoryOpen } = editorLayoutAndStructure;

  return (
    <>
      <PromptPopover
        scopeDraftsToOrg={isSignedIn}
        open={showPrompt}
        onOpenChange={handlePromptOpenChange}
        requireAgentEngine
        title={t("designEditor.generateDesign")}
        placeholder={t("designEditor.generatePlaceholder")}
        onSubmit={async (
          prompt: string,
          files: UploadedFile[],
          options: PromptComposerSubmitOptions,
        ) => {
          const images = imageAttachmentsFromUploadedFiles(files);
          if (isBuilderDesignEmbed) {
            const data = builderDesignEmbedSubmitData(prompt, images);
            getDesignHostChannel().send({
              type: "agentNative.submitChat",
              data,
            });
            handlePromptOpenChange(false);
            return;
          }
          if (!canEditDesign) return;
          const outputBaselineFiles = generationOutputBaselineRef.current?.();
          if (outputBaselineFiles === undefined) {
            throw new Error(t("promptDialog.failedToSubmitPrompt"));
          }
          const fileContext = formatUploadedFileContext(files);
          const hasReferenceImages = images.length > 0;
          const shouldExploreVariants =
            !hasReferenceImages && promptRequestsVariantExploration(prompt);
          const shouldSkipQuestions =
            shouldExploreVariants || hasReferenceImages;
          let generationDirectives: string[];
          try {
            generationDirectives = shouldExploreVariants
              ? designVariantGenerationDirectives(id, prompt)
              : shouldSkipQuestions
                ? designGenerationDirectives(id, images.length, prompt)
                : designIntakeQuestionDirectives(id, images.length, prompt);
          } catch (error) {
            if (!(error instanceof InvalidCanvasDimensionsError)) throw error;
            const issue = t("designEditor.invalidCanvasDimensions");
            setGenerationIssue(issue);
            throw new Error(issue);
          }
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            fileContext,
            "",
            ...generationDirectives,
            ...figmaReferenceDirectives(options.contextItems),
          ].join("\n");
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          generationModelRef.current = {
            model: options.model,
            engine: options.engine,
            effort: options.effort,
          };
          const startedAt = Date.now();
          const { attachments: _composerAttachments, ...agentOptions } =
            options;
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            ...options,
            attempt: 1,
            startedAt,
            outputBaselineFiles,
          });
          setHasPendingGeneration(true);
          const runTabId = agentSubmit(prompt, context, {
            ...agentOptions,
            newTab: true,
            images,
          });
          setGenerationChatTabId(runTabId);
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            ...options,
            runTabId,
            attempt: 1,
            startedAt,
            outputBaselineFiles,
          });
          handlePromptOpenChange(false);
        }}
        loading={generating}
        submissionDisabled={generationOutputBaselineRef.current === undefined}
        anchorRef={promptAnchorRef}
      />
      <PromptPopover
        scopeDraftsToOrg={isSignedIn}
        open={showTweakPrompt}
        onOpenChange={handleTweakPromptOpenChange}
        requireAgentEngine
        title={t("designEditor.tweaksPromptTitle")}
        placeholder={t("designEditor.tweaksPlaceholder")}
        onSubmit={handleTweakPromptSubmit}
        loading={false}
        anchorRef={tweakPromptAnchorRef}
      />

      {/* §6.6 — "Make this a real app" dialog.
          Three states:
          1. Idle — confirm prompt with description of what will happen.
          2. Migrating — spinner while the Builder cloud agent accepts the job.
          3. Success — branchName + url; sourceType already flipped to fusion.
          4. Not-configured — CTA to use Builder.io.
      */}
      <MakeRealDialog
        open={makeRealDialogOpen}
        onOpenChange={setMakeRealDialogOpen}
        result={migrationResult}
        pending={migrateMutation.isPending}
        onConfirm={handleConfirmMakeReal}
      />

      {id ? (
        <HistoryPanel
          designId={id}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          canRestore={canEditDesign}
          onRestored={() => {
            void queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
          }}
        />
      ) : null}

      <SaveTemplateDialog
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        defaultTitle={design.title}
        defaultDescription={design.description ?? ""}
        screenCount={getOverviewScreenFileIds(files).length}
        lockedLayerCount={durableLockedLayerCount}
        saving={saveDesignAsTemplateMutation.isPending}
        onSave={async (values) => {
          try {
            await saveDesignAsTemplateMutation.mutateAsync({
              designId: id,
              ...values,
            });
            setSaveTemplateOpen(false);
            toast.success(t("designEditor.templateSaved"));
            await queryClient.invalidateQueries({
              queryKey: ["action", "list-design-templates"],
            });
          } catch (error) {
            toast.error(
              actionErrorCode(error) === "template_requires_screen"
                ? t("designEditor.templateRequiresScreen")
                : (actionErrorMessage(error) ??
                    t("designEditor.templateSaveFailed")),
            );
          }
        }}
      />
    </>
  );
}
