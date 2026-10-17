import {
  applyVisualEdit,
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { defaultTextLayerName } from "@/pages/design-editor/canvas-primitive-insert";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerNodeMatchesBridgeTarget,
  codeLayerPatchMessage,
  preferredCodeLayerSelector,
  resolveCodeLayerNodeFromBridge,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type {
  LiveScreenSnapshot,
  TextCommitStatus,
} from "@/pages/design-editor/command-types";
import type { PendingTextCreationFinalization } from "@/pages/design-editor/history";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import type { PendingRelativeStyleOperation } from "@/pages/design-editor/pending-edits";
import { updateElementContentInHtml } from "@/pages/design-editor/text-edit-utils";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import { runRepeatItemEdit } from "./repeat-item-edit";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface TextContentChangeArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeFile: DesignFile;
  applyLinkedComponentEdit?: (
    fileId: string,
    nodeId: string,
    edit: { kind: "textContent"; value: string },
  ) => void;
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
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  canEditLiveScreen?: boolean;
  prepareTextCreationFinalization: (
    fileId: string,
    nodeIds: readonly (string | null | undefined)[],
    finalContent: string,
  ) => PendingTextCreationFinalization;
  getFreshActiveContent: () => string;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  recordPendingLiveTextEdit: (
    screenId: string,
    selector: string,
    value: string,
    elementInfo?: ElementInfo,
    details?: {
      html?: string;
      originalValue?: string;
      originalHtml?: string;
      routePath?: string;
      relativeOperations?: Record<string, PendingRelativeStyleOperation>;
    },
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
    applyLinkedComponentEdit,
    applyLocalContentUpdate,
    canEditDesign,
    canEditLiveScreen,
    getFreshActiveContent,
    liveScreenSnapshotsById,
    prepareTextCreationFinalization,
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
    routePath?: string;
    relativeOperations?: Record<string, PendingRelativeStyleOperation>;
  },
): TextCommitStatus {
  if (!canEditDesign && !canEditLiveScreen) return "refused";
  if (!activeFile) return "refused";
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
    return "accepted";
  }
  const activeLiveSnapshot = liveScreenSnapshotsById[activeFile.id];
  const source = activeLiveSnapshot
    ? { kind: "inline-html" as const, fileId: activeFile.id }
    : { kind: "design-file" as const, fileId: activeFile.id };
  const baseContent = activeLiveSnapshot?.html ?? getFreshActiveContent();
  const projection = buildCodeLayerProjection(baseContent, { source });
  const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
  const targetNode = targetInfo
    ? (resolveCodeLayerNodeFromElementInfo(projection, targetInfo) ??
      (elementInfo?.sourceLayerIdentity?.screenId === activeFile.id
        ? (projection.nodes.find(
            (node) => node.id === elementInfo.sourceLayerIdentity?.nodeId,
          ) ?? null)
        : null))
    : resolveCodeLayerNodeFromBridge(projection, selector);
  const repeatXFor = targetNode?.repeatXFor;
  const textBinding =
    typeof targetNode?.attributes["x-text"] === "string"
      ? targetNode.attributes["x-text"]
      : "";
  if (repeatXFor && textBinding) {
    const edit = runRepeatItemEdit({
      content: baseContent,
      target: {
        xFor: repeatXFor,
        itemIndex: elementInfo?.repeat?.itemIndex ?? -1,
        keyExpression: elementInfo?.repeat?.keyExpression,
        itemKey: elementInfo?.repeat?.itemKey,
      },
      operation: { kind: "set-value", binding: textBinding, value },
    });
    if (edit.status === "written") {
      applyLocalContentUpdate(edit.content, {
        forcePreviewFullDocument: true,
      });
      setActiveTool("move");
      setMode("edit");
      return "accepted";
    }
    if (edit.status === "refused") {
      trace("structure", "repeat-item-refused", {
        operation: "set-value",
        reason: edit.reason,
      });
      toast.error(
        t(
          edit.refusal === "no-item"
            ? "designEditor.toasts.repeatRowPickOnCanvas"
            : "designEditor.toasts.repeatListNotEditable",
        ),
      );
      return "refused";
    }
  }
  if (
    activeCanvasSourceType === "inline" &&
    targetNode &&
    linkedComponentRootForNode(targetNode, projection)
  ) {
    const durableNodeId =
      targetNode.dataAttributes["data-agent-native-node-id"];
    if (!durableNodeId || !applyLinkedComponentEdit) {
      toast.error(t("designEditor.patchProof.selectorMissing"), {
        duration: 4000,
      });
      return "refused";
    }
    applyLinkedComponentEdit(activeFile.id, durableNodeId, {
      kind: "textContent",
      value,
    });
    setActiveTool("move");
    setMode("edit");
    return "accepted";
  }
  const isEmpty = value.trim().length === 0;
  const removedContent =
    isEmpty && targetNode
      ? removeCodeLayerNodeFromHtml(baseContent, targetNode)
      : null;
  const patch = !removedContent
    ? applyVisualEdit(
        baseContent,
        {
          kind: "textContent",
          target: targetNode ? { nodeId: targetNode.id } : { selector },
          value,
          html: details?.html,
        },
        { source },
      )
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
    return "refused";
  }
  const nextProjection = buildCodeLayerProjection(nextContent, { source });
  const nextNode = targetNode
    ? nextProjection.nodes.find((node) =>
        codeLayerNodeMatchesBridgeTarget(
          node,
          selector,
          bridgeSourceIdForCodeLayerNode(targetNode),
        ),
      )
    : null;
  const namedContent = nextNode
    ? (setCodeLayerAttributeInHtml(
        nextContent,
        nextNode,
        "data-agent-native-layer-name",
        defaultTextLayerName(value),
      ) ?? nextContent)
    : nextContent;
  const finalizedCreation = prepareTextCreationFinalization(
    activeFile.id,
    [
      elementInfo?.sourceId,
      targetNode?.id,
      targetNode ? bridgeSourceIdForCodeLayerNode(targetNode) : null,
    ],
    namedContent,
  );
  const contentToApply = finalizedCreation.isCreationCommit
    ? namedContent
    : nextContent;
  let publication: ApplyLocalContentUpdateResult | null = null;
  if (activeLiveSnapshot) {
    if (
      !updateLiveScreenSnapshotContent(activeFile.id, contentToApply, {
        recordHistory: !finalizedCreation.historyHandled,
      })
    ) {
      return "refused";
    }
  } else {
    publication = applyLocalContentUpdate(contentToApply, {
      skipPreview: true,
      recordHistory: !finalizedCreation.historyHandled,
    });
    if (publication.status !== "accepted") return "refused";
  }
  finalizedCreation.confirm();
  setActiveTool("move");
  setMode("edit");
  if (removedContent) {
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    return "accepted";
  }
  let selectedNode = nextNode;
  if (publication) {
    const submittedProjection = buildCodeLayerProjection(contentToApply, {
      source,
    });
    const submittedNode = targetNode
      ? submittedProjection.nodes.find((node) =>
          codeLayerNodeMatchesBridgeTarget(
            node,
            selector,
            bridgeSourceIdForCodeLayerNode(targetNode),
          ),
        )
      : null;
    selectedNode = mapAcceptedSelectionNode(
      publication,
      projectAcceptedSource(publication, source),
      submittedNode,
    );
  }
  if (selectedNode) setSelectedLayerIdsState([selectedNode.id]);
  setSelectedElement((previous) => {
    const base =
      elementInfo ?? (previous?.selector === selector ? previous : undefined);
    return base
      ? {
          ...base,
          sourceId: selectedNode
            ? bridgeSourceIdForCodeLayerNode(selectedNode)
            : base.sourceId,
          selector: selectedNode
            ? preferredCodeLayerSelector(selectedNode)
            : selector,
          sourceLayerIdentity: selectedNode
            ? { screenId: activeFile.id, nodeId: selectedNode.id }
            : base.sourceLayerIdentity,
          textContent: value.slice(0, 200),
          htmlContent: details?.html,
        }
      : previous;
  });
  return "accepted";
}
