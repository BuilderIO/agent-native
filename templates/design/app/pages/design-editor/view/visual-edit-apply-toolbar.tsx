import { IconChevronDown, IconClipboard, IconX } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorModes } from "../domains/use-editor-modes";

export function renderVisualEditApplyToolbar({
  editorCore,
  editorHistory,
  editorFilesAndSaving,
  editorModes,
  editorExportAndHandoff,
  canApplyPendingVisualEditsWithAgent,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  canApplyPendingVisualEditsWithAgent: boolean;
}) {
  const {
    isVisualEditSurface,
    hostEmbeddedEditor,
    pendingStructureVerificationStatus,
    pendingVisualEditRecoveryVisible,
    shellMode,
    t,
  } = editorCore;
  const { hasLocalPendingVisualEdits, applyingViaHost } = editorHistory;
  const { remoteVisualEditPending, visualEditPendingQuery } =
    editorFilesAndSaving;
  const { handleAbortPendingVisualStyles } = editorModes;
  const {
    showPendingVisualStyleApply,
    pendingAgentHandoffBusy,
    handleApplyPendingVisualStylesWithAgent,
    handleCopyPendingVisualStylePrompt,
  } = editorExportAndHandoff;

  const canApplyPendingVisualEditsFromToolbar =
    canApplyPendingVisualEditsWithAgent &&
    (!isVisualEditSurface || hostEmbeddedEditor);
  const pendingStructureVerificationBusy =
    pendingStructureVerificationStatus === "checking-source" ||
    pendingStructureVerificationStatus === "awaiting-source" ||
    pendingStructureVerificationStatus === "awaiting-runtime";
  const remoteVisualEditPrompt =
    !hasLocalPendingVisualEdits && remoteVisualEditPending
      ? `${visualEditPendingQuery.data!.prompt}\n\nAfter applying and verifying these source changes, acknowledge only revision ${visualEditPendingQuery.data!.revision} with acknowledge-visual-edit-pending, then call get-visual-edit-pending again to verify it cleared.`
      : undefined;
  const showSharedVisualEditApply = Boolean(remoteVisualEditPrompt);
  const showVisualEditApply =
    showPendingVisualStyleApply ||
    showSharedVisualEditApply ||
    pendingVisualEditRecoveryVisible;

  return (
    <>
      {showVisualEditApply ? (
        <div
          data-design-pending-visual-style-toolbar
          className="pointer-events-none absolute inset-x-0 top-4 z-[70] flex justify-center px-4"
        >
          <div className="pointer-events-auto flex w-fit max-w-full items-center overflow-x-auto">
            <Button
              className={cn(
                // guard:allow-raw-color — primary-foreground inverts to near-black in dark mode
                "min-w-0 shrink-0 cursor-pointer bg-blue-500 px-3.5 text-sm font-semibold text-white hover:bg-blue-400 focus-visible:ring-blue-400",
                (!shellMode || !canApplyPendingVisualEditsFromToolbar) &&
                  "rounded-r-none",
              )}
              aria-label={t(
                showSharedVisualEditApply &&
                  canApplyPendingVisualEditsFromToolbar
                  ? "designEditor.pendingVisualStyles.applySharedEdits"
                  : canApplyPendingVisualEditsFromToolbar
                    ? "designEditor.pendingVisualStyles.applyAria"
                    : "designEditor.pendingVisualStyles.copyAgentPrompt",
              )}
              disabled={
                applyingViaHost ||
                pendingAgentHandoffBusy ||
                pendingStructureVerificationBusy
              }
              onClick={
                canApplyPendingVisualEditsFromToolbar
                  ? () =>
                      handleApplyPendingVisualStylesWithAgent(
                        remoteVisualEditPrompt,
                      )
                  : () =>
                      handleCopyPendingVisualStylePrompt(
                        remoteVisualEditPrompt,
                        true,
                      )
              }
            >
              {applyingViaHost ? (
                <Spinner className="mr-2 h-4 w-4 shrink-0" />
              ) : null}
              <span className="truncate">
                {t(
                  !canApplyPendingVisualEditsFromToolbar
                    ? "designEditor.pendingVisualStyles.copyAgentPrompt"
                    : applyingViaHost
                      ? "designEditor.pendingVisualStyles.applying"
                      : pendingStructureVerificationBusy
                        ? "designEditor.pendingVisualStyles.verifying"
                        : pendingStructureVerificationStatus === "conflict"
                          ? "designEditor.pendingVisualStyles.retryWithAgent"
                          : showSharedVisualEditApply
                            ? "designEditor.pendingVisualStyles.applySharedEdits"
                            : "designEditor.pendingVisualStyles.applyDesignUpdates",
                )}
              </span>
            </Button>
            {/* Keep the handoff actions available whenever toolbar Apply is unavailable. */}
            {shellMode && canApplyPendingVisualEditsFromToolbar ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    // guard:allow-raw-color — translucent divider on the branded blue Apply button
                    className="h-9 w-8 shrink-0 cursor-pointer rounded-l-none border-l border-white/20 bg-blue-500 px-0 text-white hover:bg-blue-400 focus-visible:ring-blue-400"
                    aria-label={t(
                      "designEditor.pendingVisualStyles.previewLabel",
                    )}
                  >
                    <IconChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="design-editor-app-menu-content w-64"
                  onEscapeKeyDown={(event) => event.stopPropagation()}
                >
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t("designEditor.pendingVisualStyles.previewLabel")}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() =>
                      handleCopyPendingVisualStylePrompt(
                        remoteVisualEditPrompt,
                        false,
                      )
                    }
                  >
                    <IconClipboard className="mr-2 h-4 w-4" />
                    {t("designEditor.pendingVisualStyles.copyPrompt")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      handleCopyPendingVisualStylePrompt(
                        remoteVisualEditPrompt,
                        true,
                      )
                    }
                  >
                    <IconClipboard className="mr-2 h-4 w-4" />
                    {t("designEditor.pendingVisualStyles.copyFullPrompt")}
                  </DropdownMenuItem>
                  {showSharedVisualEditApply ? null : (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={handleAbortPendingVisualStyles}
                    >
                      <IconX className="mr-2 h-4 w-4" />
                      {t("designEditor.pendingVisualStyles.abortPreview")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
