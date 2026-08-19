import {
  applyVisualEdit,
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
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
import { updateElementContentInHtml } from "@/pages/design-editor/text-edit-utils";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

export interface TextContentChangeArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
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
  canEditDesign: boolean;
  finalizePendingTextCreation: (
    fileId: string,
    nodeIds: readonly (string | null | undefined)[],
    finalContent: string,
  ) => boolean;
  getFreshActiveContent: () => string;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  recordPendingLiveTextEdit: (
    screenId: string,
    selector: string,
    value: string,
    elementInfo?: ElementInfo,
    details?: { html?: string; originalValue?: string; originalHtml?: string },
  ) => void;
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

export function runTextContentChange(
  {
    activeCanvasSourceType,
    activeFile,
    applyLocalContentUpdate,
    canEditDesign,
    finalizePendingTextCreation,
    getFreshActiveContent,
    liveScreenSnapshotsById,
    recordPendingLiveTextEdit,
    setActiveTool,
    setMode,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    updateLiveScreenSnapshotContent,
  }: TextContentChangeArgs,
  selector: string,
  value: string,
  elementInfo?: ElementInfo,
  details?: {
    html?: string;
    originalValue?: string;
    originalHtml?: string;
  },
) {
  if (!canEditDesign) return;
  if (!activeFile) return;
  if (activeCanvasSourceType === "localhost") {
    recordPendingLiveTextEdit(
      activeFile.id,
      selector,
      value,
      elementInfo,
      details,
    );
    setActiveTool("move");
    setMode("edit");
    return;
  }
  const activeLiveSnapshot = liveScreenSnapshotsById[activeFile.id];
  const baseContent = activeLiveSnapshot?.html ?? getFreshActiveContent();
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
    activeFile.id,
    [
      elementInfo?.sourceId,
      targetNode?.id,
      targetNode ? bridgeSourceIdForCodeLayerNode(targetNode) : null,
    ],
    nextContent,
  );
  if (activeLiveSnapshot) {
    updateLiveScreenSnapshotContent(activeFile.id, nextContent, {
      recordHistory: !finalizedCreation,
    });
  } else {
    applyLocalContentUpdate(nextContent, {
      skipPreview: true,
      recordHistory: !finalizedCreation,
    });
  }
  // T8: committing text editing should return to the move tool (matches
  // the creation path, which already does this), not re-arm the text
  // tool — re-arming it meant every subsequent click anywhere on the
  // canvas started ANOTHER new text box instead of selecting/moving.
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
