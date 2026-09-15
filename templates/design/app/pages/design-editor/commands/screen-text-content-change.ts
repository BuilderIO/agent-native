import {
  applyVisualEdit,
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { normalizeDesignSourceType } from "@shared/source-mode";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerNodeMatchesBridgeTarget,
  codeLayerPatchMessage,
  preferredCodeLayerSelector,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { LiveScreenSnapshot } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { updateElementContentInHtml } from "@/pages/design-editor/text-edit-utils";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export interface ScreenTextContentChangeArgs {
  activeFile: DesignFile;
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
  ) => void;
  canEditDesign: boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  finalizePendingTextCreation: (
    fileId: string,
    nodeIds: readonly (string | null | undefined)[],
    finalContent: string,
  ) => boolean;
  getScreenContent: (screenId: string) => string;
  handleTextContentChange: (
    selector: string,
    value: string,
    elementInfo?: ElementInfo,
    details?: { html?: string; originalValue?: string; originalHtml?: string },
  ) => void;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  overviewScreens: OverviewScreen[];
  recordPendingLiveTextEdit: (
    screenId: string,
    selector: string,
    value: string,
    elementInfo?: ElementInfo,
    details?: { html?: string; originalValue?: string; originalHtml?: string },
  ) => void;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
}

export function runScreenTextContentChange(
  {
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    designSourceType,
    finalizePendingTextCreation,
    getScreenContent,
    handleTextContentChange,
    liveScreenSnapshotsById,
    overviewScreens,
    recordPendingLiveTextEdit,
    setActiveFileId,
    setActiveTool,
    setMode,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    updateLiveScreenSnapshotContent,
  }: ScreenTextContentChangeArgs,
  screenId: string,
  selector: string,
  value: string,
  elementInfo?: ElementInfo,
  details?: {
    html?: string;
    originalValue?: string;
    originalHtml?: string;
  },
) {
  if (screenId === activeFile?.id) {
    handleTextContentChange(selector, value, elementInfo, details);
    return;
  }
  if (!canEditDesign) return;
  const overviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const screenSourceType =
    normalizeDesignSourceType(overviewScreen?.sourceType) ?? designSourceType;
  if (screenSourceType === "localhost") {
    recordPendingLiveTextEdit(screenId, selector, value, elementInfo, details);
    setActiveFileId(screenId);
    setActiveTool("move");
    setMode("edit");
    return;
  }
  const liveSnapshot = liveScreenSnapshotsById[screenId];
  const baseContent = liveSnapshot?.html ?? getScreenContent(screenId);
  const projection = buildCodeLayerProjection(baseContent);
  const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
  const targetNode = targetInfo
    ? resolveCodeLayerNodeFromElementInfo(projection, targetInfo)
    : resolveCodeLayerNodeFromBridge(projection, selector);
  const isEmpty = value.trim().length === 0;
  const removedContent =
    isEmpty && targetNode
      ? removeCodeLayerNodeFromHtml(baseContent, targetNode)
      : null;
  const patch = !removedContent
    ? applyVisualEdit(baseContent, {
        kind: "textContent",
        target: targetNode ? { nodeId: targetNode.id } : { selector },
        value,
        html: details?.html,
      })
    : null;
  const nextContent =
    removedContent ??
    (patch?.result.status === "applied" ? patch.content : null) ??
    updateElementContentInHtml(baseContent, selector, value, details?.html);
  if (!nextContent) {
    toast.error(
      codeLayerPatchMessage(
        patch?.result.message,
        t("designEditor.patchProof.selectorMissing"),
      ),
      { duration: 4000 },
    );
    return;
  }
  const finalizedCreation = finalizePendingTextCreation(
    screenId,
    [
      elementInfo?.sourceId,
      targetNode?.id,
      targetNode ? bridgeSourceIdForCodeLayerNode(targetNode) : null,
    ],
    nextContent,
  );
  if (liveSnapshot) {
    updateLiveScreenSnapshotContent(screenId, nextContent, {
      recordHistory: !finalizedCreation,
    });
  } else {
    applyFileContentUpdate(screenId, nextContent, {
      skipPreview: true,
      recordHistory: !finalizedCreation,
    });
  }
  setActiveFileId(screenId);
  // T8: see the matching note in handleTextContentChange — commit
  // should hand back to the move tool, not re-arm text.
  setActiveTool("move");
  setMode("edit");
  if (removedContent) {
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    return;
  }
  const nextProjection = buildCodeLayerProjection(nextContent);
  const nextNode = targetNode
    ? nextProjection.nodes.find((node) =>
        codeLayerNodeMatchesBridgeTarget(
          node,
          selector,
          bridgeSourceIdForCodeLayerNode(targetNode),
        ),
      )
    : null;
  if (nextNode) setSelectedLayerIdsState([nextNode.id]);
  setSelectedElement((previous) => {
    const base =
      elementInfo ?? (previous?.selector === selector ? previous : undefined);
    return base
      ? {
          ...base,
          sourceId: nextNode
            ? bridgeSourceIdForCodeLayerNode(nextNode)
            : base.sourceId,
          selector: nextNode ? preferredCodeLayerSelector(nextNode) : selector,
          textContent: value.slice(0, 200),
          htmlContent: details?.html,
        }
      : previous;
  });
}
