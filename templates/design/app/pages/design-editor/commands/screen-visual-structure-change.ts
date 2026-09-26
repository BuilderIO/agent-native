import type { Dispatch, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
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
  canEditLiveScreen?: (screenId: string) => boolean;
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
      transactionId?: string;
      routePath?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      gridPlacement?: {
        column: number;
        columnEnd: number;
        row: number;
        rowEnd: number;
      };
      gridDisplacements?: Array<{
        sourceId?: string;
        selector?: string;
        placement: {
          column: number;
          columnEnd: number;
          row: number;
          rowEnd: number;
        };
      }>;
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
      transactionId?: string;
      routePath?: string;
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
    canEditLiveScreen,
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
    transactionId?: string;
    routePath?: string;
    dropMode?: "flow-insert" | "absolute-container";
    forceFlowPositionOverride?: boolean;
    sourceRect?: { x: number; y: number; width: number; height: number };
    anchorRect?: { x: number; y: number; width: number; height: number };
    gridPlacement?: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
    gridDisplacements?: Array<{
      sourceId?: string;
      selector?: string;
      placement: {
        column: number;
        columnEnd: number;
        row: number;
        rowEnd: number;
      };
    }>;
    insertedHtml?: string;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
    replacementElementInfo?: ElementInfo;
    replacementSnapshotHtml?: string;
  },
) {
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType = resolveOverviewScreenSourceType(
    overviewScreen,
    designSourceType,
  );
  const canEditScreen =
    canEditDesign ||
    (screenSourceType === "localhost" && canEditLiveScreen?.(screenId));
  if (screenId === activeFile?.id) {
    if (!canEditScreen) return false;
    return handleVisualStructureChange(
      selector,
      anchorSelector,
      placement,
      elementInfo,
      details,
    );
  }
  if (!canEditScreen) return false;
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
      canEditDesign: canEditScreen,
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
