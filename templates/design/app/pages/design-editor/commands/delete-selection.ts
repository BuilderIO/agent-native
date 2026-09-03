import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
  removeCodeLayerNodeFromHtml,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import * as Y from "yjs";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerSelectorAliases,
  collectCodeLayerAncestors,
  collectCodeLayerSubtreeDataNodeIds,
  elementInfoFromCodeLayerNode,
  liveDeleteSelectorGroups,
  preferredCodeLayerSelector,
  removeEmptyGeneratedGroupWrappers,
  resolveCodeLayerNodeFromElementInfo,
  shouldDeleteThroughLiveScreen,
} from "@/pages/design-editor/code-layer-state";
import type {
  LiveScreenSnapshot,
  ResponsiveEditScope,
  SelectedCanvasLayerSnapshot,
} from "@/pages/design-editor/command-types";
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
import { removeElementFromHtml } from "@/pages/design-editor/text-edit-utils";
import type { DesignFile } from "@/pages/design-editor/types";

export interface DeleteSelectionArgs {
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
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
  deleteRuntimeElement: (
    selector?: string | null,
    candidates?: readonly string[],
    requestId?: string,
  ) => boolean;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  getSelectedLayerSnapshots: () => SelectedCanvasLayerSnapshot[];
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  previousMotionFileIdRef: RefObject<string | null>;
  pruneMotionTracksByNodeId: (nodeIdsToRemove: Set<string>) => void;
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
      removed?: true;
    },
  ) => void;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  syncLiveScreenSnapshotPreview: (screenId: string, html: string) => void;
  undoManagerRef: RefObject<Y.UndoManager | null>;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runDeleteSelection({
  activeBreakpointUpperBoundPx,
  activeBreakpointWidthStateRef,
  activeCanvasSourceType,
  activeFile,
  applyFileContentUpdate,
  applyLocalContentUpdate,
  canEditDesign,
  codeLayerOwnerByNodeIdRef,
  deleteRuntimeElement,
  files,
  getFreshActiveContent,
  getScreenContent,
  getSelectedLayerSnapshots,
  liveScreenSnapshotsById,
  previousMotionFileIdRef,
  pruneMotionTracksByNodeId,
  recordPendingLiveStructureEdit,
  responsiveEditScopeRef,
  selectedElement,
  selectedLayerIdsState,
  setOverviewSelectedScreenIds,
  setSelectedElement,
  setSelectedLayerIdsState,
  syncLiveScreenSnapshotPreview,
  undoManagerRef,
  updateLiveScreenSnapshotContent,
  viewModeRef,
}: DeleteSelectionArgs) {
  trace("structure", "delete", { layers: selectedLayerIdsState.length });
  if (!canEditDesign) return;
  // U19: delete is a discrete one-shot action — see the matching note in
  // handlePasteSelection.
  undoManagerRef.current?.stopCapturing();
  // BUG-DELETE-LIVE-NAMESPACE: the projections below are built from the
  // fetched source snapshot, whose node ids are a different namespace from
  // the live document's — see liveDeleteSelectorGroups for why a selector
  // taken from them silently removed nothing in the iframe.
  const runtimeAliasGroups = selectedLayerIdsState
    .map((layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId))
    .filter((owner) => owner?.runtimeOnly)
    .map((owner) => codeLayerSelectorAliases(owner!.node));
  const liveSelectionSelectors = [
    selectedElement?.runtimeSelector,
    selectedElement?.runtimeSourceId
      ? `[data-agent-native-node-id="${selectedElement.runtimeSourceId}"]`
      : undefined,
    selectedElement?.selector,
  ].filter((selector): selector is string => Boolean(selector));
  const hasLiveDeleteTarget =
    runtimeAliasGroups.length > 0 || liveSelectionSelectors.length > 0;
  const deleteFromLiveDom = (fallbackSelectors: readonly string[]) => {
    liveDeleteSelectorGroups({
      runtimeAliasGroups,
      liveSelectionSelectors,
      fallbackSelectors,
    }).forEach((aliases) => deleteRuntimeElement(aliases[0], aliases));
  };
  // BUG-DELETE-LIVE-PENDING: a live screen's source is the running app, so
  // the delete cannot be written into DesignFile.content the way an inline
  // screen's is. It removes the node from the running DOM and queues a
  // pending live edit for the coding agent — the same split
  // handleVisualStructureChange already makes for a localhost drag-move.
  // Recording it is also what makes Cmd+Z work: undo pops this entry and the
  // requestId it carries tells the bridge to re-attach the node it detached.
  if (
    activeFile &&
    shouldDeleteThroughLiveScreen({
      screenSourceType: activeCanvasSourceType,
      runtimeAliasGroups,
      liveSelectionSelectors,
    })
  ) {
    // Only the active screen's canvas registers the runtime bridge, so its
    // is the only live DOM a host-driven delete can reach.
    const runtimeTargets = selectedLayerIdsState
      .map((layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId))
      .filter((owner) => owner?.runtimeOnly && owner.fileId === activeFile.id)
      .map((owner) => ({
        aliases: codeLayerSelectorAliases(owner!.node),
        info: elementInfoFromCodeLayerNode(owner!.node),
        sourceId:
          owner!.node.dataAttributes["data-agent-native-node-id"] ??
          owner!.node.id,
      }));
    const targets =
      runtimeTargets.length > 0
        ? runtimeTargets
        : [
            {
              aliases: Array.from(new Set(liveSelectionSelectors)),
              info: selectedElement ?? undefined,
              sourceId:
                selectedElement?.runtimeSourceId ??
                selectedElement?.sourceId ??
                undefined,
            },
          ];
    let deletedAny = false;
    for (const target of targets) {
      const primary = target.aliases[0];
      if (!primary) continue;
      const requestId = `delete-${Date.now().toString(36)}-${Math.random()
        .toString(16)
        .slice(2)}`;
      if (!deleteRuntimeElement(primary, target.aliases, requestId)) continue;
      deletedAny = true;
      recordPendingLiveStructureEdit(
        activeFile.id,
        primary,
        // A removal has no anchor; `placement` is carried only because the
        // pending-edit shape is shared with moves and inserts.
        "",
        "after",
        target.info,
        { sourceId: target.sourceId, requestId, removed: true },
      );
    }
    if (!deletedAny) return;
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    return;
  }
  const snapshots = getSelectedLayerSnapshots();
  if (snapshots.length > 0) {
    const activeRuntimeSelectors: string[] = [];
    let shouldDeleteActiveLiveDom = false;
    let didDelete = false;
    // U14: motion tracks left targeting a deleted node's id would animate
    // nothing. Collected across every deleted subtree in the active file
    // (tracks aren't kept per-file, only for whichever file's timeline is
    // currently loaded) and pruned from motionTracks once after the loop.
    let orphanedTrackNodeIds: Set<string> | null = null;
    for (const file of files) {
      const group = snapshots.filter(
        (snapshot) => snapshot.sourceFileId === file.id,
      );
      if (group.length === 0) continue;
      // BUG-DELETE-LIVE-SNAPSHOT: see the matching note in
      // getSelectedLayerSnapshots — file.content is a bare URL for a
      // localhost/live-snapshot screen, so removeCodeLayerNodeFromHtml
      // below could never find anything to remove. Use the live snapshot
      // HTML when this screen has one.
      const liveSnapshot = liveScreenSnapshotsById[file.id];
      const originalContent = liveSnapshot?.html ?? getScreenContent(file.id);
      let content = originalContent;
      const projection = buildCodeLayerProjection(content);
      const tree = buildCodeLayerTree(projection);
      const nodesById = new Map(
        projection.nodes.map((node) => [node.id, node]),
      );
      const selectedNodeIds = new Set(
        group.map((snapshot) => snapshot.node.id),
      );
      const nodes = group
        .map((snapshot) =>
          projection.nodes.find(
            (node) =>
              node.id === snapshot.node.id ||
              node.dataAttributes["data-agent-native-node-id"] ===
                snapshot.rootNodeId,
          ),
        )
        .filter((node): node is CodeLayerNode => Boolean(node?.source))
        .filter(
          (node) =>
            !collectCodeLayerAncestors(tree, node.id).some((ancestorId) =>
              selectedNodeIds.has(ancestorId),
            ),
        )
        .sort((a, b) => (b.source?.start ?? 0) - (a.source?.start ?? 0));
      if (nodes.length === 0) continue;
      const removedSelectors: string[] = [];
      // L25: track each deleted node's former parent (by stable
      // data-agent-native-node-id) so we can sweep for now-empty generated
      // "Group" wrappers once every deletion in this file is applied. Only
      // meaningful for the structural-removal path below — a
      // breakpoint-scoped display:none write never empties a parent (the
      // node is still in the DOM, just hidden at that width).
      const formerParentAttrIds = new Set<string>();
      // Item 7b — while a breakpoint is the active edit target, Delete
      // must not structurally remove the element (that would remove it at
      // EVERY width, defeating the point of scoping). Instead it writes a
      // display:none override scoped to the active breakpoint's upper
      // bound, through the exact same planBreakpointStyleWrite routing
      // regular style edits use (applyScopedVisualStyleEdit / see
      // commitVisualStyles' matching upperBoundPx-gated branch above).
      // Only file.id === activeFile?.id can be the breakpoint-scoped
      // target — activeBreakpointUpperBoundPx describes the ACTIVE
      // screen's viewport scope, not other files' — so a multi-screen
      // overview selection spanning other screens still deletes those
      // structurally.
      const useBreakpointScopedDelete =
        activeBreakpointWidthStateRef.current !== undefined &&
        file.id === activeFile?.id &&
        activeBreakpointUpperBoundPx != null;
      for (const node of nodes) {
        if (useBreakpointScopedDelete) {
          const nodeId =
            node.dataAttributes["data-agent-native-node-id"] ?? node.id;
          const patch = applyScopedVisualStyleEdit({
            content,
            target: { nodeId },
            property: "display",
            value: "none",
            upperBoundPx: activeBreakpointUpperBoundPx,
            lowerBoundPx:
              responsiveEditScopeRef.current === "only"
                ? activeBreakpointWidthStateRef.current
                : null,
          });
          if (patch.result.status !== "applied") continue;
          content = patch.content;
          // Not a structural removal: the node stays selectable at Base /
          // a wider breakpoint, so it must not be treated as "removed"
          // for the runtime-selector cleanup, former-parent sweep, or
          // motion-track pruning below.
          continue;
        }
        if (node.parentId) {
          const parentNode = nodesById.get(node.parentId);
          const parentAttrId =
            parentNode?.dataAttributes["data-agent-native-node-id"];
          if (parentAttrId) formerParentAttrIds.add(parentAttrId);
        }
        const next = removeCodeLayerNodeFromHtml(content, node);
        if (!next) continue;
        const selector = preferredCodeLayerSelector(node);
        if (selector) removedSelectors.push(selector);
        content = next;
        if (file.id === previousMotionFileIdRef.current) {
          const subtreeIds = collectCodeLayerSubtreeDataNodeIds(
            tree,
            node.id,
            nodesById,
          );
          if (subtreeIds.size > 0) {
            orphanedTrackNodeIds ??= new Set();
            subtreeIds.forEach((id) => orphanedTrackNodeIds!.add(id));
          }
        }
      }
      if (content === originalContent) continue;
      if (!useBreakpointScopedDelete) {
        content = removeEmptyGeneratedGroupWrappers(
          content,
          formerParentAttrIds,
        );
      }
      if (file.id === activeFile?.id && !useBreakpointScopedDelete) {
        activeRuntimeSelectors.push(...removedSelectors);
        shouldDeleteActiveLiveDom = true;
      }
      didDelete = true;
      if (liveSnapshot) {
        // Records the same ContentHistoryChange shape as
        // applyFileContentUpdate, so this delete gets a real undo/redo
        // entry that now also re-syncs the live iframe (see
        // syncLiveScreenSnapshotPreview) instead of only updating the
        // model liveScreenSnapshotsById state.
        const updated = updateLiveScreenSnapshotContent(file.id, content);
        if (updated && useBreakpointScopedDelete) {
          syncLiveScreenSnapshotPreview(file.id, content);
        }
      } else {
        // Item 5 (edit-flash) parity: a breakpoint-scoped write can become a
        // width-scoped class OR a managed @media rule (planBreakpointStyleWrite),
        // neither of which the runtime bridge's inline-style shortcut can
        // preview correctly — force a full preview refresh the same way
        // commitVisualStyles does for breakpoint-scoped style commits,
        // instead of the optimistic refreshPreview:false structural-delete
        // path.
        applyFileContentUpdate(file.id, content, {
          refreshPreview: false,
          forcePreviewFullDocument: useBreakpointScopedDelete,
        });
      }
    }
    // A live screen's snapshot rewrite can come up empty (different id
    // namespace) while the live-DOM delete is still the real, visible
    // operation — bail only when NEITHER has anything to remove.
    if (!didDelete && !hasLiveDeleteTarget) return;
    if (orphanedTrackNodeIds) {
      const idsToRemove = orphanedTrackNodeIds;
      // U14 fix: mark motion dirty when a track is actually pruned so the
      // autosave/remove-motion-timeline path persists the cleanup. Without
      // this the filtered tracks live only in memory and the stale managed
      // CSS + timeline row reappear on reload. markMotionTracksDirty is only
      // invoked when the filter drops at least one track; a redundant call
      // (e.g. a StrictMode double render) is harmless — it just bumps the
      // autosave revision, which the autosave effect dedupes.
      pruneMotionTracksByNodeId(idsToRemove);
    }
    if (shouldDeleteActiveLiveDom) {
      deleteFromLiveDom(activeRuntimeSelectors);
    }
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
    if (viewModeRef.current === "overview") {
      setOverviewSelectedScreenIds([]);
    }
    return;
  }

  if (!selectedElement?.selector) return;
  const activeLiveSnapshot = activeFile
    ? liveScreenSnapshotsById[activeFile.id]
    : undefined;
  const baseContent = activeLiveSnapshot?.html ?? getFreshActiveContent();
  // Item 7b — same breakpoint-scoped display:none routing as the
  // multi-layer-snapshot branch above, for the single-runtime-selected-
  // element fallback path (e.g. single-screen canvas click-select with no
  // layers-panel snapshot).
  if (
    activeBreakpointWidthStateRef.current !== undefined &&
    activeBreakpointUpperBoundPx != null
  ) {
    const projection = buildCodeLayerProjection(baseContent);
    const targetNode = resolveCodeLayerNodeFromElementInfo(
      projection,
      selectedElement,
    );
    const nodeId =
      targetNode?.dataAttributes["data-agent-native-node-id"] ??
      targetNode?.id ??
      selectedElement.sourceId;
    const patch = nodeId
      ? applyScopedVisualStyleEdit({
          content: baseContent,
          target: { nodeId },
          property: "display",
          value: "none",
          upperBoundPx: activeBreakpointUpperBoundPx,
          lowerBoundPx:
            responsiveEditScopeRef.current === "only"
              ? activeBreakpointWidthStateRef.current
              : null,
        })
      : null;
    if (patch && patch.result.status === "applied") {
      if (activeLiveSnapshot) {
        if (updateLiveScreenSnapshotContent(activeFile!.id, patch.content)) {
          syncLiveScreenSnapshotPreview(activeFile!.id, patch.content);
        }
      } else {
        applyLocalContentUpdate(patch.content, {
          refreshPreview: false,
          forcePreviewFullDocument: true,
        });
      }
      setSelectedElement(null);
      setSelectedLayerIdsState([]);
    }
    return;
  }
  const nextContent = removeElementFromHtml(
    baseContent,
    selectedElement.selector,
  );
  if (!nextContent) return;
  // U14: orphan-track cleanup for the single-element fallback path too.
  if (
    selectedElement.sourceId &&
    previousMotionFileIdRef.current === activeFile?.id
  ) {
    const projection = buildCodeLayerProjection(baseContent);
    const tree = buildCodeLayerTree(projection);
    const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
    const targetNode = projection.nodes.find(
      (node) =>
        node.id === selectedElement.sourceId ||
        node.dataAttributes["data-agent-native-node-id"] ===
          selectedElement.sourceId,
    );
    const subtreeIds = targetNode
      ? collectCodeLayerSubtreeDataNodeIds(tree, targetNode.id, nodesById)
      : new Set<string>();
    if (subtreeIds.size > 0) {
      // U14 fix: same as the multi-layer path above — persist the orphan
      // cleanup by marking motion dirty when a track is actually pruned.
      pruneMotionTracksByNodeId(subtreeIds);
    }
  }
  deleteFromLiveDom([selectedElement.selector]);
  if (activeLiveSnapshot) {
    updateLiveScreenSnapshotContent(activeFile!.id, nextContent);
  } else {
    applyLocalContentUpdate(nextContent, { refreshPreview: false });
  }
  setSelectedElement(null);
  setSelectedLayerIdsState([]);
}
