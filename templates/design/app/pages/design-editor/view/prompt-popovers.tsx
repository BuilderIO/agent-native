import { readCreativeContextState } from "@agent-native/creative-context/client";
import { type PromptComposerSubmitOptions } from "@agent-native/toolkit/app/chat/composer/index";
import { getOverviewScreenFileIds } from "@shared/design-files";
import { toast } from "sonner";

import { HistoryPanel } from "@/components/design/editor/HistoryPanel";
import { MakeRealDialog } from "@/components/design/editor/MakeRealDialog";
import { SaveTemplateDialog } from "@/components/design/editor/SaveTemplateDialog";
import PromptPopover, {
  type UploadedFile,
} from "@/components/editor/PromptDialog";
import { patchPendingGeneration } from "@/lib/pending-generation";

import { designPrecedentDirectives } from "../creative-context-precedent";
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
  loadDesignSystemGenerationContext,
  promptRequestsVariantExploration,
  designVariantGenerationDirectives,
  designGenerationDirectives,
  designIntakeQuestionDirectives,
} from "../generation-prompt-directives";
import {
  loadIntakeContextFromAppState,
  allIntakeTopicsCovered,
} from "../intake-question-topics";
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
  const { isBuilderDesignEmbed, parentOriginRef } = editorHistory;
  const {
    canEditDesign,
    creativeContextLab,
    setGenerationIssue,
    persistPromptDesignSystem,
    clearGenerationCompleteTimer,
    generationModelRef,
    setHasPendingGeneration,
    agentSubmit,
    setGenerationChatTabId,
    generating,
    promptAnchorRef,
    tweaksEnabled,
    migrateMutation,
    saveDesignAsTemplateMutation,
  } = editorGenerationAndAccess;
  const {
    showPrompt,
    handlePromptOpenChange,
    files,
    selectedPromptDesignSystemId,
    creativeContextEnabled,
    creativeContextPersistRef,
    designSystemsLoading,
    promptDesignSystemId,
    designSystemOptions,
    setPromptDesignSystemId,
    creativeContextOptions,
    creativeContextsQuery,
    creativeContextState,
    handleCreativeContextChange,
    navigate,
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
            window.parent.postMessage(
              {
                type: "agentNative.submitChat",
                data,
              },
              parentOriginRef.current ?? window.location.origin,
            );
            handlePromptOpenChange(false);
            return;
          }
          if (!canEditDesign) return;
          if (!creativeContextLab.isSuccess) {
            const issue = t("designEditor.generationStoppedRetry");
            setGenerationIssue(issue);
            throw new Error(issue);
          }
          const designSystemId = selectedPromptDesignSystemId;
          persistPromptDesignSystem(designSystemId);
          const fileContext = formatUploadedFileContext(files);
          const designSystemContext =
            await loadDesignSystemGenerationContext(designSystemId);
          const hasReferenceImages = images.length > 0;
          const shouldExploreVariants =
            !hasReferenceImages && promptRequestsVariantExploration(prompt);
          const intake =
            shouldExploreVariants ||
            hasReferenceImages ||
            !creativeContextEnabled
              ? null
              : await (async () => {
                  await creativeContextPersistRef.current?.catch(() => {});
                  return loadIntakeContextFromAppState(
                    readCreativeContextState,
                    creativeContextEnabled,
                  );
                })();
          const shouldSkipQuestions =
            shouldExploreVariants ||
            hasReferenceImages ||
            (intake ? allIntakeTopicsCovered(intake.coverage) : false);
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            designSystemId ? `Design system id: "${designSystemId}"` : "",
            designSystemContext,
            fileContext,
            "",
            ...(shouldExploreVariants
              ? designVariantGenerationDirectives(id, designSystemId, prompt)
              : shouldSkipQuestions
                ? [
                    ...designGenerationDirectives(
                      id,
                      designSystemId,
                      images.length,
                      prompt,
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
                    designSystemId,
                    images.length,
                    intake
                      ? {
                          coverage: intake.coverage,
                          contextUnavailable: intake.unavailable,
                          unavailableReason: intake.unavailableReason,
                        }
                      : undefined,
                    prompt,
                  )),
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
            designSystemId,
            ...options,
            attempt: 1,
            startedAt,
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
            designSystemId,
            ...options,
            runTabId,
            attempt: 1,
            startedAt,
          });
          handlePromptOpenChange(false);
        }}
        loading={
          generating ||
          (designSystemsLoading && promptDesignSystemId === undefined)
        }
        anchorRef={promptAnchorRef}
        designSystems={designSystemOptions}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={selectedPromptDesignSystemId}
        onDesignSystemChange={setPromptDesignSystemId}
        creativeContexts={creativeContextEnabled ? creativeContextOptions : []}
        creativeContextsLoading={
          creativeContextEnabled && creativeContextsQuery.isLoading
        }
        selectedCreativeContextId={
          creativeContextEnabled
            ? (creativeContextState.state.selectedContextId ?? null)
            : undefined
        }
        onCreativeContextChange={
          creativeContextEnabled ? handleCreativeContextChange : undefined
        }
        onCreateDesignSystem={() => {
          handlePromptOpenChange(false);
          void navigate("/design-systems/setup");
        }}
      />
      <PromptPopover
        scopeDraftsToOrg={isSignedIn}
        open={showTweakPrompt && tweaksEnabled}
        onOpenChange={handleTweakPromptOpenChange}
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
              queryKey: ["action", "get-design", { id }],
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
              error instanceof Error
                ? error.message
                : t("designEditor.templateSaveFailed"),
            );
          }
        }}
      />
    </>
  );
}
