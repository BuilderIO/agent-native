import type { InteractionState } from "@shared/interaction-states";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { ElementInfo } from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import type {
  PatchProofState,
  PendingStructureVerificationStatus,
  ResponsiveEditScope,
  RuntimeLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { runtimeMultiplicityForElementProvenance } from "@/pages/design-editor/editor-helpers";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import { MAX_DESIGN_UNDO_STACK } from "@/pages/design-editor/history";
import type {
  PendingLiveNonStyleUndoEntry,
  PendingLiveStructureUndoEntry,
  PendingVisualStyleEdit,
  PendingVisualStyleUndoEntry,
} from "@/pages/design-editor/pending-edits";
import {
  mergePendingVisualStyleEdits,
  originalStylesForPendingVisualEdit,
  pendingVisualStyleUndoRevertStyles,
  reactSourceAnchorForPendingEdit,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface RecordPendingVisualStyleEditArgs {
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthState: number | undefined;
  activeFile: DesignFile;
  canEditDesign: boolean;
  cancelPendingStructureVerification: (
    nextStatus?: PendingStructureVerificationStatus,
  ) => void;
  clipboardPasteRedoStackRef: RefObject<ContentHistoryChange[]>;
  files: DesignFile[];
  getProjectionContentForScreen: (screenId: string) => string;
  localhostConnectionRootPathByIdRef: RefObject<Map<string, string>>;
  overviewScreens: OverviewScreen[];
  pendingLiveNonStyleRedoStackRef: RefObject<PendingLiveNonStyleUndoEntry[]>;
  pendingStructureRedoReplayRef: RefObject<
    PendingLiveStructureUndoEntry | undefined
  >;
  pendingStructureRedoReplayTimerRef: RefObject<number | undefined>;
  pendingVisualStyleEditsRef: RefObject<PendingVisualStyleEdit[]>;
  pendingVisualStyleRedoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  pendingVisualStyleUndoStackRef: RefObject<PendingVisualStyleUndoEntry[]>;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  selectedElement: ElementInfo | null;
  setPatchProof: Dispatch<SetStateAction<PatchProofState | null>>;
  setPendingVisualStyleEdits: Dispatch<
    SetStateAction<PendingVisualStyleEdit[]>
  >;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
}

export function runRecordPendingVisualStyleEdit(
  {
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthState,
    activeFile,
    canEditDesign,
    cancelPendingStructureVerification,
    clipboardPasteRedoStackRef,
    files,
    getProjectionContentForScreen,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    pendingLiveNonStyleRedoStackRef,
    pendingStructureRedoReplayRef,
    pendingStructureRedoReplayTimerRef,
    pendingVisualStyleEditsRef,
    pendingVisualStyleRedoStackRef,
    pendingVisualStyleUndoStackRef,
    responsiveEditScopeRef,
    runtimeLayerSnapshotsById,
    selectedElement,
    setPatchProof,
    setPendingVisualStyleEdits,
    setSelectedElement,
    setSelectedLayerIdsState,
  }: RecordPendingVisualStyleEditArgs,
  screenId: string,
  selector: string,
  styles: Record<string, string>,
  elementInfo?: ElementInfo,
  metadata?: {
    originalStyles?: Record<string, string>;
    interactionState?: InteractionState;
  },
) {
  if (!canEditDesign) return;
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return;
  const stylePatch = Object.fromEntries(entries);
  const screen = files.find((file) => file.id === screenId);
  const fallbackName = screen?.filename ?? screenId;
  const sourceId =
    elementInfo?.sourceId ??
    (screenId === activeFile?.id ? selectedElement?.sourceId : null);
  // A localhost screen's live document and its source projection use
  // different node-id namespaces, so the projection pair above cannot
  // address the running DOM. Carry the runtime pair too or every undo
  // replay silently resolves nothing (see runtimeStyleTarget).
  const runtimeInfo =
    elementInfo ?? (screenId === activeFile?.id ? selectedElement : null);
  const proofId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [firstProperty, firstValue] = entries[0];
  const baseStyles = metadata?.interactionState
    ? originalStylesForPendingVisualEdit(
        stylePatch,
        screenId === activeFile?.id ? selectedElement : null,
        elementInfo,
      )
    : undefined;
  const originalStyles = metadata?.interactionState
    ? Object.fromEntries(entries.map(([property]) => [property, ""]))
    : (metadata?.originalStyles ??
      originalStylesForPendingVisualEdit(
        stylePatch,
        screenId === activeFile?.id ? selectedElement : null,
        elementInfo,
      ));
  cancelPendingStructureVerification("conflict");
  pendingVisualStyleRedoStackRef.current = [];
  pendingLiveNonStyleRedoStackRef.current = [];
  clipboardPasteRedoStackRef.current = [];
  pendingStructureRedoReplayRef.current = undefined;
  if (pendingStructureRedoReplayTimerRef.current !== undefined) {
    window.clearTimeout(pendingStructureRedoReplayTimerRef.current);
    pendingStructureRedoReplayTimerRef.current = undefined;
  }
  const nextEdit: PendingVisualStyleEdit = {
    screenId,
    filename: fallbackName,
    screenName: prettyScreenName(fallbackName),
    selector,
    sourceId,
    runtimeSelector: runtimeInfo?.runtimeSelector ?? null,
    runtimeSourceId: runtimeInfo?.runtimeSourceId ?? null,
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
    styles: stylePatch,
    originalStyles,
    ...(metadata?.interactionState
      ? { interactionState: metadata.interactionState, baseStyles }
      : {}),
    updatedAt: Date.now(),
    // §6.4 — stamp the active breakpoint scope so the agent applies
    // these as width-scoped overrides, not base writes.
    ...(activeBreakpointWidthState != null
      ? {
          breakpoint: {
            activeWidthPx: activeBreakpointWidthState,
            upperBoundPx: activeBreakpointUpperBoundPx,
            editScope: responsiveEditScopeRef.current,
          },
        }
      : {}),
  };
  const revertStyles = pendingVisualStyleUndoRevertStyles(
    pendingVisualStyleEditsRef.current,
    nextEdit,
  );
  pendingVisualStyleUndoStackRef.current = [
    ...pendingVisualStyleUndoStackRef.current.slice(
      -(MAX_DESIGN_UNDO_STACK - 1),
    ),
    { edit: nextEdit, revertStyles },
  ];
  const nextPending = mergePendingVisualStyleEdits(
    pendingVisualStyleUndoStackRef.current.map((entry) => entry.edit),
  );
  pendingVisualStyleEditsRef.current = nextPending;
  setPendingVisualStyleEdits(nextPending);
  setPatchProof({
    id: proofId,
    fileId: screenId,
    filename: fallbackName,
    selector,
    sourceId: sourceId ?? undefined,
    property:
      entries.length === 1
        ? firstProperty
        : entries.map(([property]) => property).join(", "),
    previousValue:
      elementInfo?.computedStyles?.[firstProperty] ??
      (screenId === activeFile?.id
        ? selectedElement?.computedStyles?.[firstProperty]
        : undefined),
    nextValue:
      entries.length === 1
        ? firstValue
        : entries
            .map(([property, value]) => `${property}: ${value}`)
            .join("; "),
    previousContent: getProjectionContentForScreen(screenId),
    capability: "deterministic-style-edit",
    confidence: 0.92,
    status: "runtime",
    createdAt: Date.now(),
  });

  if (screenId !== activeFile?.id) return;
  setSelectedElement((prev) => {
    const base = elementInfo ?? prev;
    if (!base) return prev;
    return {
      ...base,
      sourceId: sourceId ?? base.sourceId,
      selector: selector || base.selector,
      computedStyles: {
        ...base.computedStyles,
        ...stylePatch,
      },
    };
  });
  if (sourceId) {
    setSelectedLayerIdsState([sourceId]);
  }
}
