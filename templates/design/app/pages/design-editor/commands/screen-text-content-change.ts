import {
  applyVisualEdit,
  buildCodeLayerProjection,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

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
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { PendingTextCreationFinalization } from "@/pages/design-editor/history";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import type { PendingRelativeStyleOperation } from "@/pages/design-editor/pending-edits";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import { updateElementContentInHtml } from "@/pages/design-editor/text-edit-utils";
import type {
  DesignFile,
  DesignTool,
  EditorMode,
} from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { LinkedComponentEdit } from "./linked-component-mutation";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

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
  ) => ApplyFileContentUpdateResult;
  applyLinkedComponentEdit?: (
    fileId: string,
    nodeId: string,
    edit: LinkedComponentEdit,
  ) => void;
  canEditDesign: boolean;
  canEditLiveScreen?: (screenId: string) => boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  /** Decides whether this write is the creation's first commit BEFORE the
   *  content is applied, and hands back a `confirm` the caller runs only once
   *  that publication is accepted. */
  prepareTextCreationFinalization: (
    fileId: string,
    nodeIds: readonly (string | null | undefined)[],
    finalContent: string,
  ) => PendingTextCreationFinalization;
  getScreenContent: (screenId: string) => string;
  handleTextContentChange: (
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
  ) => TextCommitStatus;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  overviewScreens: OverviewScreen[];
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
    applyLinkedComponentEdit,
    canEditDesign,
    canEditLiveScreen,
    designSourceType,
    prepareTextCreationFinalization,
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
    routePath?: string;
    relativeOperations?: Record<string, PendingRelativeStyleOperation>;
  },
): TextCommitStatus {
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
    if (!canEditScreen) return "refused";
    return handleTextContentChange(selector, value, elementInfo, details);
  }
  if (!canEditScreen) return "refused";
  if (screenSourceType === "localhost") {
    recordPendingLiveTextEdit(screenId, selector, value, elementInfo, details);
    setActiveFileId(screenId);
    setActiveTool("move");
    setMode("edit");
    // Queued against the running app: the edit is accepted, it simply lands
    // through the live bridge rather than a source write.
    return "accepted";
  }
  const liveSnapshot = liveScreenSnapshotsById[screenId];
  const baseContent = liveSnapshot?.html ?? getScreenContent(screenId);
  const source = liveSnapshot
    ? { kind: "inline-html" as const, fileId: screenId }
    : { kind: "design-file" as const, fileId: screenId };
  const projection = buildCodeLayerProjection(baseContent, { source });
  const targetInfo = elementInfo ? { ...elementInfo, selector } : null;
  const targetNode = targetInfo
    ? (resolveCodeLayerNodeFromElementInfo(projection, targetInfo) ??
      (elementInfo?.sourceLayerIdentity?.screenId === screenId
        ? (projection.nodes.find(
            (node) => node.id === elementInfo.sourceLayerIdentity?.nodeId,
          ) ?? null)
        : null))
    : resolveCodeLayerNodeFromBridge(projection, selector);
  if (
    screenSourceType === "inline" &&
    !liveSnapshot &&
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
    applyLinkedComponentEdit(screenId, durableNodeId, {
      kind: "textContent",
      value,
    });
    setActiveFileId(screenId);
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
  const layerNamingNode = targetNode
    ? nextProjection.nodes.find((node) =>
        codeLayerNodeMatchesBridgeTarget(
          node,
          selector,
          bridgeSourceIdForCodeLayerNode(targetNode),
        ),
      )
    : null;
  // Mirrors handleTextContentChange's namedContent computation (Figma names
  // a freshly typed text layer after its own content) so a board — or any
  // other inactive-screen — text creation is named from its content exactly
  // like an active-screen one, instead of staying "Text" forever.
  const namedContent = layerNamingNode
    ? (setCodeLayerAttributeInHtml(
        nextContent,
        layerNamingNode,
        "data-agent-native-layer-name",
        defaultTextLayerName(value),
      ) ?? nextContent)
    : nextContent;
  const finalizedCreation = prepareTextCreationFinalization(
    screenId,
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
  let publication: ApplyFileContentUpdateResult | null = null;
  if (liveSnapshot) {
    // A snapshot that vanished, or an integrity check that rejected this edit,
    // leaves the source unchanged — consuming the creation's pending history
    // here would spend it on a write that never happened.
    if (
      !updateLiveScreenSnapshotContent(screenId, contentToApply, {
        recordHistory: !finalizedCreation.historyHandled,
      })
    ) {
      return "refused";
    }
  } else {
    publication = applyFileContentUpdate(screenId, contentToApply, {
      skipPreview: true,
      recordHistory: !finalizedCreation.historyHandled,
    });
    // A refused publication never wrote this text. Finalizing before it landed
    // consumed the creation's pending history and left the typed text nowhere:
    // keep the record so the retry still coalesces into one undo step.
    if (publication.status !== "accepted") return "refused";
  }
  finalizedCreation.confirm();
  setActiveFileId(screenId);
  // T8: see the matching note in handleTextContentChange — commit
  // should hand back to the move tool, not re-arm text.
  setActiveTool("move");
  setMode("edit");
  if (removedContent) {
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    return "accepted";
  }
  const submittedProjection = buildCodeLayerProjection(contentToApply, {
    source,
  });
  const nextNodeCandidate = targetNode
    ? submittedProjection.nodes.find((node) =>
        codeLayerNodeMatchesBridgeTarget(
          node,
          selector,
          bridgeSourceIdForCodeLayerNode(targetNode),
        ),
      )
    : null;
  const nextNode = publication
    ? mapAcceptedSelectionNode(
        publication,
        projectAcceptedSource(publication, source),
        nextNodeCandidate,
      )
    : nextNodeCandidate;
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
          sourceLayerIdentity: nextNode
            ? { screenId, nodeId: nextNode.id }
            : base.sourceLayerIdentity,
          textContent: value.slice(0, 200),
          htmlContent: details?.html,
        }
      : previous;
  });
  return "accepted";
}
