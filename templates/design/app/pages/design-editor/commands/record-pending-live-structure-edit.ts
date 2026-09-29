import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import type {
  PendingStructureVerificationStatus,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { runtimeMultiplicityForElementProvenance } from "@/pages/design-editor/editor-helpers";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveNonStyleUndoEntry,
  PendingLiveStructureEdit,
  PendingLiveStructureUndoEntry,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  appendPendingLiveNonStyleUndoEntry,
  mergePendingLiveNonStyleEdits,
  nextPendingLiveEditTimestamp,
  pendingLiveStructureEditsFromUndoEntry,
  pendingLiveStructureEditsMatch,
  projectRelativeSourcePath,
  reactSourceAnchorForPendingEdit,
  runtimeStructureNodeSignature,
} from "@/pages/design-editor/pending-edits";
import {
  isPendingStructureDropNoOp,
  runtimeStructureSnapshotSignature,
} from "@/pages/design-editor/pending-structure-verification";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RecordPendingLiveStructureEditArgs {
  canEditDesign: boolean;
  canEditLiveScreens?: ReadonlySet<string>;
  cancelPendingStructureVerification: (
    nextStatus?: PendingStructureVerificationStatus,
  ) => void;
  files: DesignFile[];
  localhostConnectionRootPathByIdRef: RefObject<Map<string, string>>;
  overviewScreens: OverviewScreen[];
  pendingLiveNonStyleEditsRef: RefObject<PendingLiveNonStyleEdit[]>;
  pendingLiveNonStyleRedoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingLiveNonStyleUndoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingStructureRedoReplayRef: RefObject<
    PendingLiveStructureUndoEntry | undefined
  >;
  pendingStructureRedoReplayTimerRef: RefObject<number | undefined>;
  pendingStructureRedoPreparedEditsRef?: RefObject<
    | {
        replay: PendingLiveStructureUndoEntry;
        edits: PendingLiveStructureEdit[];
      }
    | undefined
  >;
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

export type PendingLiveStructureEditRequest = Parameters<
  typeof preparePendingLiveStructureEdit
>;

export function preparePendingLiveStructureEdit(
  {
    canEditDesign,
    canEditLiveScreens,
    files,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    runtimeLayerSnapshotsById,
  }: Pick<
    RecordPendingLiveStructureEditArgs,
    | "canEditDesign"
    | "canEditLiveScreens"
    | "files"
    | "localhostConnectionRootPathByIdRef"
    | "overviewScreens"
    | "runtimeLayerSnapshotsById"
  >,
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
    remintCollidingNodeIds?: boolean;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
    replacementElementInfo?: ElementInfo;
    replacementSnapshotHtml?: string;
    removed?: true;
  },
): PendingLiveStructureEdit | undefined {
  if (!canEditDesign && !canEditLiveScreens?.has(screenId)) return undefined;
  const screen = files.find((file) => file.id === screenId);
  const overviewScreen = overviewScreens.find(
    (candidate) => candidate.id === screenId,
  );
  const connectionRootPath = overviewScreen?.connectionId
    ? localhostConnectionRootPathByIdRef.current.get(
        overviewScreen.connectionId,
      )
    : undefined;
  const routeSourceFile = projectRelativeSourcePath({
    sourceFile: overviewScreen?.sourceFile,
    rootPath: connectionRootPath,
  });
  const fallbackName = screen?.filename ?? screenId;
  const subjectInfo = details?.replaced
    ? details.anchorElementInfo
    : elementInfo;
  const subjectSourceId = details?.sourceId ?? subjectInfo?.sourceId;
  const nextEdit: PendingLiveStructureEdit = {
    kind: "structure",
    screenId,
    filename: fallbackName,
    screenName: prettyScreenName(fallbackName),
    selector,
    ...(details?.routePath ? { routePath: details.routePath } : {}),
    sourceId: subjectSourceId ?? null,
    sourceAnchor: reactSourceAnchorForPendingEdit({
      info: subjectInfo,
      id: subjectSourceId,
      rootPath: connectionRootPath,
      runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
        runtimeLayerSnapshotsById,
        subjectInfo,
      ),
    }),
    anchorSelector,
    anchorSourceId: details?.anchorSourceId ?? null,
    anchorSourceAnchor: reactSourceAnchorForPendingEdit({
      info: details?.anchorElementInfo,
      id: details?.anchorSourceId,
      rootPath: connectionRootPath,
      runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
        runtimeLayerSnapshotsById,
        details?.anchorElementInfo,
      ),
    }),
    placement,
    ...(routeSourceFile ? { routeSourceFile } : {}),
    dropMode: details?.dropMode,
    forceFlowPositionOverride: details?.forceFlowPositionOverride,
    sourceRect: details?.sourceRect,
    anchorRect: details?.anchorRect,
    gridPlacement: details?.gridPlacement,
    gridDisplacements: details?.gridDisplacements,
    insertedHtml: details?.insertedHtml,
    remintCollidingNodeIds: details?.remintCollidingNodeIds,
    ...(details?.replaced
      ? {
          replaced: true as const,
          replacementSelector: details.replacementSelector,
          replacementSourceId: details.replacementSourceId,
          replacementSnapshotSignature: details.replacementSnapshotHtml
            ? runtimeStructureSnapshotSignature(details.replacementSnapshotHtml)
            : undefined,
        }
      : {}),
    ...(details?.removed ? { removed: true as const } : {}),
    requestId: details?.requestId,
    transactionId: details?.transactionId,
    updatedAt: nextPendingLiveEditTimestamp(),
  };
  nextEdit.subjectSignature = runtimeStructureNodeSignature({
    info: subjectInfo,
    sourceAnchor: nextEdit.sourceAnchor,
  });
  if (details?.replaced) {
    nextEdit.replacementSignature = runtimeStructureNodeSignature({
      info: details.replacementElementInfo,
    });
  }
  nextEdit.anchorSignature = runtimeStructureNodeSignature({
    info: details?.anchorElementInfo,
    sourceAnchor: nextEdit.anchorSourceAnchor,
  });
  const isRunningLocalhostScreen = overviewScreen?.sourceType === "localhost";
  if (
    !isRunningLocalhostScreen &&
    isPendingStructureDropNoOp(
      runtimeLayerSnapshotsById[screenId]?.html,
      nextEdit,
    )
  ) {
    return undefined;
  }
  return nextEdit;
}

