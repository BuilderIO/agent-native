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
  /** Decides whether this write is the creation's first commit BEFORE the
   *  content is applied, and hands back a `confirm` the caller runs only once
   *  that publication is accepted. */
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
    // Queued against the running app: accepted, just not via a source write.
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
  // An x-text row shows a value from the collection, so its text has one home:
  // the item. A markup edit changes nothing — the next render puts the data
  // back. Read from the projection, not from the bridge payload, so this does
  // not depend on which bridge build the iframe happens to be running.
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
  // Figma names a freshly typed text layer after its own content. The
  // primitive is drawn with an empty draft (primitiveLayerName's text case
  // stamps the "Text" placeholder), so the real name is only knowable once
  // this — the creation's first content commit — lands. Computed eagerly but
  // only ever applied below when finalizePendingTextCreation confirms this
  // commit really is that first commit, so editing an already-named text
  // layer later never re-syncs its name to its content.
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
    // A snapshot that vanished, or an integrity check that rejected this edit,
    // leaves the source unchanged — consuming the creation's pending history
    // here would spend it on a write that never happened.
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
    // A refused publication never wrote this text. Finalizing before it landed
    // consumed the creation's pending history and left the typed text nowhere:
    // keep the record so the retry still coalesces into one undo step.
    if (publication.status !== "accepted") return "refused";
  }
  finalizedCreation.confirm();
  // T8: committing text editing should return to the move tool (matches
  // the creation path, which already does this), not re-arm the text
  // tool — re-arming it meant every subsequent click anywhere on the
  // canvas started ANOTHER new text box instead of selecting/moving.
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
