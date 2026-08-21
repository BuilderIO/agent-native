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
  PendingLiveStructureUndoEntry,
  PendingLiveTextEdit,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  mergePendingLiveNonStyleEdits,
  pendingLiveTextUndoRevertValue,
  reactSourceAnchorForPendingEdit,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RecordPendingLiveTextEditArgs {
  activeFile: DesignFile;
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
  selectedElement: ElementInfo | null;
  setPendingLiveNonStyleEdits: Dispatch<
    SetStateAction<PendingLiveNonStyleEdit[]>
  >;
}

export function runRecordPendingLiveTextEdit(
  {
    activeFile,
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
  },
) {
  if (!canEditDesign) return;
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
    originalValue,
    originalHtml,
    updatedAt: Date.now(),
  };
  const revert = pendingLiveTextUndoRevertValue(
    pendingLiveNonStyleEditsRef.current,
    nextEdit,
  );
  pendingLiveNonStyleUndoStackRef.current = [
    ...pendingLiveNonStyleUndoStackRef.current.slice(
      -(MAX_DESIGN_UNDO_STACK - 1),
    ),
    {
      kind: "text",
      edit: nextEdit,
      revertValue: revert.value,
      revertHtml: revert.html,
    },
  ];
  const nextPending = mergePendingLiveNonStyleEdits(
    pendingLiveNonStyleUndoStackRef.current.map((entry) => entry.edit),
  );
  pendingLiveNonStyleEditsRef.current = nextPending;
  setPendingLiveNonStyleEdits(nextPending);
}
