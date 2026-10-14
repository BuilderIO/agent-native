import { useTheme } from "next-themes";
import { Link } from "react-router";

import { AgentNativeMenuMark } from "@/components/design/editor/AgentNativeMenuMark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import type { EditorSourceAndSync } from "../domains/use-editor-source-and-sync";
import { overviewSelectionTargetsElement } from "../selection-state";
import { ExportSubmenuContent } from "./export-submenu-content";

const DOCS_URL = "https://www.agent-native.com/docs/";
const DISCORD_URL = "https://discord.gg/qm82StQ2NC";

function ThemeRadioItems({ t }: { t: EditorCore["t"] }) {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light" indicator="check">
        {t("designEditor.appMenu.themeLight")}
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark" indicator="check">
        {t("designEditor.appMenu.themeDark")}
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system" indicator="check">
        {t("designEditor.appMenu.themeSystem")}
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

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
  editorSourceAndSync,
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
  editorSourceAndSync: EditorSourceAndSync;
}) {
  const { t, id, viewMode, shortcut, selectedElement, isSignedIn } = editorCore;
  const {
    canUndo,
    canRedo,
    overviewSelectedScreenIds,
    selectedLayerIdsState,
    setMotionDockOpenAnimated,
  } = editorHistory;
  const { canEditDesign, exportZipMutation } = editorGenerationAndAccess;
  const { files } = editorFilesAndSaving;
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
    handleShowKeyboardShortcutsFromMenu,
  } = editorModes;
  const { handleDownloadZip, handleCopyCodingHandoff, codingHandoffLoading } =
    editorExportAndHandoff;
  const { openImportFilePicker } = editorSourceAndSync;

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
        className="design-editor-app-menu-content w-[220px]"
        onCloseAutoFocus={(event) => {
          if (!suppressProjectMenuReturnFocusRef.current) return;
          event.preventDefault();
          suppressProjectMenuReturnFocusRef.current = false;
        }}
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("designEditor.appMenu.file")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-60">
            <DropdownMenuItem asChild>
              <Link to="/home">{t("designEditor.appMenu.newDesign")}</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDownloadZip}
              disabled={!activeFile || exportZipMutation.isPending}
            >
              {t("designEditor.appMenu.saveLocalCopy")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setSaveTemplateOpen(true)}
              disabled={!canEditDesign || files.length === 0}
            >
              {t("designEditor.saveAsTemplate")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setHistoryOpen(true)}
              disabled={!id}
            >
              {t("designEditor.fileMenu.versionHistory")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={openImportFilePicker}
              disabled={!canEditDesign}
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
            <DropdownMenuItem
              onClick={handleCopyCodingHandoff}
              disabled={!activeFile || codingHandoffLoading}
            >
              {t("designEditor.copyCodingHandoff")}
            </DropdownMenuItem>
            {isSignedIn && (
              <DropdownMenuItem onClick={handleOpenMakeReal}>
                {t("designEditor.appMenu.makeAnApp")}
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
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
              {t("designEditor.duplicate")}
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
                    }) && overviewSelectedScreenIds.length === 0
                  : !selectedElement && !activeFile
              }
            >
              {t("designEditor.delete")}
              <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("designEditor.view")}
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
            {editorLiveEditsAndPresence.motionLabEnabled ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setMotionDockOpenAnimated(true)}
                  disabled={!activeFile}
                >
                  {t("designEditor.motion.openDock")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("designEditor.appMenu.preferences")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-60">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t("designEditor.appMenu.theme")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="design-editor-app-menu-content w-[200px]">
                <ThemeRadioItems t={t} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onClick={() => handleShowKeyboardShortcutsFromMenu("search")}
            >
              {t("designEditor.keyboardShortcuts.title")}
              <DropdownMenuShortcut>
                {/* Control, not Command: ⌘⇧? is the macOS Help-menu shortcut and
                      the browser consumes it before the page ever sees it. */}
                {shortcut("ctrl+shift+?")}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleShowKeyboardShortcutsFromMenu("nudge")}
            >
              {t("designEditor.appMenu.nudgeAmount")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t("designEditor.appMenu.help")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="design-editor-app-menu-content w-60">
            <DropdownMenuItem asChild>
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                {t("designEditor.appMenu.docs")}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                {t("designEditor.appMenu.joinDiscord")}
              </a>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
