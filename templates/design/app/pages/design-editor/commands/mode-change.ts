import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import { resolveInteractEntry } from "@/pages/design-editor/interact-entry";
import type {
  PendingLiveNonStyleEdit,
  PendingVisualStyleEdit,
} from "@/pages/design-editor/pending-edits";
import {
  resolveModeChangeView,
  resolveModeForAnnotateLab,
  type AnnotateLabStatus,
} from "@/pages/design-editor/tool-state";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export interface ModeChangeArgs {
  activeFile: DesignFile;
  annotateLab: AnnotateLabStatus;
  canEditDesign: boolean;
  hasPendingVisualEdits?: boolean;
  onPendingVisualEditsBlocked: () => void;
  clearPendingLiveEditState: () => void;
  enterOverviewFromZoom: (nextMode?: EditorMode) => void;
  enterSingleScreen: (
    fileId?: string | null,
    options?: { keepInteractDevice?: boolean },
  ) => void;
  files: DesignFile[];
  pendingLiveNonStyleEdits: PendingLiveNonStyleEdit[];
  pendingVisualStyleEdits: PendingVisualStyleEdit[];
  requestPendingLiveNonStyleRevert: (
    edits: readonly PendingLiveNonStyleEdit[],
  ) => void;
  requestPendingVisualStyleRevert: (
    edits: readonly PendingVisualStyleEdit[],
  ) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setDrawMode: Dispatch<SetStateAction<boolean>>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setPinMode: Dispatch<SetStateAction<boolean>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  rememberOverviewScreenSelection: (screenId: string) => void;
  /** The design's pages in canvas order: the only screens Interact can open. */
  overviewScreens: readonly { id: string }[];
  overviewSelectedScreenIds: readonly string[];
  hiddenScreenIds: ReadonlySet<string>;
  /** The page an element is selected in; null with no element selected. */
  selectionScreenId: string | null;
  overviewInteractScreenId: string | null;
  setOverviewInteractScreenId: Dispatch<SetStateAction<string | null>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runModeChange(
  {
    activeFile,
    annotateLab,
    canEditDesign,
    clearPendingLiveEditState,
    onPendingVisualEditsBlocked,
    enterOverviewFromZoom,
    enterSingleScreen,
    files,
    hasPendingVisualEdits = false,
    pendingLiveNonStyleEdits,
    pendingVisualStyleEdits,
    requestPendingLiveNonStyleRevert,
    requestPendingVisualStyleRevert,
    setActiveFileId,
    setActiveTool,
    setDrawMode,
    setMode,
    setPinMode,
    setSelectedElement,
    rememberOverviewScreenSelection,
    overviewScreens,
    overviewSelectedScreenIds,
    hiddenScreenIds,
    selectionScreenId,
    overviewInteractScreenId,
    setOverviewInteractScreenId,
    t,
    viewModeRef,
  }: ModeChangeArgs,
  requested: EditorMode,
  options?: {
    discardPendingLiveEdits?: boolean;
    pendingLiveEditsAlreadyHandled?: boolean;
    targetFileId?: string;
    /** A screen change made from inside Interact keeps the chosen device. */
    keepInteractDevice?: boolean;
  },
) {
  const next = resolveModeForAnnotateLab(requested, annotateLab);
  const interactEntry =
    next === "interact"
      ? resolveInteractEntry({
          requestedScreenId: options?.targetFileId,
          // A focused screen is the one in view, whatever the overview kept selected.
          selectedScreenIds:
            viewModeRef.current === "single" && activeFile
              ? [activeFile.id]
              : overviewSelectedScreenIds,
          selectionScreenId,
          screens: overviewScreens,
          hiddenScreenIds,
        })
      : null;
  const nextActiveFile = interactEntry
    ? interactEntry.kind === "screen"
      ? files.find((file) => file.id === interactEntry.screenId)
      : undefined
    : options?.targetFileId
      ? files.find((file) => file.id === options.targetFileId)
      : activeFile;
  if (!canEditDesign && next === "annotate") return;
  if (interactEntry && !nextActiveFile) {
    toast.error(
      t(
        interactEntry.kind === "none" && interactEntry.reason === "no-pages"
          ? "designEditor.responsiveInteract.noPages"
          : "designEditor.responsiveInteract.unknownPage",
      ),
    );
    return;
  }
  if (next === "annotate" && !nextActiveFile) return;
  if (
    next === "interact" &&
    hasPendingVisualEdits &&
    !options?.discardPendingLiveEdits &&
    !options?.pendingLiveEditsAlreadyHandled
  ) {
    onPendingVisualEditsBlocked();
    toast.error(t("designEditor.pendingVisualStyles.interactBlocked"));
    return;
  }
  if (options?.discardPendingLiveEdits) {
    requestPendingVisualStyleRevert(pendingVisualStyleEdits);
    requestPendingLiveNonStyleRevert(pendingLiveNonStyleEdits);
    clearPendingLiveEditState();
  }

  const routing = resolveModeChangeView({
    next,
    viewMode: viewModeRef.current,
  });
  if (routing === "enter-single-interact") {
    rememberOverviewScreenSelection(nextActiveFile!.id);
    setOverviewInteractScreenId(nextActiveFile!.id);
    enterSingleScreen(nextActiveFile?.id);
    return;
  }
  if (routing === "enter-overview") {
    setOverviewInteractScreenId(null);
    if (options?.targetFileId) setActiveFileId(options.targetFileId);
    enterOverviewFromZoom(next);
    return;
  }
  if (next === "interact" && overviewInteractScreenId) {
    setOverviewInteractScreenId(nextActiveFile!.id);
    if (
      options?.targetFileId &&
      nextActiveFile!.id !== overviewInteractScreenId
    ) {
      rememberOverviewScreenSelection(nextActiveFile!.id);
      if (options.keepInteractDevice) {
        enterSingleScreen(nextActiveFile!.id, { keepInteractDevice: true });
      } else {
        enterSingleScreen(nextActiveFile!.id);
      }
      return;
    }
  }
  if (options?.targetFileId) setActiveFileId(options.targetFileId);
  else if (
    next === "interact" &&
    nextActiveFile &&
    nextActiveFile.id !== activeFile?.id
  ) {
    setActiveFileId(nextActiveFile.id);
  }
  setMode(next);
  setSelectedElement(null);

  if (next === "annotate") {
    setActiveTool("draw");
    setDrawMode(true);
    setPinMode(false);
  } else if (next === "interact") {
    setActiveTool("move");
    setDrawMode(false);
    setPinMode(false);
  } else {
    setActiveTool("move");
    setDrawMode(false);
    setPinMode(false);
  }
}
