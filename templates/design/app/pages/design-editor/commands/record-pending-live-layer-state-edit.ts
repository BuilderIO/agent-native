import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { prettyScreenName } from "@/lib/screen-names";
import {
  bridgeSourceIdForCodeLayerNode,
  elementInfoFromCodeLayerNode,
  preferredCodeLayerSelector,
} from "@/pages/design-editor/code-layer-state";
import type {
  PendingStructureVerificationStatus,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { runtimeMultiplicityForElementProvenance } from "@/pages/design-editor/editor-helpers";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import type {
  PendingLiveLayerStateEdit,
  PendingLiveNonStyleEdit,
  PendingLiveNonStyleUndoEntry,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  appendPendingLiveNonStyleUndoEntry,
  mergePendingLiveNonStyleEdit,
  nextPendingLiveEditTimestamp,
  pendingLiveLayerStateUndoRevertValue,
  reactSourceAnchorForPendingEdit,
  resolveOverviewScreenSourceType,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RecordPendingLiveLayerStateEditArgs {
  canEditDesign: boolean;
  canEditLiveScreens?: ReadonlySet<string>;
  cancelPendingStructureVerification: (
    nextStatus?: PendingStructureVerificationStatus,
  ) => void;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
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
  files: DesignFile[];
  localhostConnectionRootPathByIdRef: RefObject<Map<string, string>>;
  overviewScreens: OverviewScreen[];
  pendingLiveNonStyleEditsRef: RefObject<PendingLiveNonStyleEdit[]>;
  pendingLiveNonStyleRedoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLiveNonStyleUndoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  recordPendingHistoryEntry?: (
    kind: "pending-style" | "pending-live",
    replayedRedo?: boolean,
  ) => void;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
}

export function runRecordPendingLiveLayerStateEdit(
  {
    canEditDesign,
    canEditLiveScreens,
    cancelPendingStructureVerification,
    clipboardPasteRedoStackRef,
    codeLayerOwnerByNodeIdRef,
    files,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    pendingLiveNonStyleEditsRef,
    pendingLiveNonStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingVisualStyleRedoStackRef,
    recordPendingHistoryEntry,
    runtimeLayerSnapshotsById,
    setPendingLiveNonStyleEdits,
  }: RecordPendingLiveLayerStateEditArgs,
  layerId: string,
  state: "hidden" | "locked",
  enabled: boolean,
  originalEnabled: boolean,
  routePath?: string,
) {
  const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
  if (!owner) return false;
  if (!canEditDesign && !canEditLiveScreens?.has(owner.fileId)) return false;
  const screen = overviewScreens.find(
    (candidate) => candidate.id === owner.fileId,
  );
  if (resolveOverviewScreenSourceType(screen) !== "localhost") {
    return false;
  }
  const info = elementInfoFromCodeLayerNode(owner.node);
  const sourceId = bridgeSourceIdForCodeLayerNode(owner.node);
  const selector = preferredCodeLayerSelector(owner.node);
  const rootPath = screen?.connectionId
    ? localhostConnectionRootPathByIdRef.current.get(screen.connectionId)
    : undefined;
  const fallbackName =
    files.find((file) => file.id === owner.fileId)?.filename ?? owner.fileId;
  const nextEdit: PendingLiveLayerStateEdit = {
    kind: "layer-state",
    screenId: owner.fileId,
    filename: fallbackName,
    screenName: prettyScreenName(fallbackName),
    layerId,
    selector,
    sourceId,
    ...(routePath ? { routePath } : {}),
    sourceAnchor: reactSourceAnchorForPendingEdit({
      info,
      id: sourceId,
      rootPath,
      runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
        runtimeLayerSnapshotsById,
        info,
      ),
      reason: `Pending live ${state} state for layer ${layerId} in screen ${owner.fileId}.`,
    }),
    tagName: info.tagName ?? null,
    classes: info.classes ?? [],
    state,
    enabled,
    originalEnabled,
    updatedAt: nextPendingLiveEditTimestamp(),
  };
  const revertEnabled = pendingLiveLayerStateUndoRevertValue(
    pendingLiveNonStyleEditsRef.current,
    nextEdit,
  );
  cancelPendingStructureVerification("conflict");
  pendingLiveNonStyleRedoStackRef.current = [];
  pendingVisualStyleRedoStackRef.current = [];
  clipboardPasteRedoStackRef.current = [];
  const previousUndoLength = pendingLiveNonStyleUndoStackRef.current.length;
  appendPendingLiveNonStyleUndoEntry(pendingLiveNonStyleUndoStackRef.current, {
    kind: "layer-state",
    edit: nextEdit,
    revertEnabled,
  });
  if (pendingLiveNonStyleUndoStackRef.current.length > previousUndoLength) {
    recordPendingHistoryEntry?.("pending-live");
  }
  const nextPending = mergePendingLiveNonStyleEdit(
    pendingLiveNonStyleEditsRef.current,
    nextEdit,
  );
  pendingLiveNonStyleEditsRef.current = nextPending;
  setPendingLiveNonStyleEdits(nextPending);
  return true;
}
