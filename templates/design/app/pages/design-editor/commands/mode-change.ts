import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type {
  PendingLiveNonStyleEdit,
  PendingVisualStyleEdit,
} from "@/pages/design-editor/pending-edits";
import { resolveModeChangeView } from "@/pages/design-editor/tool-state";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export interface ModeChangeArgs {
  activeFile: DesignFile;
  canEditDesign: boolean;
  clearPendingLiveEditState: () => void;
  enterOverviewFromZoom: (nextMode?: EditorMode) => void;
  enterSingleScreen: (fileId?: string | null) => void;
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
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runModeChange(
  {
    activeFile,
    canEditDesign,
    clearPendingLiveEditState,
    enterOverviewFromZoom,
    enterSingleScreen,
    files,
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
    t,
    viewModeRef,
  }: ModeChangeArgs,
  next: EditorMode,
  options?: {
    discardPendingLiveEdits?: boolean;
    pendingLiveEditsAlreadyHandled?: boolean;
    targetFileId?: string;
  },
) {
  const nextActiveFile = options?.targetFileId
    ? files.find((file) => file.id === options.targetFileId)
    : activeFile;
  if (!canEditDesign && next === "annotate") return;
  if ((next === "annotate" || next === "interact") && !nextActiveFile) {
    return;
  }
  if (
    next === "interact" &&
    (pendingVisualStyleEdits.length > 0 ||
      pendingLiveNonStyleEdits.length > 0) &&
    !options?.discardPendingLiveEdits &&
    !options?.pendingLiveEditsAlreadyHandled
  ) {
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
    enterSingleScreen(nextActiveFile?.id);
    return;
  }
  if (routing === "enter-overview") {
    if (options?.targetFileId) setActiveFileId(options.targetFileId);
    enterOverviewFromZoom(next);
    return;
  }
  if (options?.targetFileId) setActiveFileId(options.targetFileId);
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
