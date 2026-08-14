import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { MoveNodeEditIntent } from "@shared/code-layer";
import { applyVisualEdit } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { trace } from "@/components/design/design-trace";
import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { SelectedLayerTarget } from "@/pages/design-editor/code-layer-state";
import {
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  cloneCanvasFrameGeometry,
  getCanvasFrameGeometry,
} from "@/pages/design-editor/design-data-geometry-utils";
import type { DesignEditorPreferences } from "@/pages/design-editor/editor-preferences";
import {
  resolveElementNudgeIntent,
  resolveNudgeIntent,
} from "@/pages/design-editor/nudge-intent";
import { overviewSelectionTargetsElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface NudgeSelectionArgs {
  activeFile: DesignFile;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  boardFileId: string | undefined;
  boardFrameGeometry: FrameGeometry | undefined;
  canEditDesign: boolean;
  commitVisualStyles: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      runtimeApplied?: boolean;
      elementInfo?: ElementInfo;
      originalStyles?: Record<string, string>;
    },
  ) => void;
  designDataJsonRef: RefObject<Record<string, unknown>>;
  editorPreferences: DesignEditorPreferences;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  handleGeometryCommit: (
    before: CanvasFrameGeometryById,
    after: CanvasFrameGeometryById,
    options?: { source?: "pointer" | "keyboard" },
  ) => void;
  hideSelectionChromeForNudge: () => void;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  selectedLayerTargetsRef: RefObject<SelectedLayerTarget[]>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runNudgeSelection(
  {
    activeFile,
    applyLocalContentUpdate,
    boardFileId,
    boardFrameGeometry,
    canEditDesign,
    commitVisualStyles,
    designDataJsonRef,
    editorPreferences,
    files,
    getFreshActiveContent,
    handleGeometryCommit,
    hideSelectionChromeForNudge,
    overviewScreens,
    overviewSelectedScreenIds,
    selectedElement,
    selectedLayerIdsState,
    selectedLayerTargetsRef,
    setSelectedElement,
    setSelectedLayerIdsState,
    viewModeRef,
  }: NudgeSelectionArgs,
  direction: "up" | "right" | "down" | "left",
  largeStep: boolean,
) {
  trace("structure", "nudge", { direction, largeStep });
  if (!canEditDesign) return;
  const nudgeAmounts = editorPreferences.nudge;
  const freeTranslation = resolveNudgeIntent({
    direction,
    largeStep,
    amounts: nudgeAmounts,
  });
  const dx = freeTranslation.kind === "translate" ? freeTranslation.dx : 0;
  const dy = freeTranslation.kind === "translate" ? freeTranslation.dy : 0;

  // Screen frames nudge through the same geometry-commit path mouse-drag
  // uses, so a held arrow key gets handleGeometryCommit's ~800ms undo
  // coalescing instead of one history entry per keypress.
  if (
    viewModeRef.current === "overview" &&
    overviewSelectedScreenIds.length > 0 &&
    !overviewSelectionTargetsElement({
      selectedElement,
      selectedLayerIds: selectedLayerIdsState,
      fileIds: files.map((file) => file.id),
    })
  ) {
    const before = getCanvasFrameGeometry(designDataJsonRef.current);
    const after = cloneCanvasFrameGeometry(before);
    let changed = false;
    overviewSelectedScreenIds.forEach((screenId) => {
      const screenIndex = overviewScreens.findIndex(
        (screen) => screen.id === screenId,
      );
      const screen =
        screenIndex >= 0 ? overviewScreens[screenIndex] : undefined;
      const fallbackGeometry =
        screenIndex >= 0
          ? getInitialFrameGeometry(screenIndex, {
              width: screen?.width ?? 1280,
              height: screen?.height ?? 2560,
            })
          : boardFileId === screenId
            ? boardFrameGeometry
            : undefined;
      if (!fallbackGeometry) return;
      const current = { ...fallbackGeometry, ...before[screenId] };
      after[screenId] = {
        ...current,
        x: current.x + dx,
        y: current.y + dy,
      };
      changed = true;
    });
    if (changed) {
      handleGeometryCommit(before, after, { source: "keyboard" });
    }
    return;
  }

  // Selecting in the layers tree fills selectedLayerTargets before the
  // bridge round-trip fills selectedElement, so keying off the latter
  // alone silently drops the first nudge after every tree selection.
  const nudgeTarget = selectedElement?.selector
    ? selectedElement
    : selectedLayerTargetsRef.current[0]?.elementInfo;
  if (!nudgeTarget?.selector) return;

  const intent = resolveElementNudgeIntent({
    content: activeFile ? getFreshActiveContent() : "",
    selectedElement: nudgeTarget,
    direction,
    largeStep,
    amounts: nudgeAmounts,
  });
  if (intent.kind === "none") return;
  if (intent.kind === "reorder") {
    const patch = applyVisualEdit(intent.content, {
      kind: "moveNode",
      target: { nodeId: intent.targetNodeId },
      anchor: { nodeId: intent.anchorNodeId },
      placement: intent.placement,
    } satisfies MoveNodeEditIntent);
    if (patch.result.status !== "applied") return;
    applyLocalContentUpdate(patch.content, { skipPreview: true });
    // A node with no stable `data-agent-native-node-id` has its id derived
    // from path/offset, and the move changes both — so the pre-move id
    // finds nothing and the selection has to be re-resolved by identity.
    const movedNode =
      patch.projection.nodes.find(
        (node) =>
          node.id === intent.targetNodeId ||
          node.dataAttributes["data-agent-native-node-id"] ===
            intent.targetNodeId,
      ) ??
      resolveCodeLayerNodeFromElementInfo(patch.projection, selectedElement);
    if (movedNode) {
      setSelectedElement(elementInfoFromCodeLayerNode(movedNode));
      setSelectedLayerIdsState([movedNode.id]);
    }
    return;
  }

  hideSelectionChromeForNudge();
  const left = parseFloat(nudgeTarget.computedStyles.left || "0") || 0;
  const top = parseFloat(nudgeTarget.computedStyles.top || "0") || 0;
  commitVisualStyles(nudgeTarget.selector, {
    position:
      nudgeTarget.computedStyles.position === "static"
        ? "relative"
        : nudgeTarget.computedStyles.position || "relative",
    left: `${Math.round(left + intent.dx)}px`,
    top: `${Math.round(top + intent.dy)}px`,
  });
}
