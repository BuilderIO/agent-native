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
  PendingLiveStructureUndoEntry,
  PendingLiveTextEdit,
  PendingRelativeStyleOperation,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  appendPendingLiveNonStyleUndoEntry,
  mergePendingLiveNonStyleEdit,
  nextPendingLiveEditTimestamp,
  pendingLiveTextUndoRevertValue,
  reactSourceAnchorForPendingEdit,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RecordPendingLiveTextEditArgs {
  activeFile: DesignFile;
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
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  recordPendingHistoryEntry?: (
    kind: "pending-style" | "pending-live",
    replayedRedo?: boolean,
  ) => void;
  canCoalescePendingLiveEdit?: () => boolean;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  selectedElement: ElementInfo | null;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
}

export function runRecordPendingLiveTextEdit(
  {
    activeFile,
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
    pendingVisualStyleRedoStackRef,
    recordPendingHistoryEntry,
    canCoalescePendingLiveEdit,
    runtimeLayerSnapshotsById,
    selectedElement,
    setPendingLiveNonStyleEdits,
  }: RecordPendingLiveTextEditArgs,
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
) {
  if (!canEditDesign && !canEditLiveScreens?.has(screenId)) return;
  const screen = files.find((file) => file.id === screenId);
  const fallbackName = screen?.filename ?? screenId;
  const sourceId =
    elementInfo?.sourceId ??
    (screenId === activeFile?.id ? selectedElement?.sourceId : null);
  cancelPendingStructureVerification("conflict");
  pendingLiveNonStyleRedoStackRef.current = [];
  pendingStructureRedoReplayRef.current = undefined;
  if (pendingStructureRedoReplayTimerRef.current !== undefined) {
    window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
    pendingStructureRedoReplayTimerRef.current = undefined;
  }
  pendingVisualStyleRedoStackRef.current = [];
  const originalValue =
    details?.originalValue ??
    elementInfo?.textContent ??
    (screenId === activeFile?.id ? selectedElement?.textContent : "") ??
    "";
  const originalHtml =
    details?.originalHtml ??
    elementInfo?.htmlContent ??
    (screenId === activeFile?.id ? selectedElement?.htmlContent : undefined);
  const nextEdit: PendingLiveTextEdit = {
    kind: "text",
    screenId,
    filename: fallbackName,
    screenName: prettyScreenName(fallbackName),
    selector,
    ...(details?.routePath ? { routePath: details.routePath } : {}),
    sourceId,
    sourceAnchor: reactSourceAnchorForPendingEdit({
      info: elementInfo,
      id: sourceId ?? undefined,
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
    tagName: elementInfo?.tagName ?? null,
    classes: elementInfo?.classes ?? [],
    value,
    html: details?.html,
    ...(details?.relativeOperations
      ? { relativeOperations: details.relativeOperations }
      : {}),
    originalValue,
    originalHtml,
    updatedAt: nextPendingLiveEditTimestamp(),
  };
  const revert = pendingLiveTextUndoRevertValue(
    pendingLiveNonStyleEditsRef.current,
    nextEdit,
  );
  const previousUndoLength = pendingLiveNonStyleUndoStackRef.current.length;
  appendPendingLiveNonStyleUndoEntry(
    pendingLiveNonStyleUndoStackRef.current,
    {
      kind: "text",
      edit: nextEdit,
      revertValue: revert.value,
      revertHtml: revert.html,
    },
    canCoalescePendingLiveEdit?.() ?? true,
  );
  if (pendingLiveNonStyleUndoStackRef.current.length > previousUndoLength) {
    recordPendingHistoryEntry?.("pending-live");
  }
  const nextPending = mergePendingLiveNonStyleEdit(
    pendingLiveNonStyleEditsRef.current,
    nextEdit,
  );
  pendingLiveNonStyleEditsRef.current = nextPending;
  setPendingLiveNonStyleEdits(nextPending);
}
