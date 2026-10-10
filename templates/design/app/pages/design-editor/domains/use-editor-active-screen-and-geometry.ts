import {
  useActionQuery,
  useActionMutation,
  actionErrorMessage,
  callAction,
  tryCallActionKeepalive,
  readClientAppState,
} from "@agent-native/core/client/hooks";
import {
  isBoardFile,
  normalizePoisonedBoardNestedCoords,
} from "@shared/board-file";
import { type CanvasFrameGeometryById } from "@shared/canvas-frames";
import { getFrameGroupBounds, type FrameBounds } from "@shared/canvas-math";
import type { A11yFinding } from "@shared/design-review";
import { breakpointUpperBoundPx } from "@shared/responsive-classes";
import {
  getResponsiveBreakpointHeightPx,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "@shared/responsive-frame-layout";
import { sourceContentHash } from "@shared/source-workspace";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { DesignMigrationResult } from "@/components/design/editor/MakeRealDialog";
import { type LocalhostWriteConsentPayload } from "@/components/design/LocalhostWriteConsentDialog";
import { deviceViewportFloorForWidth } from "@/components/design/multi-screen/frame-geometry";
import { resolveScreenHeightMode } from "@/components/design/multi-screen/screen-height";
import type { KScaleStyleChangesByFrameId } from "@/components/design/multi-screen/types";
import type { DeviceFrameType } from "@/components/design/types";
import { DEVICE_FRAME_VIEWPORTS } from "@/components/design/types";
import { type DesignEditorCommand } from "@/hooks/use-navigation-state";
import {
  createDesignSaveOutboxEntry,
  isRejectedRestoreClaimError,
  rejectedRestoreClaimTargetFileIds,
  reconcileRejectedRestoreClaimOutboxEntry,
  stripRejectedRestoreClaimAssignments,
  type DesignSaveOutboxEntry,
} from "@/lib/design-save-outbox";
import {
  clearPendingGeneration,
  hasPendingGenerationOutput,
  readPendingGeneration,
} from "@/lib/pending-generation";
import { externalPreviewUrlForContent } from "@/pages/design-editor/preview-html";

import { normalizedDesignFileType } from "../canvas-primitive-insert";
import type { ResponsiveEditScope } from "../command-types";
import { runApplyDesignEditorCommand } from "../commands/apply-design-editor-command";
import { runConfirmMakeReal } from "../commands/confirm-make-real";
import { runGeometryCommit } from "../commands/geometry-commit";
import {
  beginOptimisticBreakpointSetPatch,
  optimisticRemoveBreakpointData,
} from "../commands/optimistic-breakpoint-mutation";
import { runPersistFrameGeometrySave } from "../commands/persist-frame-geometry-save";
import {
  refetchDesignAfterGeometrySaves,
  runWriteFrameGeometrySnapshot,
} from "../commands/write-frame-geometry-snapshot";
import {
  applyDesignDataOperations,
  buildFrameGeometryDataOperations,
  clearAcknowledgedDesignDataOperationsThroughRevision,
  compactDesignDataOperations,
  pendingDesignDataOperations,
  stagePendingDesignDataOperations,
  type DesignDataOperation,
  type PendingDesignDataOperations,
} from "../data-operations";
import { deriveDesignBreakpoints } from "../derive/design-breakpoints";
import {
  cloneCanvasFrameGeometry,
  frameHeightChangedIds,
  getCanvasFrameGeometry,
  getDesignDataRecord,
} from "../design-data-geometry-utils";
import { type UndoRedoOrderKind } from "../editor-state";
import { runResumePendingGeneration } from "../effects/resume-pending-generation";
import {
  quantizeCanvasFrameGeometryForPersist,
  sanitizeCanvasFrameGeometryForPersist,
} from "../geometry-persistence";
import {
  type ContentHistoryChange,
  type FileDeletionRestoreClaim,
} from "../history";
import {
  screenRootFrameRenderingOptions,
  setScreenRootDefaultHeightMode,
  setScreenRootFrameRenderingStyles,
  warnIfPoisonedBoardCoordsNormalized,
} from "../html-layer-positioning";
import { applyKScaleStyleChanges } from "../k-scale";
import { localhostConsentRequestDisposition } from "../localhost-consent-request";
import { type MotionTimelineQueryResult } from "../motion-state";
import {
  clampOverviewDisplayZoom,
  getAllScreenFrameEntries,
  getDefaultOverviewCanvasZoom,
  getNextZoomStepDown,
  getNextZoomStepUp,
  getOverviewCanvasZoom,
  getOverviewDisplayZoom,
  getOverviewZoomScale,
  resolveOverviewZoomBasisScreenId,
  resolveZoomUpdate,
  shouldResetExplicitOverviewZoomOnBasisChange,
} from "../overview-camera";
import {
  activeRuntimeReloadFrameId,
  resolveOverviewScreenSourceType,
} from "../pending-edits";
import {
  DEFAULT_INTERACT_DEVICE_PRESET,
  findInteractDevicePreset,
  INTERACT_CUSTOM_DEVICE_NAME,
} from "../responsive-interact";
import {
  getOverviewScreenExportGeometryById,
  resolveAvailableActiveFileId,
} from "../selection-state";
import { FOCUSED_SCREEN_ZOOM } from "../types";
import type { EditorCore } from "./use-editor-core";
import type { EditorFilesAndSaving } from "./use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "./use-editor-generation-and-access";
import type { EditorHistory } from "./use-editor-history";

export function createFrameGeometryDataSavePayload(input: {
  id: string;
  dataOperations: readonly DesignDataOperation[];
  operationSource: string;
  operationRevision: number;
  restoreClaims?: readonly FileDeletionRestoreClaim[];
}): Record<string, unknown> {
  const { id, dataOperations, operationSource, operationRevision } = input;
  return {
    id,
    dataOperations,
    operationSource,
    operationRevision,
    ...(input.restoreClaims?.length
      ? {
          restoreClaims: input.restoreClaims.map((claim) => ({ ...claim })),
        }
      : {}),
  };
}

export type ReconciledFrameGeometrySaveResult =
  | { status: "saved" }
  | { status: "retry"; error: unknown };

export async function persistReconciledFrameGeometryEntry(
  entry: DesignSaveOutboxEntry,
  actions: {
    journal: (entry: DesignSaveOutboxEntry) => Promise<unknown>;
    save: (payload: Record<string, unknown>) => Promise<unknown>;
    acknowledge: (entry: DesignSaveOutboxEntry) => Promise<unknown>;
    onSaved: () => void;
    invalidate: () => void;
  },
): Promise<ReconciledFrameGeometrySaveResult> {
  await actions.journal(entry);
  try {
    await actions.save(entry.payload);
    await actions.acknowledge(entry);
  } catch (error: unknown) {
    return { status: "retry", error };
  }
  actions.onSaved();
  actions.invalidate();
  return { status: "saved" };
}

export interface PendingFrameGeometryRestoreClaim {
  designId: string;
  claim: FileDeletionRestoreClaim;
  revision: number;
}

export function stageFrameGeometryRestoreClaims(
  pending: readonly PendingFrameGeometryRestoreClaim[],
  designId: string,
  claims: readonly FileDeletionRestoreClaim[],
  revision: number,
): PendingFrameGeometryRestoreClaim[] {
  const staged = [...pending];
  const stagedKeys = new Set(
    pending.map(({ designId: stagedDesignId, claim }) =>
      JSON.stringify([stagedDesignId, claim.claimId]),
    ),
  );
  for (const claim of claims) {
    const key = JSON.stringify([designId, claim.claimId]);
    if (stagedKeys.has(key)) continue;
    staged.push({ designId, claim: { ...claim }, revision });
    stagedKeys.add(key);
  }
  return staged;
}

export function frameGeometryRestoreClaimsThroughRevision(
  pending: readonly PendingFrameGeometryRestoreClaim[],
  designId: string,
  revision: number,
): FileDeletionRestoreClaim[] {
  return pending
    .filter((item) => item.designId === designId && item.revision <= revision)
    .map(({ claim }) => claim);
}

export function frameGeometryRestoreClaimsForOperations(
  claims: readonly FileDeletionRestoreClaim[],
  operations: readonly DesignDataOperation[],
): FileDeletionRestoreClaim[] {
  return claims.filter((claim) =>
    operations.some((operation) => {
      if (
        operation.op !== "set" ||
        (operation.path[0] !== "screenMetadata" &&
          operation.path[0] !== "localhostScreens") ||
        operation.path[1] !== claim.targetFileId
      ) {
        return false;
      }
      if (operation.path.length === 3 && operation.path[2] === "connectionId") {
        return (
          typeof operation.value === "string" && operation.value.length > 0
        );
      }
      if (operation.path.length !== 2) return false;
      const metadata = operation.value;
      return (
        metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        typeof (metadata as { connectionId?: unknown }).connectionId ===
          "string" &&
        (metadata as { connectionId: string }).connectionId.length > 0
      );
    }),
  );
}

export function acknowledgeFrameGeometryRestoreClaims(
  pending: readonly PendingFrameGeometryRestoreClaim[],
  designId: string,
  acknowledgedClaims: readonly FileDeletionRestoreClaim[],
): PendingFrameGeometryRestoreClaim[] {
  const acknowledgedIds = new Set(
    acknowledgedClaims.map((claim) => claim.claimId),
  );
  if (acknowledgedIds.size === 0) return [...pending];
  return pending.filter(
    (item) =>
      item.designId !== designId || !acknowledgedIds.has(item.claim.claimId),
  );
}

export function useEditorActiveScreenAndGeometry({
  editorCore,
  editorHistory,
  editorGenerationAndAccess,
  editorFilesAndSaving,
}: {
  editorCore: EditorCore;
  editorHistory: EditorHistory;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
}) {
  const {
    t,
    id,
    isSignedIn,
    queryClient,
    shellMode,
    widgetEmbed,
    embedded,
    isLiveCanvasShareLink,
    setMode,
    setActiveTool,
    viewMode,
    setViewMode,
    viewModeRef,
    overviewInteractScreenIdRef,
    setOverviewInteractScreenId,
    setSelectedElement,
    activeFileId,
    setActiveFileId,
  } = editorCore;
  const {
    handleLiveScreenRuntimeReload,
    setActiveInspectorTab,
    setActiveLeftPanel,
    setSelectedLayerIdsState,
    invalidateRenderedElementInfo,
    setOverviewSelectedScreenIds,
    pendingOverviewScreenSelectionRef,
    setMotionDockOpen,
    setMotionDockMounted,
    clearMotionDockUnmountTimer,
    activeBreakpointWidthState,
    setActiveBreakpointWidthState,
    activeBreakpointWidthStateRef,
    activeFileIdForUndoRef,
    geometryUndoStackRef,
    explicitOverviewScreenSelectionRef,
    historyOrderRef,
    clearRedoStacks,
    captureCurrentSelection,
    syncUndoRedoState,
  } = editorHistory;
  const {
    lastGeometryCommitAtRef,
    lastGeometryCommitSourceRef,
    setDrawMode,
    setPinMode,
    setHasPendingGeneration,
    setGenerationChatTabId,
    setGenerationIssue,
    setRetryablePrompt,
    generationOutputReadyRef,
    clearGenerationCompleteTimer,
    staleToastShownRef,
    generationModelRef,
    markGenerationStale,
    agentSubmit,
    resetAgentGenerating,
    trackAgentGeneration,
    design,
    overviewDataReady,
    activeBreakpointStateVersion,
    designAccessRole,
    canEditDesign,
    failedLocalhostConsentClear,
    setFailedLocalhostConsentClear,
    localhostConsentRequestQuery,
    clearLocalhostConsentRequestMutation,
    creativeContextLab,
    canEditDesignRef,
    updateDesignMutation,
    removeBreakpointMutation,
    activeBreakpointWriteQueueRef,
    migrateMutation,
  } = editorGenerationAndAccess;
  const {
    designSaveActorScope,
    locallyPinnedHeightIdsRef,
    designSaveOperationSourceRef,
    pendingFrameGeometryOperationsForUnloadRef,
    creativeContextEnabled,
    reportSaveFailure,
    journalOutboxEntry,
    acknowledgeOutboxEntry,
    retryDesignSaveOutbox,
    queueFileContentSave,
    flushPendingFileContentSavesForBackground,
    flushPendingTweakSave,
    files,
    codeLayerSourceForScreen,
    screenRootComputedStylesById,
    designDataJson,
    designSourceType,
    designDataJsonRef,
    canvasFrameGeometryById,
    displayedCanvasFrameGeometryById,
    liveFrameGeometryRef,
    boardFileId,
    overviewScreens,
    publicVisualEditConnectionIds,
    localhostPreviewTokenQuery,
  } = editorFilesAndSaving;

  const [screenZoom, setScreenZoom] = useState(FOCUSED_SCREEN_ZOOM);
  const [cameraCommand, setCameraCommand] = useState<{
    fitBounds: FrameBounds;
    nonce: number;
    paddingScreenPx?: number;
  } | null>(null);
  const cameraCommandNonceRef = useRef(0);
  const screenZoomByIdRef = useRef<Map<string, number>>(new Map());
  const [explicitOverviewCanvasZoom, setExplicitOverviewCanvasZoom] = useState<
    number | null
  >(null);
  const [deviceFrame] = useState<DeviceFrameType>("none");
  const [interactDeviceName, setInteractDeviceName] = useState(
    DEFAULT_INTERACT_DEVICE_PRESET.name,
  );
  const [interactDeviceSize, setInteractDeviceSize] = useState({
    width: DEFAULT_INTERACT_DEVICE_PRESET.width,
    height: DEFAULT_INTERACT_DEVICE_PRESET.height,
  });
  const [
    effectivePreviewTokensByScreenId,
    setEffectivePreviewTokensByScreenId,
  ] = useState<Record<string, string>>({});
  const [
    effectiveLiveEditCapabilitiesByScreenId,
    setEffectiveLiveEditCapabilitiesByScreenId,
  ] = useState<Record<string, string>>({});
  const [
    effectiveLiveEditRegistrationCapabilitiesByScreenId,
    setEffectiveLiveEditRegistrationCapabilitiesByScreenId,
  ] = useState<Record<string, string>>({});
  const [responsiveEditScope, setResponsiveEditScope] =
    useState<ResponsiveEditScope>("cascade-smaller");
  const responsiveEditScopeRef = useRef<ResponsiveEditScope>("cascade-smaller");
  const lastAppliedActiveBreakpointIdRef = useRef<string | null>(null);
  const [reviewFileId, setReviewFileId] = useState<string | null>(null);
  const [reviewFindings, setReviewFindings] = useState<A11yFinding[]>([]);
  const [reviewAuditLoading, setReviewAuditLoading] = useState(false);
  const [reviewAuditedAt, setReviewAuditedAt] = useState<string | null>(null);
  const [reviewAuditError, setReviewAuditError] = useState<string | null>(null);
  const applyGeometryHistoryContentChangesRef = useRef<
    (
      changes: readonly ContentHistoryChange[],
      direction: "commit" | "undo" | "redo",
    ) => void
  >(() => {});
  const frameGeometrySaveTimerRef = useRef<number | null>(null);
  const pendingFrameGeometrySaveRef = useRef<{
    geometryById: CanvasFrameGeometryById;
    previousGeometry: CanvasFrameGeometryById;
  } | null>(null);
  const frameGeometryOperationRevisionRef = useRef(0);
  const pendingFrameGeometryRestoreClaimsRef = useRef<
    PendingFrameGeometryRestoreClaim[]
  >([]);
  const rejectedFrameGeometryRestoreClaimsRef = useRef<
    Array<{ designId: string; claim: FileDeletionRestoreClaim }>
  >([]);
  const frameGeometryMutationChainRef = useRef<Promise<void>>(
    Promise.resolve(),
  );
  const frameGeometrySavesInFlightRef = useRef(0);
  const designRefetchCancelledRef = useRef(false);
  const refetchDesignCancelledByGeometryWrite = useCallback(
    () =>
      refetchDesignAfterGeometrySaves({
        designRefetchCancelledRef,
        frameGeometrySavesInFlightRef,
        id,
        pendingFrameGeometrySaveRef,
        queryClient,
      }),
    [id, queryClient],
  );
  const [localhostWriteConsentOpen, setLocalhostWriteConsentOpen] =
    useState(false);
  const [localhostWriteConsentPayload, setLocalhostWriteConsentPayload] =
    useState<LocalhostWriteConsentPayload | null>(null);
  const [localhostConsentConnectionId, setLocalhostConsentConnectionId] =
    useState<string>("");
  const lastLocalhostConsentRequestRef = useRef<string | null>(null);
  const saveDesignDataAsync = useActionMutation("update-design", {
    skipActionQueryInvalidation: true,
  }).mutateAsync;
  const persistActiveBreakpoint = useCallback(
    (breakpointId: string, editScope: ResponsiveEditScope) => {
      if (!id) return;
      activeBreakpointWriteQueueRef.current?.enqueue({
        designId: id,
        breakpointId,
        editScope,
      });
    },
    [id],
  );

  const [makeRealDialogOpen, setMakeRealDialogOpen] = useState(false);

  const [migrationResult, setMigrationResult] =
    useState<DesignMigrationResult | null>(null);
  const screenContentNaturalHeightByIdRef = useRef<Record<string, number>>({});
  const [screenContentNaturalHeights, setScreenContentNaturalHeights] =
    useState<Record<string, number>>({});
  const publicVisualEditConnectionId = publicVisualEditConnectionIds[0] ?? null;
  const exportCanvasFrameGeometryById = useMemo(
    () =>
      getOverviewScreenExportGeometryById({
        overviewScreens,
        canvasFrameGeometryById,
        naturalHeightsById: screenContentNaturalHeights,
        screenRootComputedStylesById,
      }),
    [
      canvasFrameGeometryById,
      overviewScreens,
      screenContentNaturalHeights,
      screenRootComputedStylesById,
    ],
  );

  const boardFileContent = useMemo(() => {
    if (!boardFileId) return undefined;
    const boardFile = files.find((file) => file.id === boardFileId);
    return typeof boardFile?.content === "string" ? boardFile.content : "";
  }, [boardFileId, files]);

  useEffect(() => {
    if (!boardFileId || !boardFileContent || !canEditDesign) return;
    const normalized = normalizePoisonedBoardNestedCoords(boardFileContent);
    if (!normalized.changed) return;
    warnIfPoisonedBoardCoordsNormalized(boardFileId, normalized);
    queueFileContentSave(boardFileId, normalized.html, {
      expectedVersionHash: sourceContentHash(boardFileContent),
    });
  }, [boardFileContent, boardFileId, canEditDesign, queueFileContentSave]);

  const acknowledgeFrameGeometryOutboxEntry = useCallback(
    async (entry: Parameters<typeof acknowledgeOutboxEntry>[0]) => {
      await acknowledgeOutboxEntry(entry);
      pendingFrameGeometryRestoreClaimsRef.current =
        acknowledgeFrameGeometryRestoreClaims(
          pendingFrameGeometryRestoreClaimsRef.current,
          entry.designId,
          Array.isArray(entry.payload.restoreClaims)
            ? (entry.payload.restoreClaims as FileDeletionRestoreClaim[])
            : [],
        );
    },
    [acknowledgeOutboxEntry],
  );

  const createFrameGeometryOutboxEntry = useCallback(
    (
      dataOperations: readonly DesignDataOperation[],
      revision: number,
      operationSource = designSaveOperationSourceRef.current,
    ) => {
      if (!id || shellMode) return null;
      const compacted = compactDesignDataOperations(dataOperations);
      if (compacted.length === 0) return null;
      const restoreClaims = frameGeometryRestoreClaimsThroughRevision(
        pendingFrameGeometryRestoreClaimsRef.current,
        id,
        revision,
      );
      const claimsForOperations = frameGeometryRestoreClaimsForOperations(
        restoreClaims,
        compacted,
      );
      return createDesignSaveOutboxEntry({
        designId: id,
        actorScope: designSaveActorScope,
        actionName: "update-design",
        resourceId: id,
        operationSource,
        operationRevision: revision,
        payload: createFrameGeometryDataSavePayload({
          id,
          dataOperations: compacted,
          operationSource,
          operationRevision: revision,
          restoreClaims: claimsForOperations,
        }),
      });
    },
    [designSaveActorScope, id, shellMode],
  );

  const enqueueFrameGeometryDataSave = useCallback(
    (
      dataOperations: DesignDataOperation[],
      options?: { restoreClaims?: readonly FileDeletionRestoreClaim[] },
    ) => {
      if (
        !id ||
        shellMode ||
        !canEditDesignRef.current ||
        dataOperations.length === 0
      ) {
        return false;
      }
      const revision = frameGeometryOperationRevisionRef.current + 1;
      frameGeometryOperationRevisionRef.current = revision;
      const incomingRestoreClaims = options?.restoreClaims ?? [];
      if (incomingRestoreClaims.length > 0) {
        const retryTargetFileIds = new Set(
          incomingRestoreClaims.map((claim) => claim.targetFileId),
        );
        rejectedFrameGeometryRestoreClaimsRef.current =
          rejectedFrameGeometryRestoreClaimsRef.current.filter(
            (item) =>
              item.designId !== id ||
              !retryTargetFileIds.has(item.claim.targetFileId),
          );
      }
      pendingFrameGeometryRestoreClaimsRef.current =
        stageFrameGeometryRestoreClaims(
          pendingFrameGeometryRestoreClaimsRef.current,
          id,
          incomingRestoreClaims,
          revision,
        );
      pendingFrameGeometryOperationsForUnloadRef.current =
        stagePendingDesignDataOperations(
          pendingFrameGeometryOperationsForUnloadRef.current,
          dataOperations,
          revision,
        );
      const operationsForRevision = pendingDesignDataOperations(
        pendingFrameGeometryOperationsForUnloadRef.current,
      );
      if (operationsForRevision.length === 0) return false;
      const operationSource = designSaveOperationSourceRef.current;
      frameGeometrySavesInFlightRef.current += 1;
      const previous = frameGeometryMutationChainRef.current;
      const current = previous
        .catch(() => {})
        .then(async () => {
          let outboxEntry: ReturnType<typeof createFrameGeometryOutboxEntry> =
            null;
          try {
            const rejectedAssignments = stripRejectedRestoreClaimAssignments(
              operationsForRevision,
              rejectedFrameGeometryRestoreClaimsRef.current
                .filter((item) => item.designId === id)
                .map((item) => item.claim),
            );
            outboxEntry = createFrameGeometryOutboxEntry(
              rejectedAssignments.operations as DesignDataOperation[],
              revision,
              operationSource,
            );
            if (!outboxEntry) return;
            await journalOutboxEntry(outboxEntry);
            await saveDesignDataAsync(outboxEntry.payload as any);
            pendingFrameGeometryOperationsForUnloadRef.current =
              clearAcknowledgedDesignDataOperationsThroughRevision(
                pendingFrameGeometryOperationsForUnloadRef.current,
                revision,
              );
            await acknowledgeFrameGeometryOutboxEntry(outboxEntry);
          } catch (error: unknown) {
            const restoreClaims = Array.isArray(
              outboxEntry?.payload.restoreClaims,
            )
              ? (outboxEntry.payload
                  .restoreClaims as FileDeletionRestoreClaim[])
              : [];
            const rejectedTargetFileIds = rejectedRestoreClaimTargetFileIds(
              error,
              restoreClaims,
            );
            const rejectedTargetFileIdSet = new Set(rejectedTargetFileIds);
            const rejectedClaims = restoreClaims.filter((claim) =>
              rejectedTargetFileIdSet.has(claim.targetFileId),
            );
            let reconciledEntryOwnsInvalidation = false;
            let reconciledEntryWasSaved = false;
            let reconciledEntryRetryFailure: Extract<
              ReconciledFrameGeometrySaveResult,
              { status: "retry" }
            > | null = null;
            if (
              outboxEntry &&
              rejectedClaims.length > 0 &&
              isRejectedRestoreClaimError(error)
            ) {
              const rejectedEntry = outboxEntry;
              const rejectedIds = new Set(
                rejectedFrameGeometryRestoreClaimsRef.current
                  .filter((item) => item.designId === rejectedEntry.designId)
                  .map((item) => item.claim.claimId),
              );
              rejectedFrameGeometryRestoreClaimsRef.current = [
                ...rejectedFrameGeometryRestoreClaimsRef.current,
                ...rejectedClaims
                  .filter((claim) => !rejectedIds.has(claim.claimId))
                  .map((claim) => ({
                    designId: rejectedEntry.designId,
                    claim,
                  })),
              ];
              pendingFrameGeometryRestoreClaimsRef.current =
                acknowledgeFrameGeometryRestoreClaims(
                  pendingFrameGeometryRestoreClaimsRef.current,
                  rejectedEntry.designId,
                  rejectedClaims,
                );
              const reconciledEntry = reconcileRejectedRestoreClaimOutboxEntry(
                rejectedEntry,
                rejectedTargetFileIds,
              );
              const reconciledOperations = reconciledEntry
                ? (reconciledEntry.payload
                    .dataOperations as DesignDataOperation[])
                : [];
              let pendingOperations: PendingDesignDataOperations =
                clearAcknowledgedDesignDataOperationsThroughRevision(
                  pendingFrameGeometryOperationsForUnloadRef.current,
                  revision,
                );
              for (const operation of reconciledOperations) {
                const key = JSON.stringify(operation.path);
                if (pendingOperations[key]) continue;
                pendingOperations = stagePendingDesignDataOperations(
                  pendingOperations,
                  [operation],
                  revision,
                );
              }
              pendingFrameGeometryOperationsForUnloadRef.current =
                pendingOperations;
              if (reconciledEntry) {
                reconciledEntryOwnsInvalidation = true;
                const saveResult = await persistReconciledFrameGeometryEntry(
                  reconciledEntry,
                  {
                    journal: journalOutboxEntry,
                    save: (payload) =>
                      saveDesignDataAsync(
                        payload as Parameters<typeof saveDesignDataAsync>[0],
                      ),
                    acknowledge: acknowledgeFrameGeometryOutboxEntry,
                    onSaved: () => {
                      pendingFrameGeometryOperationsForUnloadRef.current =
                        clearAcknowledgedDesignDataOperationsThroughRevision(
                          pendingFrameGeometryOperationsForUnloadRef.current,
                          revision,
                        );
                    },
                    invalidate: () => {
                      void queryClient.invalidateQueries({
                        queryKey: ["action", "get-design"],
                      });
                    },
                  },
                );
                reconciledEntryWasSaved = saveResult.status === "saved";
                if (saveResult.status === "retry") {
                  reconciledEntryRetryFailure = saveResult;
                }
              } else {
                await acknowledgeFrameGeometryOutboxEntry(outboxEntry);
              }
            }
            if (!reconciledEntryOwnsInvalidation) {
              void queryClient.invalidateQueries({
                queryKey: ["action", "get-design"],
              });
            }
            if (!reconciledEntryWasSaved) {
              if (reconciledEntryRetryFailure) {
                console.warn(
                  "Reconciled frame geometry save remains queued for retry.",
                  reconciledEntryRetryFailure.error,
                );
              }
              reportSaveFailure(reconciledEntryRetryFailure?.error ?? error);
            }
          }
        });
      frameGeometryMutationChainRef.current = current;
      void current.finally(() => {
        frameGeometrySavesInFlightRef.current -= 1;
        if (frameGeometryMutationChainRef.current === current) {
          frameGeometryMutationChainRef.current = Promise.resolve();
        }
        refetchDesignCancelledByGeometryWrite();
      });
      return true;
    },
    [
      acknowledgeFrameGeometryOutboxEntry,
      createFrameGeometryOutboxEntry,
      id,
      journalOutboxEntry,
      queryClient,
      refetchDesignCancelledByGeometryWrite,
      saveDesignDataAsync,
      shellMode,
      reportSaveFailure,
    ],
  );

  const handleOverviewBreakpointContentHeightChange = useCallback(
    (screenId: string, widthPx: number, heightPx: number) => {
      if (
        !id ||
        !canEditDesignRef.current ||
        !Number.isSafeInteger(widthPx) ||
        widthPx <= 0 ||
        !Number.isFinite(heightPx) ||
        heightPx <= 0 ||
        heightPx > MAX_SANE_FRAME_DIMENSION_PX
      ) {
        return;
      }
      const screen = overviewScreens.find((item) => item.id === screenId);
      if (!screen) return;
      const metadataById = getDesignDataRecord(
        designDataJsonRef.current,
        "screenMetadata",
      );
      const metadata = getDesignDataRecord(metadataById, screenId);
      const existingHeight = getResponsiveBreakpointHeightPx(metadata, widthPx);
      const measuredHeight = Math.max(
        deviceViewportFloorForWidth(widthPx),
        Math.round(heightPx),
      );
      const projectedHeight =
        (widthPx * (screen.height ?? 2560)) / (screen.width ?? 1280);
      if (
        measuredHeight <=
        Math.max(projectedHeight, existingHeight ?? 0) + 1
      ) {
        return;
      }
      const operation: DesignDataOperation = {
        op: "set",
        path: [
          "screenMetadata",
          screenId,
          "breakpointHeights",
          String(widthPx),
        ],
        value: measuredHeight,
      };
      const nextData = applyDesignDataOperations(designDataJsonRef.current, [
        operation,
      ]);
      designDataJsonRef.current = nextData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) =>
        old && typeof old === "object"
          ? { ...old, data: JSON.stringify(nextData) }
          : old,
      );
      enqueueFrameGeometryDataSave([operation]);
    },
    [enqueueFrameGeometryDataSave, id, overviewScreens, queryClient],
  );

  const handleOverviewScreenContentNaturalHeightChange = useCallback(
    (screenId: string, heightPx: number | null) => {
      if (heightPx === null) {
        delete screenContentNaturalHeightByIdRef.current[screenId];
        setScreenContentNaturalHeights((previous) => {
          if (!(screenId in previous)) return previous;
          const next = { ...previous };
          delete next[screenId];
          return next;
        });
        return;
      }
      if (
        !Number.isFinite(heightPx) ||
        heightPx <= 0 ||
        heightPx > MAX_SANE_FRAME_DIMENSION_PX
      ) {
        return;
      }
      const naturalHeight = Math.round(heightPx);
      screenContentNaturalHeightByIdRef.current[screenId] = naturalHeight;
      setScreenContentNaturalHeights((previous) =>
        previous[screenId] === naturalHeight
          ? previous
          : { ...previous, [screenId]: naturalHeight },
      );
    },
    [],
  );

  const persistFrameGeometrySave = useCallback(
    (
      pending: {
        geometryById: CanvasFrameGeometryById;
        previousGeometry: CanvasFrameGeometryById;
      },
      keepalive = false,
    ): boolean =>
      runPersistFrameGeometrySave(
        {
          acknowledgeOutboxEntry: acknowledgeFrameGeometryOutboxEntry,
          boardFileId,
          canEditDesignRef,
          createFrameGeometryOutboxEntry,
          designDataJsonRef,
          enqueueFrameGeometryDataSave,
          frameGeometryOperationRevisionRef,
          id,
          journalOutboxEntry,
          pendingFrameGeometryOperationsForUnloadRef,
          queryClient,
          reportSaveFailure,
        },
        pending,
        keepalive,
      ),
    [
      acknowledgeFrameGeometryOutboxEntry,
      boardFileId,
      createFrameGeometryOutboxEntry,
      enqueueFrameGeometryDataSave,
      id,
      journalOutboxEntry,
      queryClient,
      reportSaveFailure,
    ],
  );

  const flushPendingFrameGeometrySave = useCallback(
    (keepalive = false) => {
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
        frameGeometrySaveTimerRef.current = null;
      }
      const pending = pendingFrameGeometrySaveRef.current;
      if (!pending) return;
      if (persistFrameGeometrySave(pending, keepalive)) {
        pendingFrameGeometrySaveRef.current = null;
        refetchDesignCancelledByGeometryWrite();
      }
    },
    [persistFrameGeometrySave, refetchDesignCancelledByGeometryWrite],
  );

  const queueFrameGeometrySave = useCallback(
    (geometryById: CanvasFrameGeometryById) => {
      if (!id || !canEditDesignRef.current) return;
      const previousGeometry = cloneCanvasFrameGeometry(
        getCanvasFrameGeometry(designDataJsonRef.current),
      );
      pendingFrameGeometrySaveRef.current = {
        geometryById: quantizeCanvasFrameGeometryForPersist(
          cloneCanvasFrameGeometry(geometryById),
          previousGeometry,
        ),
        previousGeometry,
      };
      const pending = pendingFrameGeometrySaveRef.current;
      const { geometryById: safeGeometryById } =
        sanitizeCanvasFrameGeometryForPersist(
          pending.geometryById,
          pending.previousGeometry,
          boardFileId ? [boardFileId] : [],
        );
      const dataOperations = buildFrameGeometryDataOperations({
        previousGeometry: pending.previousGeometry,
        nextGeometry: safeGeometryById,
        designData: designDataJsonRef.current,
      });
      const combinedOperations = compactDesignDataOperations([
        ...pendingDesignDataOperations(
          pendingFrameGeometryOperationsForUnloadRef.current,
        ),
        ...dataOperations,
      ]);
      if (combinedOperations.length > 0) {
        const revision = frameGeometryOperationRevisionRef.current + 1;
        frameGeometryOperationRevisionRef.current = revision;
        const entry = createFrameGeometryOutboxEntry(
          combinedOperations,
          revision,
        );
        if (entry) void journalOutboxEntry(entry);
      }
      if (frameGeometrySaveTimerRef.current !== null) {
        window.clearTimeout(frameGeometrySaveTimerRef.current);
      }
      frameGeometrySaveTimerRef.current = window.setTimeout(
        flushPendingFrameGeometrySave,
        500,
      );
    },
    [
      boardFileId,
      createFrameGeometryOutboxEntry,
      flushPendingFrameGeometrySave,
      id,
      journalOutboxEntry,
    ],
  );

  const writeFrameGeometrySnapshot = useCallback(
    (
      geometryById: CanvasFrameGeometryById,
      options?: {
        replacePendingGeometrySave?: boolean;
        syncViewportFrameIds?: string[];
        pinHeightFrameIds?: string[];
      },
    ) =>
      runWriteFrameGeometrySnapshot(
        {
          boardFileId,
          canEditDesignRef,
          designDataJsonRef,
          designRefetchCancelledRef,
          enqueueFrameGeometryDataSave,
          frameGeometrySaveTimerRef,
          id,
          liveFrameGeometryRef,
          pendingFrameGeometrySaveRef,
          queryClient,
        },
        geometryById,
        options,
      ),
    [
      boardFileId,
      enqueueFrameGeometryDataSave,
      id,
      liveFrameGeometryRef,
      queryClient,
    ],
  );

  const handleGeometryCommit = useCallback(
    (
      before: CanvasFrameGeometryById,
      after: CanvasFrameGeometryById,
      options?: {
        source?: "pointer" | "keyboard";
        kScaleStyleChangesByFrameId?: KScaleStyleChangesByFrameId;
      },
    ) => {
      const heightChangedScreenIds = new Set(
        frameHeightChangedIds(before, after),
      );
      const committed = runGeometryCommit(
        {
          boardFileId,
          captureLinkedContentChanges: (
            linkedFrameIds,
            kScaleStyleChangesByFrameId,
          ) => {
            const changes: ContentHistoryChange[] = [];
            for (const screenId of linkedFrameIds) {
              const scaleChanges =
                kScaleStyleChangesByFrameId?.[screenId] ?? [];
              const heightChanged = heightChangedScreenIds.has(screenId);
              const screen = overviewScreens.find(
                (candidate) => candidate.id === screenId,
              );
              if (!screen) {
                if (scaleChanges.length > 0) return null;
                continue;
              }
              const beforeContent = screen.content;
              if (
                scaleChanges.length > 0 &&
                externalPreviewUrlForContent(beforeContent) !== null
              ) {
                return null;
              }
              let afterContent = beforeContent;
              if (scaleChanges.length > 0) {
                const patch = applyKScaleStyleChanges(
                  afterContent,
                  scaleChanges,
                  codeLayerSourceForScreen(screenId),
                );
                if (patch.status !== "applied") return null;
                afterContent = patch.content;
              }
              const metadata = getDesignDataRecord(
                getDesignDataRecord(
                  designDataJsonRef.current,
                  "screenMetadata",
                ),
                screenId,
              );
              if (
                resolveScreenHeightMode(
                  metadata.heightMode,
                  metadata.heightPinned === true,
                  metadata.sourceType,
                ) !== "hug"
              ) {
                if (beforeContent !== afterContent) {
                  changes.push({
                    fileId: screenId,
                    before: beforeContent,
                    after: afterContent,
                  });
                }
                continue;
              }
              if (!heightChanged) {
                if (beforeContent !== afterContent) {
                  changes.push({
                    fileId: screenId,
                    before: beforeContent,
                    after: afterContent,
                  });
                }
                continue;
              }
              if (externalPreviewUrlForContent(afterContent) !== null)
                return null;
              const rootStyles = screenRootComputedStylesById[screenId] ?? {};
              afterContent = setScreenRootFrameRenderingStyles(
                setScreenRootDefaultHeightMode(afterContent, "fixed"),
                screenRootFrameRenderingOptions(rootStyles, true),
              );
              if (beforeContent === afterContent) continue;
              const modePath: DesignDataOperation["path"] = [
                "screenMetadata",
                screenId,
                "heightMode",
              ];
              const pinnedPath: DesignDataOperation["path"] = [
                "screenMetadata",
                screenId,
                "heightPinned",
              ];
              const undo = [
                metadata.heightMode === undefined
                  ? { op: "delete" as const, path: modePath }
                  : {
                      op: "set" as const,
                      path: modePath,
                      value: metadata.heightMode,
                    },
                metadata.heightPinned === undefined
                  ? { op: "delete" as const, path: pinnedPath }
                  : {
                      op: "set" as const,
                      path: pinnedPath,
                      value: metadata.heightPinned,
                    },
              ];
              const redo: DesignDataOperation[] = [
                {
                  op: "set",
                  path: modePath,
                  value: "fixed",
                },
                {
                  op: "set",
                  path: pinnedPath,
                  value: true,
                },
              ];
              changes.push({
                fileId: screenId,
                before: beforeContent,
                after: afterContent,
                designDataChange: { undo, redo },
              });
            }
            return changes;
          },
          captureCurrentSelection,
          clearRedoStacks,
          designDataJsonRef,
          designRefetchCancelledRef,
          geometryUndoStackRef,
          historyOrderRef: historyOrderRef as React.RefObject<
            UndoRedoOrderKind[]
          >,
          id,
          applyLinkedContentChanges: (changes, direction) =>
            applyGeometryHistoryContentChangesRef.current(changes, direction),
          lastGeometryCommitAtRef,
          lastGeometryCommitSourceRef,
          liveFrameGeometryRef,
          locallyPinnedHeightIdsRef,
          queryClient,
          queueFrameGeometrySave,
          syncUndoRedoState,
          writeFrameGeometrySnapshot,
        },
        before,
        after,
        options,
      );
      if (!committed) {
        toast.error(t("designEditor.patchProof.selectorMissing"));
      }
      return committed;
    },
    [
      boardFileId,
      clearRedoStacks,
      codeLayerSourceForScreen,
      id,
      overviewScreens,
      queryClient,
      queueFrameGeometrySave,
      screenRootComputedStylesById,
      syncUndoRedoState,
      t,
      liveFrameGeometryRef,
      writeFrameGeometrySnapshot,
    ],
  );

  const handleOpenMakeReal = useCallback(() => {
    setMigrationResult(null);
    setMakeRealDialogOpen(true);
  }, []);

  const handleConfirmMakeReal = useCallback(
    async () =>
      runConfirmMakeReal({
        designDataJsonRef,
        id,
        migrateMutation,
        queryClient,
        setMigrationResult,
        updateDesignMutation,
      }),
    [id, migrateMutation, updateDesignMutation, queryClient],
  );

  generationOutputReadyRef.current = hasPendingGenerationOutput(
    readPendingGeneration(id, { allowUntimestamped: true }),
    files,
  );

  useEffect(() => {
    if (!id) return;
    const pending = readPendingGeneration(id);
    if (!pending || pending.templateId) return;
    if (!hasPendingGenerationOutput(pending, files)) return;
    clearGenerationCompleteTimer();
    resetAgentGenerating();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [clearGenerationCompleteTimer, files, id, resetAgentGenerating]);

  useEffect(
    () =>
      runResumePendingGeneration({
        agentSubmit,
        clearGenerationCompleteTimer,
        creativeContextEnabled,
        creativeContextLabLoading: creativeContextLab.isLoading,
        creativeContextLabError: creativeContextLab.isError
          ? t("designEditor.generationStoppedRetry")
          : null,
        design,
        files,
        generationModelRef,
        imageAttachmentUnavailableMessage: t(
          "promptDialog.imageAttachmentUnavailable",
        ),
        invalidCanvasDimensionsMessage: t(
          "designEditor.invalidCanvasDimensions",
        ),
        id,
        markGenerationStale,
        setGenerationChatTabId,
        setGenerationIssue,
        setHasPendingGeneration,
        trackAgentGeneration,
      }),
    [
      id,
      design,
      files.length,
      creativeContextEnabled,
      creativeContextLab.isLoading,
      creativeContextLab.isError,
      agentSubmit,
      markGenerationStale,
      trackAgentGeneration,
      clearGenerationCompleteTimer,
      t,
    ],
  );

  useEffect(() => {
    const handlePageHide = () => {
      const pending = pendingFrameGeometrySaveRef.current;
      if (!pending) {
        if (!canEditDesignRef.current) return;
        const entry = createFrameGeometryOutboxEntry(
          pendingDesignDataOperations(
            pendingFrameGeometryOperationsForUnloadRef.current,
          ),
          frameGeometryOperationRevisionRef.current,
        );
        if (!entry) return;
        void journalOutboxEntry(entry);
        const attempt = tryCallActionKeepalive(
          "update-design",
          entry.payload as any,
        );
        if (!attempt.accepted) return;
        void attempt.completion
          .then(() => acknowledgeOutboxEntry(entry))
          .catch(reportSaveFailure);
        return;
      }
      persistFrameGeometrySave(pending, true);
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      flushPendingFrameGeometrySave();
    };
  }, [
    acknowledgeFrameGeometryOutboxEntry,
    createFrameGeometryOutboxEntry,
    flushPendingFrameGeometrySave,
    journalOutboxEntry,
    persistFrameGeometrySave,
    reportSaveFailure,
  ]);

  useEffect(() => {
    const handleBackground = () => {
      void flushPendingFileContentSavesForBackground().catch(reportSaveFailure);
      flushPendingTweakSave();
      flushPendingFrameGeometrySave();
    };
    const handleForeground = () => {
      void retryDesignSaveOutbox();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        handleBackground();
      } else {
        handleForeground();
      }
    };
    const handleLifecycleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === "agent-native:app-background") {
        handleBackground();
      } else if (event.data?.type === "agent-native:app-foreground") {
        handleForeground();
      }
    };
    const handleChatHistoryFlush = (event: Event) => {
      const pendingFlushes = (event as CustomEvent<Promise<void>[]>).detail;
      pendingFlushes.push(flushPendingFileContentSavesForBackground());
    };

    window.addEventListener("agent-native:app-background", handleBackground);
    window.addEventListener("agent-native:app-foreground", handleForeground);
    window.addEventListener(
      "agent-native:design-flush-pending-saves",
      handleChatHistoryFlush,
    );
    window.addEventListener("message", handleLifecycleMessage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(
        "agent-native:app-background",
        handleBackground,
      );
      window.removeEventListener(
        "agent-native:app-foreground",
        handleForeground,
      );
      window.removeEventListener(
        "agent-native:design-flush-pending-saves",
        handleChatHistoryFlush,
      );
      window.removeEventListener("message", handleLifecycleMessage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    flushPendingFileContentSavesForBackground,
    flushPendingFrameGeometrySave,
    flushPendingTweakSave,
    retryDesignSaveOutbox,
  ]);

  const defaultActiveFile =
    files.find(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename) &&
        file.filename.toLowerCase() === "index.html",
    ) ??
    files.find(
      (file) =>
        normalizedDesignFileType(file.fileType) === "html" &&
        !isBoardFile(file.filename),
    ) ??
    files[0];

  useEffect(() => {
    const nextActiveFileId = resolveAvailableActiveFileId({
      activeFileId,
      availableFileIds: files.map((file) => file.id),
      defaultFileId: defaultActiveFile?.id,
    });
    if (nextActiveFileId !== activeFileId) {
      setActiveFileId(nextActiveFileId);
    }
  }, [activeFileId, defaultActiveFile?.id, files]);

  const activeFile =
    files.find((f) => f.id === activeFileId) ?? defaultActiveFile;
  const handleActiveScreenRuntimeReload = useCallback(() => {
    if (activeFile) {
      handleLiveScreenRuntimeReload(
        activeFile.id,
        activeRuntimeReloadFrameId(activeBreakpointWidthStateRef.current),
      );
    }
  }, [activeFile?.id, handleLiveScreenRuntimeReload]);
  const activeRuntimeLayerReadinessScreenIdRef = useRef<string | null>(
    activeFile?.id ?? null,
  );
  activeRuntimeLayerReadinessScreenIdRef.current = activeFile?.id ?? null;
  activeFileIdForUndoRef.current = activeFile?.id ?? null;

  const designBreakpoints = useMemo(
    () => deriveDesignBreakpoints(designDataJson),
    [designDataJson],
  );

  const handleBreakpointBarSelect = useCallback(
    (widthPx: number | undefined, selectedBreakpointId?: string) => {
      // Selection and bridge events from a breakpoint iframe can be followed
      // by a style commit in the same browser task. Mirror synchronously so
      // that commit cannot observe the previous frame's scope while React is
      // still scheduling the state update.
      activeBreakpointWidthStateRef.current = widthPx;
      invalidateRenderedElementInfo();
      setActiveBreakpointWidthState(widthPx);
      if (!id) return;
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      const breakpointId =
        selectedBreakpointId ?? (widthPx !== undefined && bp ? bp.id : "auto");
      lastAppliedActiveBreakpointIdRef.current = breakpointId;
      persistActiveBreakpoint(breakpointId, responsiveEditScopeRef.current);
    },
    [
      id,
      designBreakpoints,
      invalidateRenderedElementInfo,
      persistActiveBreakpoint,
    ],
  );
  const handleResponsiveEditScopeChange = useCallback(
    (scope: ResponsiveEditScope) => {
      responsiveEditScopeRef.current = scope;
      setResponsiveEditScope(scope);
      if (!id) return;
      const activeWidth = activeBreakpointWidthStateRef.current;
      const breakpointId =
        activeWidth === undefined
          ? "auto"
          : (designBreakpoints.find((bp) => bp.widthPx === activeWidth)?.id ??
            "auto");
      persistActiveBreakpoint(breakpointId, scope);
    },
    [designBreakpoints, id, persistActiveBreakpoint],
  );

  // Item 9 — agent→UI breakpoint sync. `set-active-breakpoint` (the action
  // the agent calls) persists `design-active-breakpoint:<designId>` to
  // application state so the agent and UI agree on the active edit scope;
  // this effect is the UI half that was previously missing — the BreakpointBar
  // chip/viewport-width only ever changed from the UI's own chip clicks.
  // React to the targeted active-breakpoint app-state counter, read the key,
  // and apply it -
  // except this key is a durable "current scope" value (not a one-shot
  // command), so unlike that effect this one does NOT null the key out after
  // reading; it just dedupes against the last-applied breakpointId so the
  // UI's own echoed write doesn't re-run every local setter on every chip
  // click (see lastAppliedActiveBreakpointIdRef's doc comment above, and
  // handleBreakpointBarSelect/handleBreakpointBarRemove/
  // handleOverviewActiveBreakpointChange below, which seed the ref
  // immediately on a local write so the resulting poll tick is a no-op
  // instead of a redundant re-apply).
  useEffect(() => {
    if (!id || !isSignedIn) return;
    let cancelled = false;
    void (async () => {
      if (activeBreakpointWriteQueueRef.current?.hasPending()) return;
      const value = await readClientAppState<{
        designId?: string;
        activeBreakpointId?: string;
        responsiveEditScope?: ResponsiveEditScope;
        // coercion-ok: missing persisted breakpoint state means use defaults.
      }>(`design-active-breakpoint:${id}`).catch(() => null);
      if (
        cancelled ||
        activeBreakpointWriteQueueRef.current?.hasPending() ||
        !value ||
        value.designId !== id
      ) {
        return;
      }
      const nextBreakpointId = value.activeBreakpointId ?? "auto";
      if (nextBreakpointId === lastAppliedActiveBreakpointIdRef.current) {
        return;
      }
      lastAppliedActiveBreakpointIdRef.current = nextBreakpointId;
      const nextScope =
        value.responsiveEditScope === "only" ? "only" : "cascade-smaller";
      responsiveEditScopeRef.current = nextScope;
      setResponsiveEditScope(nextScope);
      const nextWidthPx =
        nextBreakpointId !== "auto"
          ? designBreakpoints.find((bp) => bp.id === nextBreakpointId)?.widthPx
          : undefined;
      setActiveBreakpointWidthState(nextWidthPx);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBreakpointStateVersion, designBreakpoints, id, isSignedIn]);

  // Agent requests run in a design-scoped capability session, separate from
  // the browser's app-state session, so retrieve the handoff through an editor
  // action instead of reading it from client app state.
  useEffect(() => {
    const request = localhostConsentRequestQuery.data?.request;
    if (
      !id ||
      !canEditDesign ||
      !request ||
      request.designId !== id ||
      !request.connectionId
    ) {
      return;
    }
    const requestKey = `${id}:${request.requestedAt}`;
    const disposition = localhostConsentRequestDisposition({
      requestKey,
      lastHandledKey: lastLocalhostConsentRequestRef.current,
      failedClearKey: failedLocalhostConsentClear,
    });
    if (disposition === "ignore") return;
    const retryingClear = disposition === "retry-clear";
    if (!retryingClear) {
      lastLocalhostConsentRequestRef.current = requestKey;
      setLocalhostConsentConnectionId(request.connectionId);
      setLocalhostWriteConsentPayload({
        rootPath: request.rootPath,
        files: request.files,
        onGranted: () => {
          toast.success("File writes allowed for 8 hours." /* i18n-ignore */);
        },
        onCancel: () => {},
      });
      setLocalhostWriteConsentOpen(true);
    }
    void clearLocalhostConsentRequestMutation
      .mutateAsync({ designId: id, requestedAt: request.requestedAt })
      .then(async () => {
        setFailedLocalhostConsentClear(null);
        await localhostConsentRequestQuery.refetch();
      })
      .catch((error) => {
        setFailedLocalhostConsentClear(requestKey);
        if (!retryingClear) {
          toast.error(actionErrorMessage(error) ?? t("common.genericError"));
        }
      });
  }, [
    canEditDesign,
    clearLocalhostConsentRequestMutation.mutateAsync,
    failedLocalhostConsentClear,
    id,
    localhostConsentRequestQuery.dataUpdatedAt,
    localhostConsentRequestQuery.refetch,
    localhostConsentRequestQuery.data?.request,
    t,
  ]);

  const activeScreenBaseWidthPx = useMemo<number | null>(() => {
    if (!activeFile?.id) return null;
    const metadataByFileId = getDesignDataRecord(
      designDataJson,
      "screenMetadata",
    );
    const metadata = getDesignDataRecord(metadataByFileId, activeFile.id);
    return typeof metadata.width === "number" && Number.isFinite(metadata.width)
      ? (metadata.width as number)
      : null;
  }, [activeFile?.id, designDataJson]);

  const activeBreakpointUpperBoundPx = useMemo<number | null>(() => {
    if (activeBreakpointWidthState == null) return null;
    return breakpointUpperBoundPx(
      designBreakpoints.map((bp) => bp.widthPx),
      activeBreakpointWidthState,
      activeScreenBaseWidthPx,
    );
  }, [activeBreakpointWidthState, designBreakpoints, activeScreenBaseWidthPx]);
  const motionTimelineQueryParams =
    id && activeFile?.id
      ? { designId: id, sourceRef: activeFile.id }
      : { designId: "", sourceRef: "" };
  const { data: motionTimelineResult } =
    useActionQuery<MotionTimelineQueryResult>(
      "get-motion-timeline",
      motionTimelineQueryParams,
      {
        enabled: Boolean(isSignedIn && id && activeFile?.id),
        refetchOnMount: "always",
      },
    );
  useEffect(() => {
    if (activeFile && !embedded) return;
    clearMotionDockUnmountTimer();
    setMotionDockOpen(false);
    setMotionDockMounted(false);
  }, [activeFile, clearMotionDockUnmountTimer, embedded]);
  useEffect(() => {
    if (!reviewFileId || reviewFileId === activeFile?.id) return;
    setReviewFileId(null);
    setReviewFindings([]);
    setReviewAuditedAt(null);
    setReviewAuditError(null);
    setReviewAuditLoading(false);
  }, [activeFile?.id, reviewFileId]);
  const activeOverviewScreenId =
    activeFile?.id ?? activeFileId ?? overviewScreens[0]?.id ?? null;
  const activeOverviewScreen = useMemo(
    () =>
      activeOverviewScreenId
        ? overviewScreens.find((screen) => screen.id === activeOverviewScreenId)
        : undefined,
    [activeOverviewScreenId, overviewScreens],
  );
  const handleEffectivePreviewTokenChange = useCallback(
    (screenId: string | undefined, previewToken: string) => {
      if (!screenId || !previewToken) return;
      setEffectivePreviewTokensByScreenId((current) =>
        current[screenId] === previewToken
          ? current
          : { ...current, [screenId]: previewToken },
      );
    },
    [],
  );
  const handleLiveEditCapabilityChange = useCallback(
    (screenId: string | undefined, capability: string) => {
      if (!screenId || !capability) return;
      setEffectiveLiveEditCapabilitiesByScreenId((current) =>
        current[screenId] === capability
          ? current
          : { ...current, [screenId]: capability },
      );
    },
    [],
  );
  const handleLiveEditRegistrationCapabilityChange = useCallback(
    (screenId: string | undefined, capability: string) => {
      if (!screenId || !capability) return;
      setEffectiveLiveEditRegistrationCapabilitiesByScreenId((current) =>
        current[screenId] === capability
          ? current
          : { ...current, [screenId]: capability },
      );
    },
    [],
  );
  const activeScreenSnapshotOnly = Boolean(
    isLiveCanvasShareLink &&
    designAccessRole &&
    designAccessRole !== "owner" &&
    resolveOverviewScreenSourceType(activeOverviewScreen, designSourceType) ===
      "localhost",
  );
  const activeLocalhostConnection = activeOverviewScreen?.connectionId
    ? localhostPreviewTokenQuery.data?.connections?.[
        activeOverviewScreen.connectionId
      ]
    : undefined;
  const hasActiveLocalhostConnection = Boolean(
    activeOverviewScreen?.connectionId &&
    resolveOverviewScreenSourceType(activeOverviewScreen, designSourceType) ===
      "localhost",
  );
  const activeScreenBridgeUrl = activeScreenSnapshotOnly
    ? undefined
    : resolveOverviewScreenSourceType(
          activeOverviewScreen,
          designSourceType,
        ) === "localhost"
      ? (activeLocalhostConnection?.bridgeUrl ??
        (hasActiveLocalhostConnection
          ? undefined
          : activeOverviewScreen?.bridgeUrl))
      : activeOverviewScreen?.bridgeUrl;
  const activeScreenPreviewToken = activeScreenSnapshotOnly
    ? undefined
    : ((activeOverviewScreen?.id
        ? effectivePreviewTokensByScreenId[activeOverviewScreen.id]
        : undefined) ??
      (resolveOverviewScreenSourceType(
        activeOverviewScreen,
        designSourceType,
      ) === "localhost"
        ? activeLocalhostConnection?.previewToken
        : undefined) ??
      (hasActiveLocalhostConnection
        ? undefined
        : "previewToken" in (activeOverviewScreen ?? {}) &&
            typeof activeOverviewScreen?.previewToken === "string"
          ? activeOverviewScreen.previewToken
          : (localhostPreviewTokenQuery.data?.connections?.[
              activeOverviewScreen?.connectionId ?? ""
            ]?.previewToken ??
            (activeOverviewScreen?.connectionId === publicVisualEditConnectionId
              ? localhostPreviewTokenQuery.data?.previewToken
              : undefined))));
  const activeScreenLiveEditCapability = activeScreenSnapshotOnly
    ? undefined
    : ((activeOverviewScreen?.id
        ? effectiveLiveEditCapabilitiesByScreenId[activeOverviewScreen.id]
        : undefined) ??
      (activeOverviewScreen?.connectionId
        ? localhostPreviewTokenQuery.data?.connections?.[
            activeOverviewScreen.connectionId
          ]?.liveEditCapability
        : undefined) ??
      (activeOverviewScreen?.connectionId === publicVisualEditConnectionId
        ? localhostPreviewTokenQuery.data?.liveEditCapability
        : undefined));
  const overviewScreenIdList = useMemo(
    () => overviewScreens.map((screen) => screen.id),
    [overviewScreens],
  );
  const overviewZoomBasisScreenId = resolveOverviewZoomBasisScreenId({
    candidateFileId: activeFile?.id ?? activeFileId ?? null,
    boardFileId: boardFileId ?? null,
    overviewScreenIds: overviewScreenIdList,
  });
  const overviewZoomBasisScreen = useMemo(
    () =>
      overviewZoomBasisScreenId
        ? overviewScreens.find(
            (screen) => screen.id === overviewZoomBasisScreenId,
          )
        : undefined,
    [overviewZoomBasisScreenId, overviewScreens],
  );
  const activeOverviewSourceWidth =
    deviceFrame === "none"
      ? overviewZoomBasisScreen?.width
      : DEVICE_FRAME_VIEWPORTS[deviceFrame].width;
  const activeOverviewFrameWidth = overviewZoomBasisScreenId
    ? displayedCanvasFrameGeometryById[overviewZoomBasisScreenId]?.width
    : undefined;
  const overviewZoomScale = getOverviewZoomScale({
    frameWidth: activeOverviewFrameWidth,
    sourceWidth: activeOverviewSourceWidth,
  });
  const overviewZoomScaleRef = useRef(overviewZoomScale);

  useEffect(() => {
    overviewZoomScaleRef.current = overviewZoomScale;
  }, [overviewZoomScale]);

  const overviewZoomBasisIdRef = useRef<string | null>(
    overviewZoomBasisScreenId,
  );
  useEffect(() => {
    const previousBasisScreenId = overviewZoomBasisIdRef.current;
    overviewZoomBasisIdRef.current = overviewZoomBasisScreenId;
    if (
      shouldResetExplicitOverviewZoomOnBasisChange({
        previousBasisScreenId,
        nextBasisScreenId: overviewZoomBasisScreenId,
        explicitOverviewCanvasZoom,
        nextOverviewZoomScale: overviewZoomScale,
      })
    ) {
      setExplicitOverviewCanvasZoom(null);
    }
  }, [
    explicitOverviewCanvasZoom,
    overviewZoomBasisScreenId,
    overviewZoomScale,
  ]);

  const overviewCanvasZoom =
    explicitOverviewCanvasZoom ??
    getDefaultOverviewCanvasZoom(overviewZoomScale);
  const overviewZoom = clampOverviewDisplayZoom(
    getOverviewDisplayZoom(overviewCanvasZoom, overviewZoomScale),
  );
  const setZoomForView = useCallback(
    (targetView: "single" | "overview", update: SetStateAction<number>) => {
      if (targetView === "overview") {
        setExplicitOverviewCanvasZoom((currentCanvasZoom) => {
          const scale = overviewZoomScaleRef.current;
          const resolvedCanvasZoom =
            currentCanvasZoom ?? getDefaultOverviewCanvasZoom(scale);
          const currentDisplayZoom = getOverviewDisplayZoom(
            resolvedCanvasZoom,
            scale,
          );
          const nextDisplayZoom = resolveZoomUpdate(update, currentDisplayZoom);
          return Number.isFinite(nextDisplayZoom)
            ? getOverviewCanvasZoom(nextDisplayZoom, scale)
            : currentCanvasZoom;
        });
        return;
      }
      setScreenZoom((currentZoom) => {
        const nextZoom = resolveZoomUpdate(update, currentZoom);
        return Number.isFinite(nextZoom) ? nextZoom : currentZoom;
      });
    },
    [],
  );
  const setZoom = useCallback(
    (update: SetStateAction<number>) => {
      setZoomForView(viewMode, update);
    },
    [setZoomForView, viewMode],
  );

  useEffect(() => {
    if (viewMode !== "single" || !activeFileId) return;
    screenZoomByIdRef.current.set(activeFileId, screenZoom);
  }, [activeFileId, screenZoom, viewMode]);

  const applyDesignEditorCommand = useCallback(
    (command: DesignEditorCommand | Record<string, unknown>) =>
      runApplyDesignEditorCommand(
        {
          canEditDesign,
          canvasFrameGeometryById,
          files,
          id,
          overviewScreens,
          setActiveFileId,
          setActiveInspectorTab,
          setActiveLeftPanel,
          setActiveTool,
          setDrawMode,
          setInteractDeviceName,
          setInteractDeviceSize,
          setMode,
          setOverviewSelectedScreenIds,
          setOverviewInteractScreenId,
          overviewInteractScreenIdRef,
          setPinMode,
          setScreenZoom,
          setSelectedElement,
          setSelectedLayerIdsState,
          setViewMode,
          setZoomForView,
          pendingOverviewScreenSelectionRef,
          setExplicitOverviewScreenSelection: (screenIds) => {
            explicitOverviewScreenSelectionRef.current = screenIds;
          },
          overviewDataReady,
          viewModeRef,
          // A widget opens on the whole canvas with nothing selected, and its
          // canvas frames the opened screen itself (MultiScreenCanvas
          // widgetFit), so neither a selection nor a one-off camera command.
          requestCameraFit: widgetEmbed
            ? undefined
            : (camera) => {
                cameraCommandNonceRef.current += 1;
                setCameraCommand({
                  ...camera,
                  nonce: cameraCommandNonceRef.current,
                });
              },
          selectTargetScreen: !widgetEmbed,
        },
        command,
      ),
    [
      canEditDesign,
      canvasFrameGeometryById,
      files,
      id,
      overviewScreens,
      overviewDataReady,
      setZoomForView,
      widgetEmbed,
    ],
  );

  const handleRunDesignAudit = useCallback(async () => {
    if (!id || !activeFile?.id) return;
    const auditFileId = activeFile.id;
    setReviewFileId(auditFileId);
    setReviewAuditLoading(true);
    setReviewAuditError(null);
    try {
      const result = await callAction<{
        findings: A11yFinding[];
        auditedAt: string;
      }>("run-design-audit", {
        designId: id,
        fileId: auditFileId,
      } as any);
      setReviewFileId(auditFileId);
      setReviewFindings(Array.isArray(result.findings) ? result.findings : []);
      setReviewAuditedAt(result.auditedAt ?? new Date().toISOString());
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.auditRunFailed");
      setReviewAuditError(message);
      toast.error(message);
    } finally {
      setReviewAuditLoading(false);
    }
  }, [activeFile?.id, id, t]);

  // Resolve the design-level source type + capability map so the inspector can
  // gate the real-app affordances (jump-to-source, prop write-back).
  const activeCanvasSourceType = resolveOverviewScreenSourceType(
    activeOverviewScreen,
    designSourceType,
  );

  const handleZoomIn = useCallback(() => {
    trace("tool", "zoom-in", {});
    setZoom((z) => getNextZoomStepUp(z));
  }, [setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => getNextZoomStepDown(z));
  }, [setZoom]);
  const handleInteractDeviceChange = useCallback((name: string) => {
    setInteractDeviceName(name);
    const preset = findInteractDevicePreset(name);
    if (preset) {
      setInteractDeviceSize({ width: preset.width, height: preset.height });
    }
  }, []);
  const handleInteractWidthChange = useCallback((width: number) => {
    setInteractDeviceSize((size) => ({ ...size, width }));
    setInteractDeviceName(INTERACT_CUSTOM_DEVICE_NAME);
  }, []);
  const handleInteractHeightChange = useCallback((height: number) => {
    setInteractDeviceSize((size) => ({ ...size, height }));
    setInteractDeviceName(INTERACT_CUSTOM_DEVICE_NAME);
  }, []);

  const handleCycleFile = useCallback(
    (backwards: boolean) => {
      if (!overviewScreens.length || !activeFile) return;
      const currentIndex = Math.max(
        0,
        overviewScreens.findIndex((screen) => screen.id === activeFile.id),
      );
      const nextIndex =
        (currentIndex + (backwards ? -1 : 1) + overviewScreens.length) %
        overviewScreens.length;
      const nextScreen = overviewScreens[nextIndex];
      if (!nextScreen) return;
      setActiveFileId(nextScreen.id);
      setSelectedElement(null);
      const frames = getAllScreenFrameEntries({
        overviewScreens,
        canvasFrameGeometryById: exportCanvasFrameGeometryById,
      });
      const nextFrame = frames.find((frame) => frame.id === nextScreen.id);
      const bounds = nextFrame ? getFrameGroupBounds([nextFrame]) : null;
      if (bounds) {
        cameraCommandNonceRef.current += 1;
        setCameraCommand({
          fitBounds: bounds,
          nonce: cameraCommandNonceRef.current,
          paddingScreenPx: 160,
        });
      }
    },
    [activeFile, exportCanvasFrameGeometryById, overviewScreens],
  );
  const handleBreakpointBarRemove = useCallback(
    (breakpointId: string) => {
      if (!id) return;
      const removed = designBreakpoints.find((b) => b.id === breakpointId);
      const clearedActive =
        removed != null && removed.widthPx === activeBreakpointWidthState;
      const priorWidthPx = activeBreakpointWidthState;
      const priorEditScope = responsiveEditScopeRef.current;
      if (clearedActive) {
        setActiveBreakpointWidthState(undefined);
        lastAppliedActiveBreakpointIdRef.current = "auto";
        persistActiveBreakpoint("auto", priorEditScope);
      }
      const { rollback } = beginOptimisticBreakpointSetPatch({
        designId: id,
        queryClient,
        designDataJsonRef,
        nextData: optimisticRemoveBreakpointData(
          designDataJsonRef.current,
          breakpointId,
        ),
      });
      void removeBreakpointMutation
        .mutateAsync({ designId: id, breakpointId })
        .catch((error) => {
          rollback();
          if (clearedActive && removed && priorWidthPx !== undefined) {
            setActiveBreakpointWidthState(priorWidthPx);
            lastAppliedActiveBreakpointIdRef.current = removed.id;
            persistActiveBreakpoint(removed.id, priorEditScope);
          }
          toast.error(t("common.genericError"), {
            description:
              error instanceof Error
                ? error.message
                : t("designEditor.breakpointBar.remove"),
          });
        });
    },
    [
      id,
      designBreakpoints,
      activeBreakpointWidthState,
      removeBreakpointMutation,
      persistActiveBreakpoint,
      queryClient,
      t,
    ],
  );
  const handleOverviewRemoveBreakpoint = useCallback(
    (_screenId: string, widthPx: number) => {
      const bp = designBreakpoints.find((b) => b.widthPx === widthPx);
      if (!bp) return;
      handleBreakpointBarRemove(bp.id);
    },
    [designBreakpoints, handleBreakpointBarRemove],
  );

  return {
    screenZoom,
    setScreenZoom,
    cameraCommand,
    setCameraCommand,
    cameraCommandNonceRef,
    screenZoomByIdRef,
    explicitOverviewCanvasZoom,
    setExplicitOverviewCanvasZoom,
    deviceFrame,
    interactDeviceName,
    setInteractDeviceName,
    interactDeviceSize,
    setInteractDeviceSize,
    effectivePreviewTokensByScreenId,
    effectiveLiveEditCapabilitiesByScreenId,
    effectiveLiveEditRegistrationCapabilitiesByScreenId,
    responsiveEditScope,
    responsiveEditScopeRef,
    lastAppliedActiveBreakpointIdRef,
    reviewFileId,
    reviewFindings,
    setReviewFindings,
    reviewAuditLoading,
    reviewAuditedAt,
    reviewAuditError,
    applyGeometryHistoryContentChangesRef,
    localhostWriteConsentOpen,
    setLocalhostWriteConsentOpen,
    localhostWriteConsentPayload,
    setLocalhostWriteConsentPayload,
    localhostConsentConnectionId,
    setLocalhostConsentConnectionId,
    persistActiveBreakpoint,
    makeRealDialogOpen,
    setMakeRealDialogOpen,
    migrationResult,
    screenContentNaturalHeightByIdRef,
    screenContentNaturalHeights,
    publicVisualEditConnectionId,
    exportCanvasFrameGeometryById,
    boardFileContent,
    enqueueFrameGeometryDataSave,
    handleOverviewBreakpointContentHeightChange,
    handleOverviewScreenContentNaturalHeightChange,
    flushPendingFrameGeometrySave,
    queueFrameGeometrySave,
    writeFrameGeometrySnapshot,
    handleGeometryCommit,
    handleOpenMakeReal,
    handleConfirmMakeReal,
    activeFile,
    handleActiveScreenRuntimeReload,
    activeRuntimeLayerReadinessScreenIdRef,
    designBreakpoints,
    handleBreakpointBarSelect,
    handleResponsiveEditScopeChange,
    activeScreenBaseWidthPx,
    activeBreakpointUpperBoundPx,
    motionTimelineResult,
    activeOverviewScreenId,
    activeOverviewScreen,
    handleEffectivePreviewTokenChange,
    handleLiveEditCapabilityChange,
    handleLiveEditRegistrationCapabilityChange,
    activeScreenSnapshotOnly,
    activeScreenBridgeUrl,
    activeScreenPreviewToken,
    activeScreenLiveEditCapability,
    overviewCanvasZoom,
    overviewZoom,
    setZoom,
    applyDesignEditorCommand,
    handleRunDesignAudit,
    activeCanvasSourceType,
    handleZoomIn,
    handleZoomOut,
    handleInteractDeviceChange,
    handleInteractWidthChange,
    handleInteractHeightChange,
    handleCycleFile,
    handleBreakpointBarRemove,
    handleOverviewRemoveBreakpoint,
  };
}

export type EditorActiveScreenAndGeometry = ReturnType<
  typeof useEditorActiveScreenAndGeometry
>;