export function commitPendingLiveStructureEdits(
  {
    cancelPendingStructureVerification,
    pendingLiveNonStyleEditsRef,
    pendingLiveNonStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingStructureRedoReplayRef,
    pendingStructureRedoReplayTimerRef,
    pendingVisualStyleRedoStackRef,
    recordPendingHistoryEntry,
    setPendingLiveNonStyleEdits,
  }: Pick<
    RecordPendingLiveStructureEditArgs,
    | "cancelPendingStructureVerification"
    | "pendingLiveNonStyleEditsRef"
    | "pendingLiveNonStyleRedoStackRef"
    | "pendingLiveNonStyleUndoStackRef"
    | "pendingStructureRedoReplayRef"
    | "pendingStructureRedoReplayTimerRef"
    | "pendingVisualStyleRedoStackRef"
    | "recordPendingHistoryEntry"
    | "setPendingLiveNonStyleEdits"
  >,
  edits: readonly PendingLiveStructureEdit[],
): void {
  if (edits.length === 0) return;
  const nextEdit = edits[edits.length - 1]!;
  cancelPendingStructureVerification("conflict");
  const structureRedoReplay = pendingStructureRedoReplayRef.current;
  const replaysUndoneStructure = Boolean(
    structureRedoReplay &&
    edits.every((nextEdit) =>
      pendingLiveStructureEditsFromUndoEntry(structureRedoReplay).some((edit) =>
        pendingLiveStructureEditsMatch(edit, nextEdit),
      ),
    ),
  );
  if (replaysUndoneStructure && structureRedoReplay) {
    pendingStructureRedoReplayRef.current = undefined;
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    const redoStack = pendingLiveNonStyleRedoStackRef.current;
    if (redoStack[redoStack.length - 1] === structureRedoReplay) {
      pendingLiveNonStyleRedoStackRef.current = redoStack.slice(0, -1);
    }
  } else {
    pendingLiveNonStyleRedoStackRef.current = [];
    pendingStructureRedoReplayRef.current = undefined;
    if (pendingStructureRedoReplayTimerRef.current !== undefined) {
      window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
      pendingStructureRedoReplayTimerRef.current = undefined;
    }
    pendingVisualStyleRedoStackRef.current = [];
  }
  const previousUndoLength = pendingLiveNonStyleUndoStackRef.current.length;
  appendPendingLiveNonStyleUndoEntry(pendingLiveNonStyleUndoStackRef.current, {
    kind: "structure",
    edit: nextEdit,
    ...(edits.length > 1 ? { groupedEdits: [...edits] } : {}),
  });
  if (pendingLiveNonStyleUndoStackRef.current.length > previousUndoLength) {
    recordPendingHistoryEntry?.("pending-live", replaysUndoneStructure);
  }
  const nextPending = mergePendingLiveNonStyleEdits([
    ...pendingLiveNonStyleEditsRef.current,
    ...edits,
  ]);
  pendingLiveNonStyleEditsRef.current = nextPending;
  setPendingLiveNonStyleEdits(nextPending);
}

