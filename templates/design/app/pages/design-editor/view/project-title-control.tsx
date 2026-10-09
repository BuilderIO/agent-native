import { useActionMutation } from "@agent-native/core/client/hooks";
import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";
import { shouldShowFullDesignProjectMenu } from "../mcp-widget-write-capabilities";
import { clearPendingEditSessionMarker } from "../pending-edit-session-marker";
import type { DesignData } from "../types";
import { ExportSubmenuContent } from "./export-submenu-content";

interface ProjectTitleControlProps {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorContentAndComponents: EditorContentAndComponents;
  editorExportAndHandoff: EditorExportAndHandoff;
  editorSourceAndSync: EditorSourceAndSync;
  design: DesignData;
  widgetEmbed: boolean;
}

function ProjectTitleControl({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorLiveEditsAndPresence,
  editorLayoutAndStructure,
  editorContentAndComponents,
  editorExportAndHandoff,
  editorSourceAndSync,
  design,
  widgetEmbed,
}: ProjectTitleControlProps) {
  const { t, id, queryClient } = editorCore;
  const { canEditDesign, canShareDesign, duplicateDesignMutation } =
    editorGenerationAndAccess;
  const {
    titleEditing,
    titleDraft,
    setTitleDraft,
    commitTitleEdit,
    handleTitleInputKeyDown,
    setTitleEditing,
    files,
  } = editorFilesAndSaving;
  const {
    hasPendingVisualStyleEdits,
    clearPendingLiveEditState,
    setMinimalUi,
    setActiveLeftPanel,
  } = editorHistory;
  const { setSaveTemplateOpen } = editorLiveEditsAndPresence;
  const { setHistoryOpen } = editorLayoutAndStructure;
  const { setUiHidden } = editorContentAndComponents;
  const { skipPendingEditNavigationBlockRef, setPendingImportFile } =
    editorSourceAndSync;
  const navigate = useNavigate();
  const deleteDesignMutation = useActionMutation("delete-design");
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const suppressFileMenuReturnFocusRef = useRef(false);

  const handleDuplicateDesign = useCallback(() => {
    if (!id) return;
    if (hasPendingVisualStyleEdits) {
      toast.error(t("designEditor.fileMenu.pendingEditsBlocked"));
      return;
    }
    duplicateDesignMutation
      .mutateAsync({ id } as any)
      .then((result: any) => {
        if (!result?.id) throw new Error("Missing copied design id");
        void navigate(`/design/${result.id}`);
      })
      .catch(() => toast.error(t("designEditor.toasts.saveCopyError")));
  }, [duplicateDesignMutation, hasPendingVisualStyleEdits, id, navigate, t]);

  const handleMoveToTrash = useCallback(() => {
    if (!id) return;
    setTrashDialogOpen(false);
    deleteDesignMutation
      .mutateAsync({ id } as any)
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
        // The design is gone, so its pending edits are moot; skip the
        // Stay/Discard prompt that would otherwise follow the delete.
        skipPendingEditNavigationBlockRef.current = true;
        clearPendingLiveEditState();
        clearPendingEditSessionMarker(id);
        void navigate("/home");
      })
      .catch(() => toast.error(t("designEditor.fileMenu.deleteError")));
  }, [
    clearPendingLiveEditState,
    deleteDesignMutation,
    id,
    navigate,
    queryClient,
    skipPendingEditNavigationBlockRef,
    t,
  ]);

  const handleImportFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setMinimalUi(false);
      setUiHidden(false);
      setActiveLeftPanel("import");
      setPendingImportFile(file);
    },
    [setActiveLeftPanel, setMinimalUi, setPendingImportFile, setUiHidden],
  );

  if (titleEditing && canEditDesign) {
    return (
      <Input
        autoFocus
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitleEdit}
        onKeyDown={handleTitleInputKeyDown}
        className="-mx-1 h-7 min-w-0 flex-1 border-transparent bg-[var(--design-editor-panel-raised-bg)] px-1 py-0 text-[13px] font-medium text-foreground shadow-none ring-offset-0 focus-visible:border-[var(--design-editor-control-border)] focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0"
      />
    );
  }

  if (!canEditDesign) {
    return (
      <span className="-mx-1 min-w-0 flex-1 truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90">
        {design.title}
      </span>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="-mx-1 min-w-0 flex-1 cursor-pointer truncate rounded px-1 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/50"
          >
            {design.title}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="design-editor-app-menu-content w-[220px]"
          onCloseAutoFocus={(event) => {
            if (!suppressFileMenuReturnFocusRef.current) return;
            event.preventDefault();
            suppressFileMenuReturnFocusRef.current = false;
          }}
        >
          <DropdownMenuItem
            onClick={() => {
              suppressFileMenuReturnFocusRef.current = true;
              setTitleDraft(design.title);
              setTitleEditing(true);
            }}
          >
            {t("designEditor.fileMenu.rename")}
          </DropdownMenuItem>
          {shouldShowFullDesignProjectMenu(widgetEmbed) ? (
            <>
              <DropdownMenuItem
                onClick={handleDuplicateDesign}
                disabled={duplicateDesignMutation.isPending}
              >
                {t("designEditor.fileMenu.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                {t("designEditor.fileMenu.versionHistory")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSaveTemplateOpen(true)}
                disabled={files.length === 0}
              >
                {t("designEditor.saveAsTemplate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => importFileInputRef.current?.click()}
              >
                {t("designEditor.fileMenu.import")}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("designEditor.export")}
                </DropdownMenuSubTrigger>
                <ExportSubmenuContent
                  editorCore={editorCore}
                  editorGenerationAndAccess={editorGenerationAndAccess}
                  editorFilesAndSaving={editorFilesAndSaving}
                  editorActiveScreenAndGeometry={editorActiveScreenAndGeometry}
                  editorExportAndHandoff={editorExportAndHandoff}
                />
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setTrashDialogOpen(true)}
                disabled={!canShareDesign}
              >
                {t("designEditor.fileMenu.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={importFileInputRef}
        type="file"
        accept=".fig,.html,.htm"
        className="hidden"
        onChange={handleImportFileChange}
      />
      <AlertDialog open={trashDialogOpen} onOpenChange={setTrashDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.deleteDesignTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("home.deleteDesignDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              {t("home.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMoveToTrash}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function renderProjectTitleControl(props: ProjectTitleControlProps) {
  return <ProjectTitleControl {...props} />;
}
