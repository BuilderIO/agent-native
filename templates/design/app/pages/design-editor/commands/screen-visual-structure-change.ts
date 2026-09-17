import { normalizeDesignSourceType } from "@shared/source-mode";
import type { Dispatch, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { ApplyLinkedComponentEdit } from "./linked-component-structure";
import { runVisualStructureChange } from "./visual-structure-change";

export interface ScreenVisualStructureChangeArgs {
  activeFile: DesignFile;
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  canEditDesign: boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getScreenContent: (screenId: string) => string;
  handleVisualStructureChange: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    elementInfo?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      insertedHtml?: string;
      replaced?: true;
      replacementSelector?: string;
      replacementSourceId?: string;
      replacementElementInfo?: ElementInfo;
      replacementSnapshotHtml?: string;
    },
  ) => boolean | "pending";
  overviewScreens: OverviewScreen[];
  recordPendingLiveStructureEdit: (
    screenId: string,
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    elementInfo?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      insertedHtml?: string;
      replaced?: true;
      replacementSelector?: string;
      replacementSourceId?: string;
      replacementElementInfo?: ElementInfo;
      replacementSnapshotHtml?: string;
      removed?: true;
    },
  ) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runScreenVisualStructureChange(
  {
    activeFile,
    applyFileContentUpdate,
    applyLinkedComponentEdit,
    canEditDesign,
    designSourceType,
    getScreenContent,
    handleVisualStructureChange,
    overviewScreens,
    recordPendingLiveStructureEdit,
    setActiveFileId,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
  }: ScreenVisualStructureChangeArgs,
  screenId: string,
  selector: string,
  anchorSelector: string,
  placement: "before" | "after" | "inside",
  elementInfo?: ElementInfo,
  details?: {
    sourceId?: string;
    anchorSourceId?: string;
    anchorElementInfo?: ElementInfo;
    requestId?: string;
    dropMode?: "flow-insert" | "absolute-container";
    forceFlowPositionOverride?: boolean;
    sourceRect?: { x: number; y: number; width: number; height: number };
    anchorRect?: { x: number; y: number; width: number; height: number };
    /** Markup this change introduced; the subject does not exist in the
     * screen's source yet, so it must be added rather than relocated. */
    insertedHtml?: string;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
    replacementElementInfo?: ElementInfo;
    replacementSnapshotHtml?: string;
  },
) {
  if (screenId === activeFile?.id) {
    return handleVisualStructureChange(
      selector,
      anchorSelector,
      placement,
      elementInfo,
      details,
    );
  }
  if (!canEditDesign) return false;
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType =
    normalizeDesignSourceType(overviewScreen?.sourceType) ?? designSourceType;
  const screenFile = {
    ...activeFile,
    id: screenId,
    content: overviewScreen?.content ?? "",
    filename: overviewScreen?.filename ?? activeFile.filename,
    updatedAt: overviewScreen?.updatedAt ?? activeFile.updatedAt,
  };
  const result = runVisualStructureChange(
    {
      activeCanvasSourceType: screenSourceType,
      activeFile: screenFile,
      applyLinkedComponentEdit,
      applyLocalContentUpdate: (nextContent, options) => {
        const publication = applyFileContentUpdate(
          screenId,
          nextContent,
          options,
        );
        return publication.status === "accepted"
          ? publication
          : { status: "refused" as const };
      },
      canEditDesign,
      getFreshActiveContent: () => getScreenContent(screenId),
      recordPendingLiveStructureEdit,
      setSelectedElement,
      setSelectedLayerIdsState,
      t,
    },
    selector,
    anchorSelector,
    placement,
    elementInfo,
    details,
  );
  if (result === true) setActiveFileId(screenId);
  return result;
}
