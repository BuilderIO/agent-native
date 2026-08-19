import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import {
  applyVisualEdit,
  buildCodeLayerProjection,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import { dndHostLog } from "@/components/design/dnd-debug";
import { validateCrossScreenSourceHtmlSnapshot } from "@/components/design/multi-screen/cross-screen-drop";
import { getPrimaryIframeId } from "@/components/design/multi-screen/iframe-targeting";
import type {
  ElementInfo,
  PortableStyleSnapshot,
  RuntimeStructureInsertRequest,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  bridgeSourceIdForCodeLayerNode,
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromBridge,
} from "@/pages/design-editor/code-layer-state";
import { adaptAutoTextColorForCrossScreenNode } from "@/pages/design-editor/cross-screen-text-color";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { DESIGN_EDITOR_DEBUG_LOGS } from "@/pages/design-editor/editor-constants";
import type { ContentHistoryEntry } from "@/pages/design-editor/history";
import {
  removeAbsolutePositioningFromNodeInHtml,
  setAbsolutePositioningForNodeInHtml,
} from "@/pages/design-editor/html-layer-positioning";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import { applyPortableStyleSnapshotToHtml } from "@/pages/design-editor/portable-style";
import { resolveRuntimeStructureMoveExecutionMode } from "@/pages/design-editor/react-semantic-handoff";

export interface CrossScreenElementDropArgs {
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
  boardFileId: string | undefined;
  canEditDesign: boolean;
  clearPendingOverviewLayerSelectionTimer: () => void;
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
  designSourceType: "inline" | "localhost" | "fusion";
  getScreenContent: (screenId: string) => string;
  id: string | undefined;
  overviewScreens: OverviewScreen[];
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  recordContentHistoryEntry: (entry: ContentHistoryEntry) => void;
  runtimeStructureInsertRevisionRef: RefObject<number>;
  sendRuntimeLayerMoveSemanticHandoff: (
    subjectLayerId: string,
    targetLayerId: string,
    placement: "before" | "after" | "inside",
  ) => boolean;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setRuntimeStructureInsertRequest: Dispatch<
    SetStateAction<
      (RuntimeStructureInsertRequest & { screenId: string }) | null
    >
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runCrossScreenElementDrop(
  {
    applyFileContentUpdate,
    boardFileId,
    canEditDesign,
    clearPendingOverviewLayerSelectionTimer,
    codeLayerOwnerByNodeIdRef,
    designSourceType,
    getScreenContent,
    id,
    overviewScreens,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    recordContentHistoryEntry,
    runtimeStructureInsertRevisionRef,
    sendRuntimeLayerMoveSemanticHandoff,
    setActiveFileId,
    setCreatedOverviewLayerSelection,
    setOverviewSelectedScreenIds,
    setRuntimeStructureInsertRequest,
    setSelectedElement,
    setSelectedLayerIdsState,
    t,
    viewModeRef,
  }: CrossScreenElementDropArgs,
  {
    sourceSelector,
    sourceNodeId,
    sourceScreenId,
    targetScreenId,
    targetAnchorNodeId,
    targetAnchorPendingNodeId,
    targetAnchorSelector,
    targetAnchorPlacement,
    targetDropMode,
    targetAnchorRect,
    targetLocalPoint,
    sourcePointerOffset,
    sourceHtmlSnapshot,
    styleSnapshot,
  }: {
    sourceSelector: string;
    sourceNodeId?: string;
    sourceScreenId: string;
    targetScreenId: string;
    targetAnchorNodeId?: string;
    targetAnchorPendingNodeId?: string;
    targetAnchorSelector?: string;
    targetAnchorPlacement?: "before" | "after" | "inside";
    targetDropMode?: "flow-insert" | "absolute-container";
    targetAnchorRect?: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
    targetCanvasPoint?: { x: number; y: number };
    targetLocalPoint?: { x: number; y: number };
    sourcePointerOffset?: { x: number; y: number };
    sourceHtmlSnapshot?: string;
    styleSnapshot?: PortableStyleSnapshot;
  },
) {
  dndHostLog("persist:cross-screen", {
    sourceScreenId,
    targetScreenId,
    targetAnchorPlacement,
    targetDropMode,
  });
  trace("drop", "cross-screen-persist", {
    from: sourceScreenId,
    to: targetScreenId,
    mode: targetDropMode,
    placement: targetAnchorPlacement,
    anchor: targetAnchorNodeId ?? targetAnchorSelector ?? null,
    node: sourceNodeId ?? sourceSelector,
    blocked: !canEditDesign
      ? "read-only design"
      : sourceScreenId === targetScreenId
        ? "same screen — nothing to move"
        : null,
  });
  if (!canEditDesign) return;
  if (sourceScreenId === targetScreenId) return;

  const findLayerOwner = (
    screenId: string,
    nodeId: string | undefined,
    selector: string | undefined,
  ) =>
    Array.from(codeLayerOwnerByNodeIdRef.current.entries()).find(
      ([candidateId, owner]) =>
        owner.fileId === screenId &&
        ((nodeId &&
          (candidateId === nodeId ||
            bridgeSourceIdForCodeLayerNode(owner.node) === nodeId)) ||
          (selector && owner.node.selector === selector)),
    );
  const sourceOwnerEntry = findLayerOwner(
    sourceScreenId,
    sourceNodeId,
    sourceSelector,
  );
  const targetOwnerEntry = findLayerOwner(
    targetScreenId,
    targetAnchorNodeId,
    targetAnchorSelector,
  );
  // A live localhost destination has no editable stored document — its
  // stored "content" is the bridge URL — so the source-edit path below
  // would write a whole HTML document over that URL and never reach the
  // running app. Key off the destination SCREEN's source type: a live
  // anchor normally has no stored layer owner at all, so both runtimeOnly
  // flags read false and the drop looks like an ordinary source move.
  const crossScreenExecutionMode = resolveRuntimeStructureMoveExecutionMode({
    subjectRuntimeOnly: Boolean(sourceOwnerEntry?.[1].runtimeOnly),
    targetRuntimeOnly: Boolean(targetOwnerEntry?.[1].runtimeOnly),
    sourceScreenId,
    targetScreenId,
    // Only a board primitive may be reinterpreted as an insert; a real
    // screen's element dropped into a live app is a move, and inserting it
    // would leave a duplicate behind in its own screen.
    sourceScreenIsBoard: Boolean(boardFileId) && sourceScreenId === boardFileId,
    targetScreenIsLive: (() => {
      // overviewScreens deliberately excludes the board file, and
      // resolveOverviewScreenSourceType answers with the DESIGN-level
      // fallback for an unknown screen. Trusting that fallback would
      // route a live→board drop into the board's own preview DOM, where
      // nothing is persisted and the node disappears on next render.
      // An unresolved screen is not a live screen.
      const targetScreen = overviewScreens.find(
        (screen) => screen.id === targetScreenId,
      );
      return (
        Boolean(targetScreen) &&
        resolveOverviewScreenSourceType(targetScreen, designSourceType) ===
          "localhost"
      );
    })(),
  });
  if (crossScreenExecutionMode === "screen-bridge-insert") {
    const boardContent = getScreenContent(sourceScreenId);
    if (!boardContent) return;
    const boardProjection = buildCodeLayerProjection(boardContent);
    const subjectNode = sourceNodeId
      ? (boardProjection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
            node.id === sourceNodeId,
        ) ??
        resolveCodeLayerNodeFromBridge(
          boardProjection,
          sourceSelector,
          sourceNodeId,
        ))
      : resolveCodeLayerNodeFromBridge(boardProjection, sourceSelector);
    const subjectNodeId =
      subjectNode?.dataAttributes["data-agent-native-node-id"];
    const validatedSourceHtmlSnapshot =
      subjectNodeId && sourceHtmlSnapshot
        ? validateCrossScreenSourceHtmlSnapshot(
            sourceHtmlSnapshot,
            subjectNodeId,
          )
        : undefined;
    if (sourceHtmlSnapshot && !validatedSourceHtmlSnapshot) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    // Reuse the stored-document transforms instead of slicing the source
    // span: they already own absolute/flow semantics. The portable style
    // snapshot is always inlined (no sourceContent argument) — a live app
    // never shares the board's stylesheet head, so the node would land
    // unstyled otherwise.
    const insertedHtml = subjectNodeId
      ? (() => {
          const styled = applyPortableStyleSnapshotToHtml(
            validatedSourceHtmlSnapshot ?? boardContent,
            subjectNodeId,
            styleSnapshot,
          );
          const positioned =
            targetDropMode === "absolute-container" &&
            targetLocalPoint &&
            targetAnchorRect
              ? setAbsolutePositioningForNodeInHtml(
                  styled,
                  subjectNodeId,
                  {
                    x: targetLocalPoint.x - targetAnchorRect.left,
                    y: targetLocalPoint.y - targetAnchorRect.top,
                  },
                  sourcePointerOffset,
                )
              : removeAbsolutePositioningFromNodeInHtml(styled, subjectNodeId);
          return new DOMParser()
            .parseFromString(positioned, "text/html")
            .querySelector(
              `[data-agent-native-node-id="${CSS.escape(subjectNodeId)}"]`,
            )?.outerHTML;
        })()
      : undefined;
    if (!insertedHtml) {
      toast.error(t("designEditor.toasts.layerMoveFailed"), {
        duration: 4000,
      });
      return;
    }
    runtimeStructureInsertRevisionRef.current += 1;
    setRuntimeStructureInsertRequest({
      requestId: runtimeStructureInsertRevisionRef.current,
      screenId: targetScreenId,
      html: insertedHtml,
      anchor: {
        selector: targetAnchorSelector ?? "",
        sourceId: targetAnchorNodeId,
        pendingNodeId: targetAnchorPendingNodeId,
      },
      placement: targetAnchorPlacement ?? "inside",
    });
    // The board keeps its copy until the pending live edit is applied.
    // Removing it here would commit the board file immediately while the
    // destination is still only a pending live edit, and undo pops whichever
    // stack is newer — one Cmd+Z would revert half the gesture, and a drop
    // that is never applied would lose the primitive entirely.
    return;
  }
  if (crossScreenExecutionMode === "semantic-handoff") {
    if (!sourceOwnerEntry || !targetOwnerEntry) {
      // A runtime/source cross-screen drop without an exact target (for
      // example, dropping on the bare screen root) cannot satisfy the
      // semantic handoff's two-anchor contract. Do not fall through to a
      // selector guess or mutate stored wrapper HTML that does not own the
      // runtime React node.
      toast.error(t("designEditor.toasts.reactSourceAnchorsLoading"));
      return;
    }
    sendRuntimeLayerMoveSemanticHandoff(
      sourceOwnerEntry[0],
      targetOwnerEntry[0],
      targetAnchorPlacement ?? "inside",
    );
    return;
  }

  const sourceContent = getScreenContent(sourceScreenId);
  const rawDestContent = getScreenContent(targetScreenId);
  if (!sourceContent || !rawDestContent) return;

  // Id-on-demand handshake (two-step, mirroring the element-select
  // persist-on-select path above): AI-generated/duplicated screens often
  // carry ZERO data-agent-native-node-id attributes, so the hit-test
  // bridge can't return an anchor id — it mints a pendingNodeId (stamped
  // on the LIVE dest DOM as data-an-pending-node-id) plus a
  // source-equivalent structural anchorSelector. Persist that pending id
  // as the anchor's real node id in the STORED dest document first, then
  // resolve the drop against it — otherwise every flow-insert into an
  // id-less screen silently degrades to absolute placement even though
  // the hit-test found a valid before/after/inside slot. applyVisualEdit
  // resolves the selector STRICTLY (unique match or conflict), so a
  // selector that can't be honestly mapped to one source element (e.g.
  // Alpine template instances) leaves the absolute fallback untouched
  // rather than ever stamping the wrong node.
  let destContent = rawDestContent;
  let effectiveAnchorNodeId = targetAnchorNodeId;
  if (
    !targetAnchorNodeId &&
    targetAnchorPendingNodeId &&
    targetAnchorSelector
  ) {
    const stamped = applyVisualEdit(
      rawDestContent,
      {
        kind: "attribute",
        target: { selector: targetAnchorSelector },
        name: "data-agent-native-node-id",
        value: targetAnchorPendingNodeId,
      },
      {
        source: {
          kind: "design-file",
          designId: id,
          fileId: targetScreenId,
        },
      },
    );
    if (
      stamped.result.status === "applied" &&
      stamped.content !== rawDestContent
    ) {
      destContent = stamped.content;
      effectiveAnchorNodeId = targetAnchorPendingNodeId;
    } else {
      // Silent degradation: the hit-test found a valid before/after/
      // inside slot, but the pending anchor id couldn't be honestly
      // persisted (e.g. targetAnchorSelector resolved to an Alpine
      // template instance or no longer matches uniquely) — this drop
      // falls through to absolute placement below with no anchor at
      // all. Surface it instead of failing quietly; fallback behavior
      // itself is intentionally unchanged. Dev-only: this is a known,
      // handled degraded path (not a correctness bug), so keep
      // production consoles quiet — see DESIGN_EDITOR_DEBUG_LOGS.
      if (DESIGN_EDITOR_DEBUG_LOGS) {
        console.warn(
          "[design] cross-screen drop: could not stamp pending anchor node id — falling back to absolute placement",
          {
            targetScreenId,
            targetAnchorSelector,
            targetAnchorPendingNodeId,
            status: stamped.result.status,
          },
        );
      }
    }
  }

  // Resolve the data-agent-native-node-id that moveNodeBetweenDocuments
  // uses as a stable key.  Prefer the bridge-supplied sourceNodeId when it
  // looks like a node-attr id; otherwise look up via selector projection.
  const sourceProjection = buildCodeLayerProjection(sourceContent);
  const resolvedSourceNode = sourceNodeId
    ? (sourceProjection.nodes.find(
        (n) =>
          n.dataAttributes["data-agent-native-node-id"] === sourceNodeId ||
          n.id === sourceNodeId,
      ) ??
      resolveCodeLayerNodeFromBridge(
        sourceProjection,
        sourceSelector,
        sourceNodeId,
      ))
    : resolveCodeLayerNodeFromBridge(sourceProjection, sourceSelector);
  const nodeAttrId =
    resolvedSourceNode?.dataAttributes["data-agent-native-node-id"] ??
    sourceNodeId ??
    sourceSelector;
  const destProjection = buildCodeLayerProjection(destContent);
  const resolvedTargetAnchor = effectiveAnchorNodeId
    ? resolveCodeLayerNodeFromBridge(
        destProjection,
        undefined,
        effectiveAnchorNodeId,
      )
    : null;
  const targetAnchorAttrId =
    resolvedTargetAnchor?.dataAttributes["data-agent-native-node-id"];

  // Use hit-test anchor when the canvas supplied one; fall back to
  // top-level body append ("inside" with no anchor = existing behaviour).
  const result = moveNodeBetweenDocuments(sourceContent, destContent, {
    nodeId: nodeAttrId,
    ...(targetAnchorAttrId
      ? {
          anchorNodeId: targetAnchorAttrId,
          placement: targetAnchorPlacement ?? "inside",
        }
      : { placement: "inside" }),
  });
  if (result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        result.message,
        t("designEditor.toasts.layerMoveFailed"),
      ),
      { duration: 4000 },
    );
    return;
  }
  // Finding 8: see the same-screen move's identical handling above —
  // the anchor placement was redirected out of a <template> interior to
  // right after the enclosing template's close instead of failing or
  // teleporting to doc end.
  if (result.anchorRedirected) {
    toast(t("designEditor.toasts.layerMoveRedirected"), {
      duration: 4000,
    });
  }

  // Hit-test anchors are emitted only for auto-layout insertion targets. If
  // there is no anchor, preserve absolute mode and rebase left/top to the
  // release point so screen↔board moves behave like Figma absolute layers.
  const destNodeAttrId = result.movedNodeId ?? nodeAttrId;
  const styleSnapshotDest = applyPortableStyleSnapshotToHtml(
    result.destHtml,
    destNodeAttrId,
    styleSnapshot,
    sourceContent,
  );
  // Finding 8: board/screen text carrying the auto-applied white default
  // (see BOARD_TEXT_AUTO_COLOR_MARKER / defaultCanvasTextColor) must not
  // keep that forced white when it lands cross-screen in a light
  // destination — otherwise it renders invisible white-on-white. The
  // in-screen drag path already adapts via the bridge's
  // adaptAutoTextColorForNest; this is the cross-screen mirror, applied
  // host-side now that the node has actually been re-parented into
  // destContent.
  const liveDestIframe = document.querySelector<HTMLIFrameElement>(
    `[data-screen-iframe-id="${CSS.escape(getPrimaryIframeId(targetScreenId))}"]`,
  );
  const stylePreservedDest = adaptAutoTextColorForCrossScreenNode(
    styleSnapshotDest,
    destNodeAttrId,
    liveDestIframe?.contentDocument ?? null,
  );
  const nextDestContent = targetAnchorAttrId
    ? targetDropMode === "absolute-container"
      ? targetLocalPoint && targetAnchorRect
        ? setAbsolutePositioningForNodeInHtml(
            stylePreservedDest,
            destNodeAttrId,
            {
              x: targetLocalPoint.x - targetAnchorRect.left,
              y: targetLocalPoint.y - targetAnchorRect.top,
            },
            sourcePointerOffset,
          )
        : stylePreservedDest
      : removeAbsolutePositioningFromNodeInHtml(
          stylePreservedDest,
          destNodeAttrId,
        )
    : targetLocalPoint
      ? setAbsolutePositioningForNodeInHtml(
          stylePreservedDest,
          destNodeAttrId,
          targetLocalPoint,
          sourcePointerOffset,
        )
      : stylePreservedDest;

  recordContentHistoryEntry({
    changes: [
      {
        fileId: sourceScreenId,
        before: sourceContent,
        after: result.sourceHtml,
      },
      {
        fileId: targetScreenId,
        before: destContent,
        after: nextDestContent,
      },
    ],
  });

  applyFileContentUpdate(sourceScreenId, result.sourceHtml, {
    recordHistory: false,
    refreshPreview: false,
    forcePreviewFullDocument: true,
  });
  applyFileContentUpdate(targetScreenId, nextDestContent, {
    recordHistory: false,
    refreshPreview: false,
    forcePreviewFullDocument: true,
  });

  // Switch active screen to the target and select the moved node; viewMode
  // stays "overview" (no setViewMode call).
  pendingOverviewScreenSelectionRef.current =
    targetScreenId === boardFileId ? null : targetScreenId;
  pendingOverviewLayerSelectionRef.current = destNodeAttrId;
  clearPendingOverviewLayerSelectionTimer();
  setActiveFileId(targetScreenId);
  const finalProjection = buildCodeLayerProjection(nextDestContent);
  const movedNodeFinal = finalProjection.nodes.find(
    (n) => n.dataAttributes["data-agent-native-node-id"] === destNodeAttrId,
  );
  if (movedNodeFinal) {
    setCreatedOverviewLayerSelection({
      screenId: targetScreenId,
      layerId: movedNodeFinal.id,
    });
    setSelectedLayerIdsState([movedNodeFinal.id]);
    setSelectedElement(elementInfoFromCodeLayerNode(movedNodeFinal));
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds(
        targetScreenId === boardFileId ? [] : [targetScreenId],
      );
    }
  }
}
