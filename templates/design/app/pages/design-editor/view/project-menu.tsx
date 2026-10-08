import {
  IconArrowLeft,
  IconTemplate,
  IconHistory,
  IconFileExport,
  IconPencil,
  IconLayoutGrid,
  IconPin,
  IconKeyboard,
  IconRocket,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorClipboard } from "../domains/use-editor-clipboard";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorEditCommands } from "../domains/use-editor-edit-commands";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorLayoutAndStructure } from "../domains/use-editor-layout-and-structure";
import type { EditorLiveEditsAndPresence } from "../domains/use-editor-live-edits-and-presence";
import type { EditorModes } from "../domains/use-editor-modes";
import { overviewSelectionTargetsElement } from "../selection-state";
import { ExportSubmenuContent } from "./export-submenu-content";

export function renderProjectMenu({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorLiveEditsAndPresence,
  editorClipboard,
  editorLayoutAndStructure,
  editorEditCommands,
  editorModes,
  editorExportAndHandoff,
  id,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorLiveEditsAndPresence: EditorLiveEditsAndPresence;
  editorClipboard: EditorClipboard;
  editorLayoutAndStructure: EditorLayoutAndStructure;
  editorEditCommands: EditorEditCommands;
  editorModes: EditorModes;
  editorExportAndHandoff: EditorExportAndHandoff;
  id: string;
}) {
  const { t, viewMode, shortcut, selectedElement, isSignedIn } = editorCore;
  const { canUndo, canRedo, overviewSelectedScreenIds, selectedLayerIdsState } =
    editorHistory;
  const { canEditDesign, canCommentDesign, pinMode } =
    editorGenerationAndAccess;
  const { files, overviewScreens } = editorFilesAndSaving;
  const { activeFile, handleZoomOut, handleZoomIn, handleOpenMakeReal } =
    editorActiveScreenAndGeometry;
  const { setSaveTemplateOpen } = editorLiveEditsAndPresence;
  const { handleDuplicateSelection, handleDeleteSelection } = editorClipboard;
  const { setHistoryOpen } = editorLayoutAndStructure;
  const { handleDeleteOverviewSelection } = editorEditCommands;
  const {
    projectMenuTriggerRef,
    suppressProjectMenuReturnFocusRef,
    handleUndo,
    handleRedo,
    handleViewModeToggle,
    handlePinToolToggle,
    handleShowKeyboardShortcutsFromMenu,
  } = editorModes;
  const {} = editorExportAndHandoff;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={projectMenuTriggerRef}
          variant="ghost"
          size="icon-sm"
          className="shrink-0 cursor-pointer rounded-md text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-[calc(var(--spacing)*5.5)]"
          aria-label={t("designEditor.more")}
        >
          <AgentNativeMenuMark className="size-[calc(var(--spacing)*5.5)] text-foreground dark:text-white" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="design-editor-app-menu-content w-64"
        onCloseAutoFocus={(event) => {
          if (!suppressProjectMenuReturnFocusRef.current) return;
          event.preventDefault();
          suppressProjectMenuReturnFocusRef.current = false;
        }}
      >
        <DropdownMenuItem asChild>
          <Link to="/home">
            <IconArrowLeft className="h-4 w-4" />
            {t("designEditor.backToDesigns")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setSaveTemplateOpen(true)}
          disabled={!canEditDesign || files.length === 0}
        >
          <IconTemplate className="h-4 w-4" />
          {t("designEditor.saveAsTemplate")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setHistoryOpen(true)} disabled={!id}>
          <IconHistory className="h-4 w-4" />
          {"Version history" /* i18n-ignore */}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconFileExport className="h-4 w-4" />
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
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconPencil className="h-4 w-4" />
            {t("designEditor.modes.edit")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleUndo} disabled={!canUndo}>
              {t("designEditor.undo")}
              <DropdownMenuShortcut>{shortcut("$mod+z")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRedo} disabled={!canRedo}>
              {t("designEditor.redo")}
              <DropdownMenuShortcut>
                {shortcut("$mod+shift+z")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDuplicateSelection}
              disabled={!activeFile}
            >
              {"Duplicate" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>{shortcut("$mod+d")}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                if (viewMode === "overview") {
                  handleDeleteOverviewSelection(overviewSelectedScreenIds);
                } else {
                  handleDeleteSelection();
                }
              }}
              disabled={
                viewMode === "overview"
                  ? !overviewSelectionTargetsElement({
                      selectedElement,
                      selectedLayerIds: selectedLayerIdsState,
                      fileIds: files.map((file) => file.id),
                    }) &&
                    (overviewScreens.length <= 1 ||
                      overviewSelectedScreenIds.length === 0)
                  : !selectedElement && !activeFile
              }
            >
              {"Delete" /* i18n-ignore design menu command */}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <IconLayoutGrid className="h-4 w-4" />
            {"View" /* i18n-ignore design menu section */}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-52">
            <DropdownMenuItem onClick={handleViewModeToggle}>
              {viewMode === "overview"
                ? t("designEditor.currentScreen")
                : t("designEditor.screenOverview")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleZoomOut}>
              {t("designEditor.zoomOut")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleZoomIn}>
              {t("designEditor.zoomIn")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onClick={handlePinToolToggle}
          disabled={!activeFile || !canCommentDesign}
        >
          <IconPin className="h-4 w-4" />
          {pinMode
            ? t("designEditor.stopPinningComments")
            : t("designEditor.pinComment")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleShowKeyboardShortcutsFromMenu}>
          <IconKeyboard className="h-4 w-4" />
          {t("designEditor.keyboardShortcuts.title")}
          <DropdownMenuShortcut>
            {/* Control, not Command: ⌘⇧? is the macOS Help-menu shortcut and
                the browser consumes it before the page ever sees it. */}
            {shortcut("ctrl+shift+?")}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {isSignedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                handleOpenMakeReal();
              }}
            >
              <IconRocket className="h-4 w-4" />
              {"Make this a real app" /* i18n-ignore */}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