export function runRecordPendingLiveStructureEdit(
  {
    canEditDesign,
    canEditLiveScreens,
    cancelPendingStructureVerification,
    files,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    pendingLiveNonStyleEditsRef,
    pendingLiveNonStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingStructureRedoReplayRef,
    pendingStructureRedoReplayTimerRef,
    pendingStructureRedoPreparedEditsRef,
    pendingVisualStyleRedoStackRef,
    recordPendingHistoryEntry,
    runtimeLayerSnapshotsById,
    setPendingLiveNonStyleEdits,
  }: RecordPendingLiveStructureEditArgs,
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
    remintCollidingNodeIds?: boolean;
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
    replacementElementInfo?: ElementInfo;
    replacementSnapshotHtml?: string;
    removed?: true;
  },
) {
  const nextEdit = preparePendingLiveStructureEdit(
    {
      canEditDesign,
      canEditLiveScreens,
      files,
      localhostConnectionRootPathByIdRef,
      overviewScreens,
      runtimeLayerSnapshotsById,
    },
    screenId,
    selector,
    anchorSelector,
    placement,
    elementInfo,
    details,
  );
  if (!nextEdit) return;
  const structureRedoReplay = pendingStructureRedoReplayRef.current;
  const replayEdits = structureRedoReplay
    ? pendingLiveStructureEditsFromUndoEntry(structureRedoReplay)
    : [];
  if (
    structureRedoReplay &&
    replayEdits.length > 1 &&
    replayEdits.some((edit) =>
      pendingLiveStructureEditsMatch(edit, nextEdit),
    ) &&
    pendingStructureRedoPreparedEditsRef
  ) {
    const staged = pendingStructureRedoPreparedEditsRef.current;
    const prepared =
      staged?.replay === structureRedoReplay
        ? [...staged.edits, nextEdit]
        : [nextEdit];
    const complete = replayEdits.every((expected) =>
      prepared.some((edit) => pendingLiveStructureEditsMatch(edit, expected)),
    );
    if (!complete) {
      pendingStructureRedoPreparedEditsRef.current = {
        replay: structureRedoReplay,
        edits: prepared,
      };
      return;
    }
    pendingStructureRedoPreparedEditsRef.current = undefined;
    commitPendingLiveStructureEdits(
      {
        cancelPendingStructureVerification,
        pendingLiveNonStyleEditsRef,
        pendingLiveNonStyleRedoStackRef,
        pendingLiveNonStyleUndoStackRef,
        pendingStructureRedoReplayRef,
        pendingStructureRedoReplayTimerRef,
        pendingVisualStyleRedoStackRef,
        recordPendingHistoryEntry,
        setPendingLiveNonStyleEdits,
      },
      replayEdits.map(
        (expected) =>
          prepared.find((edit) =>
            pendingLiveStructureEditsMatch(edit, expected),
          )!,
      ),
    );
    return;
  }
  if (pendingStructureRedoPreparedEditsRef) {
    pendingStructureRedoPreparedEditsRef.current = undefined;
  }
  commitPendingLiveStructureEdits(
    {
      cancelPendingStructureVerification,
      pendingLiveNonStyleEditsRef,
      pendingLiveNonStyleRedoStackRef,
      pendingLiveNonStyleUndoStackRef,
      pendingStructureRedoReplayRef,
      pendingStructureRedoReplayTimerRef,
      pendingVisualStyleRedoStackRef,
      recordPendingHistoryEntry,
      setPendingLiveNonStyleEdits,
    },
    [nextEdit],
  );
}
