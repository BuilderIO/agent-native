import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import type {
  PendingStructureVerificationStatus,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { runtimeMultiplicityForElementProvenance } from "@/pages/design-editor/editor-helpers";
import { MAX_DESIGN_UNDO_STACK } from "@/pages/design-editor/history";
import type {
  PendingLiveNonStyleEdit,
  PendingLiveNonStyleUndoEntry,
  PendingLiveStructureEdit,
  PendingLiveStructureUndoEntry,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  mergePendingLiveNonStyleEdits,
  pendingLiveStructureEditsMatch,
  projectRelativeSourcePath,
  reactSourceAnchorForPendingEdit,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RecordPendingLiveStructureEditArgs {
  canEditDesign: boolean;
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
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
}

export function runRecordPendingLiveStructureEdit(
  {
    canEditDesign,
    cancelPendingStructureVerification,
    files,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    pendingLiveNonStyleEditsRef,
    pendingLiveNonStyleRedoStackRef,
    pendingLiveNonStyleUndoStackRef,
    pendingStructureRedoReplayRef,
    pendingStructureRedoReplayTimerRef,
    pendingVisualStyleRedoStackRef,
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
    dropMode?: "flow-insert" | "absolute-container";
    forceFlowPositionOverride?: boolean;
    sourceRect?: { x: number; y: number; width: number; height: number };
    anchorRect?: { x: number; y: number; width: number; height: number };
    /** Markup this change introduced; the subject does not exist in the
     * screen's source yet, so it must be added rather than relocated. */
    insertedHtml?: string;
    /** The inserted markup replaced this subject as one live gesture. */
    replaced?: true;
    replacementSelector?: string;
    replacementSourceId?: string;
    /** This change DELETED the subject; it has no anchor. */
    removed?: true;
  },
) {
  if (!canEditDesign) return;
  cancelPendingStructureVerification("conflict");
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
  const nextEdit: PendingLiveStructureEdit = {
    kind: "structure",
    screenId,
    filename: fallbackName,
    screenName: prettyScreenName(fallbackName),
    selector,
    sourceId: details?.sourceId ?? elementInfo?.sourceId ?? null,
    sourceAnchor: reactSourceAnchorForPendingEdit({
      info: elementInfo,
      id: details?.sourceId ?? elementInfo?.sourceId,
      rootPath: (() => {
        const connectionId = overviewScreens.find(
          (candidate) => candidate.id === screenId,
        )?.connectionId;
        return connectionId
          ? localhostConnectionRootPathByIdRef.current.get(connectionId)
          : undefined;
      })(),
      runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
        runtimeLayerSnapshotsById,
        elementInfo,
      ),
    }),
    anchorSelector,
    anchorSourceId: details?.anchorSourceId ?? null,
    anchorSourceAnchor: reactSourceAnchorForPendingEdit({
      info: details?.anchorElementInfo,
      id: details?.anchorSourceId,
      rootPath: (() => {
        const connectionId = overviewScreens.find(
          (candidate) => candidate.id === screenId,
        )?.connectionId;
        return connectionId
          ? localhostConnectionRootPathByIdRef.current.get(connectionId)
          : undefined;
      })(),
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
    insertedHtml: details?.insertedHtml,
    ...(details?.replaced
      ? {
          replaced: true as const,
          replacementSelector: details.replacementSelector,
          replacementSourceId: details.replacementSourceId,
        }
      : {}),
    ...(details?.removed ? { removed: true as const } : {}),
    requestId: details?.requestId,
    updatedAt: Date.now(),
  };
  const structureRedoReplay = pendingStructureRedoReplayRef.current;
  const replaysUndoneStructure = Boolean(
    structureRedoReplay &&
    pendingLiveStructureEditsMatch(structureRedoReplay.edit, nextEdit),
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
  pendingLiveNonStyleUndoStackRef.current = [
    ...pendingLiveNonStyleUndoStackRef.current.slice(
      -(MAX_DESIGN_UNDO_STACK - 1),
    ),
    { kind: "structure", edit: nextEdit },
  ];
  const nextPending = mergePendingLiveNonStyleEdits(
    pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit),
  );
  pendingLiveNonStyleEditsRef.current = nextPending;
  setPendingLiveNonStyleEdits(nextPending);
}
