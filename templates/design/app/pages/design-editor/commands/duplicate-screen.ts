import { useActionMutation } from "@agent-native/core/client/hooks";
import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";

import {
  getCanonicalScreenStack,
  getInitialFrameGeometry,
} from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import {
  nextDuplicatedFilename,
  normalizedDesignFileType,
  reassignDuplicatedNodeIds,
} from "@/pages/design-editor/canvas-primitive-insert";
import {
  captureDesignFileIds,
  createdFileIdFromResult,
  isPersistedFilePresent,
  reconcileCreatedFile,
} from "@/pages/design-editor/commands/file-creation-recovery";
import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getCanvasFrameGeometry,
  getDesignDataRecord,
} from "@/pages/design-editor/design-data-geometry-utils";
import {
  applyDuplicateStackHistoryChange,
  type DuplicateStackHistoryChange,
  type FileCreationHistoryEntry,
} from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

const DUPLICATE_SCREEN_GAP = 56;

interface DuplicateBatchState {
  sourceIds: Set<string>;
  completedSourceIds: Set<string>;
  copyIds: Set<string>;
}

const duplicateBatchStatesByPendingMap = new WeakMap<
  Map<string, FrameGeometry>,
  Map<string, DuplicateBatchState>
>();

function duplicateBatchState(
  pendingGeometries: Map<string, FrameGeometry>,
  historyBatchId: string | undefined,
  sourceIds: readonly string[],
): DuplicateBatchState | undefined {
  if (!historyBatchId) return undefined;
  let batches = duplicateBatchStatesByPendingMap.get(pendingGeometries);
  if (!batches) {
    batches = new Map();
    duplicateBatchStatesByPendingMap.set(pendingGeometries, batches);
  }
  let state = batches.get(historyBatchId);
  if (!state) {
    state = {
      sourceIds: new Set(),
      completedSourceIds: new Set(),
      copyIds: new Set(),
    };
    batches.set(historyBatchId, state);
  }
  sourceIds.forEach((sourceId) => state!.sourceIds.add(sourceId));
  return state;
}

function settleDuplicateBatchSource(
  pendingGeometries: Map<string, FrameGeometry>,
  historyBatchId: string | undefined,
  state: DuplicateBatchState | undefined,
  sourceId: string,
  copyId?: string,
) {
  if (!historyBatchId || !state) return;
  state.completedSourceIds.add(sourceId);
  if (copyId) state.copyIds.add(copyId);
  if ([...state.sourceIds].every((id) => state!.completedSourceIds.has(id))) {
    duplicateBatchStatesByPendingMap
      .get(pendingGeometries)
      ?.delete(historyBatchId);
  }
}

export interface DuplicateScreenRecoveryEntry {
  sourceScreenId: string;
  fileId?: string;
  knownFileIds?: string[];
  content?: string;
  fileType?: DesignFile["fileType"];
  geometry?: FrameGeometry;
  screenMetadata?: Record<string, unknown>;
  localhostScreen?: Record<string, unknown>;
}

function isCompleteFrameGeometry(
  geometry: CanvasFrameGeometry | undefined,
): geometry is FrameGeometry {
  return (
    geometry !== undefined &&
    [geometry.x, geometry.y, geometry.width, geometry.height].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  );
}

export function getDuplicateScreenGeometry(
  sourceGeometry: FrameGeometry,
  occupiedGeometries: readonly FrameGeometry[],
): FrameGeometry {
  return {
    ...getFirstFreeDuplicateGeometry(
      {
        ...sourceGeometry,
        x: sourceGeometry.x + sourceGeometry.width + DUPLICATE_SCREEN_GAP,
        y: sourceGeometry.y,
      },
      occupiedGeometries,
    ),
    z: (sourceGeometry.z ?? 0) + 1,
  };
}

function getFirstFreeDuplicateGeometry(
  candidate: FrameGeometry,
  occupiedGeometries: readonly FrameGeometry[],
): FrameGeometry {
  let free = { ...candidate };
  while (true) {
    const overlap = occupiedGeometries
      .filter((geometry) => duplicateGeometriesOverlap(free, geometry))
      .sort((left, right) => left.x - right.x)[0];
    if (!overlap) return free;
    free = {
      ...free,
      x: overlap.x + overlap.width + DUPLICATE_SCREEN_GAP,
    };
  }
}

function duplicateGeometriesOverlap(
  left: FrameGeometry,
  right: FrameGeometry,
  gap = DUPLICATE_SCREEN_GAP,
): boolean {
  const sameRow =
    left.y < right.y + right.height && right.y < left.y + left.height;
  return (
    sameRow &&
    left.x < right.x + right.width + gap &&
    right.x < left.x + left.width + gap
  );
}

function reserveDuplicateGeometry(
  filename: string,
  candidate: FrameGeometry,
  occupiedGeometries: readonly FrameGeometry[],
  pendingGeometries: ReadonlyMap<string, FrameGeometry>,
  preserveRequestedPosition: boolean,
): FrameGeometry {
  const existingReservation = pendingGeometries.get(filename);
  const otherPending = [...pendingGeometries.entries()]
    .filter(([pendingFilename]) => pendingFilename !== filename)
    .map(([, geometry]) => geometry);
  const reserved =
    preserveRequestedPosition &&
    !otherPending.some((geometry) =>
      duplicateGeometriesOverlap(candidate, geometry),
    )
      ? { ...candidate }
      : getFirstFreeDuplicateGeometry(candidate, [
          ...occupiedGeometries,
          ...otherPending,
        ]);
  if (existingReservation) {
    // Keep the z slot allocated when the create started; recomputing against
    // a later pending map makes completion order change the duplicate stack.
    reserved.z = existingReservation.z;
  } else if (reserved.x === candidate.x && reserved.y === candidate.y) {
    const overlappingZ = occupiedGeometries
      .filter((geometry) => duplicateGeometriesOverlap(candidate, geometry, 0))
      .map((geometry) => geometry.z ?? 0);
    if (overlappingZ.length > 0) {
      reserved.z = Math.max(reserved.z ?? 0, ...overlappingZ) + 1;
    }
  }
  const pendingZ = otherPending.map((geometry) => geometry.z ?? 0);
  if (!existingReservation && pendingZ.length > 0) {
    reserved.z = Math.max(reserved.z ?? 0, ...pendingZ) + 1;
  }
  return reserved;
}

function duplicateStackGeometry(args: {
  mode?: "alt-click" | "alt-drag";
  screenId: string;
  screens: OverviewScreen[];
  geometryById: CanvasFrameGeometryById;
  sourceIds: readonly string[];
}) {
  const screens = args.screens.some((screen) => screen.id === args.screenId)
    ? args.screens
    : [...args.screens, { id: args.screenId } as OverviewScreen];
  const orderedIds = getCanonicalScreenStack(screens, args.geometryById);
  const sourceIds = new Set(args.sourceIds);
  sourceIds.add(args.screenId);
  const before: Record<string, number | null> = {};
  const after: Record<string, number> = {};
  const copyZBySourceId = new Map<string, number>();
  if (args.mode === "alt-drag") {
    let topZ = orderedIds.reduce(
      (highest, id, index) =>
        Math.max(highest, args.geometryById[id]?.z ?? index),
      -1,
    );
    for (const id of orderedIds) {
      if (sourceIds.has(id)) copyZBySourceId.set(id, ++topZ);
    }
    return { before, after, copyZBySourceId };
  }
  let z = 0;
  for (const id of orderedIds) {
    const current = args.geometryById[id];
    const nextZ = z++;
    if (current && current.z !== nextZ) {
      before[id] = current.z ?? null;
      after[id] = nextZ;
    }
    if (sourceIds.has(id)) copyZBySourceId.set(id, z++);
  }
  return { before, after, copyZBySourceId };
}

function duplicateStackChangeBetween(
  before: CanvasFrameGeometryById,
  after: CanvasFrameGeometryById,
): DuplicateStackHistoryChange | undefined {
  const change: DuplicateStackHistoryChange = { before: {}, after: {} };
  for (const frameId of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const previous = before[frameId];
    const next = after[frameId];
    if (!previous || !next || previous.z === next.z) continue;
    change.before[frameId] = previous.z ?? null;
    change.after[frameId] = next.z ?? 0;
  }
  return Object.keys(change.after).length > 0 ? change : undefined;
}

function duplicateStackDataOperations(
  before: CanvasFrameGeometryById,
  after: CanvasFrameGeometryById,
): DesignDataOperation[] {
  const operations: DesignDataOperation[] = [];
  for (const frameId of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const previousZ = before[frameId]?.z;
    const nextZ = after[frameId]?.z;
    if (previousZ === nextZ) continue;
    const path = ["canvasFrames", frameId, "z"] as [string, ...string[]];
    if (nextZ === undefined) operations.push({ op: "delete", path });
    else operations.push({ op: "set", path, value: nextZ });
  }
  return operations;
}

export interface DuplicateScreenArgs {
  canEditDesign: boolean;
  createFileAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >["mutateAsync"];
  deleteFileAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "delete-file">
  >["mutateAsync"];
  designDataJsonRef: RefObject<Record<string, unknown>>;
  duplicateRecoveryRef: RefObject<Map<string, DuplicateScreenRecoveryEntry>>;
  files: DesignFile[];
  focusCreatedScreen: (
    screenId: string,
    geometry: FrameGeometry,
    options?: {
      preserveCamera?: boolean;
      suppressLineupRecenter?: boolean;
    },
  ) => void;
  id: string | undefined;
  liveFrameGeometryRef: RefObject<CanvasFrameGeometryById>;
  optimisticallyInsertCreatedFile: (args: {
    fileId: string;
    filename: string;
    fileType: DesignFile["fileType"];
    content: string;
    result?: Record<string, unknown> | null;
  }) => void;
  overviewScreens: OverviewScreen[];
  pendingDuplicateGeometriesRef: RefObject<Map<string, FrameGeometry>>;
  pendingDuplicateFilenamesRef: RefObject<Set<string>>;
  duplicateInFlightRef: RefObject<Set<string>>;
  queryClient: QueryClient;
  recordFileCreationHistoryEntry: (entry: FileCreationHistoryEntry) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  updateDesignAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-design">
  >["mutateAsync"];
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: {
      replacePendingGeometrySave?: boolean;
      syncViewportFrameIds?: string[];
      pinHeightFrameIds?: string[];
    },
  ) => void;
}

export function runDuplicateScreen(
  {
    canEditDesign,
    createFileAsync,
    deleteFileAsync,
    designDataJsonRef,
    duplicateRecoveryRef,
    files,
    focusCreatedScreen,
    id,
    liveFrameGeometryRef,
    optimisticallyInsertCreatedFile,
    overviewScreens,
    pendingDuplicateGeometriesRef,
    pendingDuplicateFilenamesRef,
    duplicateInFlightRef,
    queryClient,
    recordFileCreationHistoryEntry,
    t,
    updateDesignAsync,
    writeFrameGeometrySnapshot,
  }: DuplicateScreenArgs,
  screenId: string,
  request?: {
    mode?: "alt-click" | "alt-drag";
    duplicateStackSourceIds?: string[];
    canvasPosition?: { x: number; y: number };
    preserveCamera?: boolean;
    historyBatchId?: string;
  },
) {
  if (!id || !canEditDesign) return Promise.resolve(undefined);
  const source = files.find((file) => file.id === screenId);
  if (!source) return Promise.resolve(undefined);
  const pendingFilenames = pendingDuplicateFilenamesRef.current;
  const recoveries = duplicateRecoveryRef.current;
  for (const pendingFilename of pendingFilenames) {
    if (
      files.some((file) => file.filename === pendingFilename) &&
      !recoveries.has(pendingFilename)
    ) {
      pendingFilenames.delete(pendingFilename);
    }
  }
  const recoveryEntry = [...recoveries.entries()].find(
    ([, recovery]) => recovery.sourceScreenId === screenId,
  );
  const recoveryState = recoveryEntry?.[1];
  const knownFileIds = new Set(
    recoveryState?.knownFileIds ??
      captureDesignFileIds({ queryClient, designId: id, files }),
  );
  const filename =
    recoveryEntry?.[0] ??
    nextDuplicatedFilename(
      [
        ...files,
        ...[...pendingFilenames].map(
          (pendingFilename) =>
            ({
              filename: pendingFilename,
            }) as DesignFile,
        ),
      ],
      source.filename,
    );
  const recoveredFileId = recoveryEntry?.[1].fileId;
  if (!recoveryEntry) pendingFilenames.add(filename);
  if (duplicateInFlightRef.current.has(filename)) {
    return Promise.resolve(undefined);
  }
  duplicateInFlightRef.current.add(filename);
  const content =
    recoveryState?.content ?? reassignDuplicatedNodeIds(source.content);
  const fileType =
    recoveryState?.fileType ?? normalizedDesignFileType(source.fileType);
  const sourceOverviewScreen = overviewScreens.find(
    (screen) => screen.id === screenId,
  );
  const fallbackGeometry = getInitialFrameGeometry(overviewScreens.length, {
    width: sourceOverviewScreen?.width ?? 1280,
    height: sourceOverviewScreen?.height ?? 2560,
  });
  const persistedGeometry = getCanvasFrameGeometry(designDataJsonRef.current);
  const sourceGeometry =
    [liveFrameGeometryRef.current[screenId], persistedGeometry[screenId]].find(
      isCompleteFrameGeometry,
    ) ?? fallbackGeometry;
  const currentFrameGeometry = {
    ...persistedGeometry,
  };
  for (const [frameId, liveGeometry] of Object.entries(
    liveFrameGeometryRef.current,
  )) {
    currentFrameGeometry[frameId] = {
      ...persistedGeometry[frameId],
      ...liveGeometry,
    };
  }
  for (const [frameId, geometry] of Object.entries(currentFrameGeometry)) {
    const persistedZ = persistedGeometry[frameId]?.z;
    if (typeof persistedZ === "number") {
      currentFrameGeometry[frameId] = { ...geometry, z: persistedZ };
    }
  }
  currentFrameGeometry[screenId] = {
    ...sourceGeometry,
    z: persistedGeometry[screenId]?.z ?? sourceGeometry.z,
  };
  const duplicateStackSourceIds = request?.duplicateStackSourceIds ?? [
    screenId,
  ];
  const duplicateBatch = duplicateBatchState(
    pendingDuplicateGeometriesRef.current,
    request?.historyBatchId,
    duplicateStackSourceIds,
  );
  const batchCopyIds = duplicateBatch?.copyIds ?? new Set<string>();
  const stackScreens = new Map(
    overviewScreens
      .filter((screen) => !batchCopyIds.has(screen.id))
      .map((screen) => [screen.id, screen]),
  );
  for (const frameId of Object.keys(currentFrameGeometry)) {
    if (!batchCopyIds.has(frameId) && !stackScreens.has(frameId)) {
      stackScreens.set(frameId, { id: frameId } as OverviewScreen);
    }
  }
  const stackGeometry = Object.fromEntries(
    Object.entries(currentFrameGeometry).filter(
      ([frameId]) => !batchCopyIds.has(frameId),
    ),
  );
  const duplicateStack = duplicateStackGeometry({
    mode: request?.mode,
    screenId,
    screens: [...stackScreens.values()],
    geometryById: stackGeometry,
    sourceIds: duplicateStackSourceIds,
  });
  const occupiedGeometries = Object.entries(currentFrameGeometry)
    .filter(([frameId]) => frameId !== screenId)
    .map(([, geometry]) => geometry)
    .filter(isCompleteFrameGeometry);
  const adjacentGeometry = getDuplicateScreenGeometry(
    sourceGeometry,
    occupiedGeometries,
  );
  const explicitDropPosition =
    request?.mode === "alt-drag" ? request.canvasPosition : undefined;
  const requestedGeometry: FrameGeometry =
    recoveryState?.geometry ??
    (explicitDropPosition
      ? {
          ...sourceGeometry,
          x: explicitDropPosition.x,
          y: explicitDropPosition.y,
          z: adjacentGeometry.z,
        }
      : adjacentGeometry);
  const preserveExplicitDropPosition = explicitDropPosition !== undefined;
  const initiallyReservedGeometry =
    recoveryState?.geometry ??
    reserveDuplicateGeometry(
      filename,
      requestedGeometry,
      preserveExplicitDropPosition ? [] : occupiedGeometries,
      pendingDuplicateGeometriesRef.current,
      preserveExplicitDropPosition,
    );
  let createdGeometry = {
    ...initiallyReservedGeometry,
    z: Math.max(
      duplicateStack.copyZBySourceId.get(screenId) ?? requestedGeometry.z ?? 0,
      initiallyReservedGeometry.z ?? 0,
    ),
  };
  pendingDuplicateGeometriesRef.current.set(filename, createdGeometry);
  // Carry screen dimensions/height mode for every duplicate so the new frame
  // uses the same overview scale. Runtime metadata also keeps localhost/fusion
  // duplicates URL-backed. The carry must be path-addressed or it replaces a
  // peer's metadata for every other screen.
  const sourceMetadataById = getDesignDataRecord(
    designDataJsonRef.current,
    "screenMetadata",
  );
  const sourceMetadata = getDesignDataRecord(sourceMetadataById, screenId);
  const sourceType = sourceMetadata.sourceType;
  const carriesRuntimeMetadata =
    sourceType === "localhost" || sourceType === "fusion";
  const metadataToCopy = carriesRuntimeMetadata
    ? sourceMetadata
    : Object.fromEntries(
        [
          "sourceType",
          "width",
          "height",
          "heightPinned",
          "heightMode",
          "breakpointHeights",
        ].flatMap((key) =>
          key in sourceMetadata ? [[key, sourceMetadata[key]]] : [],
        ),
      );
  const currentScreenMetadata =
    Object.keys(metadataToCopy).length > 0 ? { ...metadataToCopy } : undefined;
  const currentLocalhostScreen = carriesRuntimeMetadata
    ? getDesignDataRecord(
        getDesignDataRecord(designDataJsonRef.current, "localhostScreens"),
        screenId,
      )
    : {};
  const currentLocalhostMetadata =
    Object.keys(currentLocalhostScreen).length > 0
      ? { ...currentLocalhostScreen }
      : undefined;
  const screenMetadata =
    recoveryState && "screenMetadata" in recoveryState
      ? recoveryState.screenMetadata
      : currentScreenMetadata;
  const localhostScreen =
    recoveryState && "localhostScreen" in recoveryState
      ? recoveryState.localhostScreen
      : currentLocalhostMetadata;
  // Per-call mutate callbacks, not a promise, would silently strand every
  // duplicate but the last: a second mutate() detaches the observer from
  // the first mutation, so only the newest call's onSuccess ever runs.
  let createdFileId: string | undefined;
  let duplicateBatchCopyId: string | undefined;
  const canCleanupCreatedFile = recoveredFileId === undefined;
  const createFile = () =>
    createFileAsync({
      designId: id,
      filename,
      content,
      fileType,
    } as any);
  const callCreateFile = () => {
    try {
      return Promise.resolve(createFile());
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const createPromise = !recoveryEntry
    ? callCreateFile()
    : Promise.resolve().then(() => {
        if (!recoveredFileId) {
          return reconcileCreatedFile({
            queryClient,
            designId: id,
            filename,
            content,
            fileType,
            files,
            knownFileIds,
          }).then((reconciled) =>
            reconciled ? { id: reconciled.id } : callCreateFile(),
          );
        }
        return isPersistedFilePresent({
          queryClient,
          designId: id,
          fileId: recoveredFileId,
        }).then((present) => {
          if (present === true) return { id: recoveredFileId };
          if (present === false) {
            recoveries.set(filename, {
              sourceScreenId: screenId,
              ...recoveryState,
              fileId: undefined,
            });
            return callCreateFile();
          }
          throw new Error(
            `Unable to verify recovered file "${filename}" before retrying`,
          );
        });
      });
  const operation = createPromise
    .then(async (rawResult: any) => {
      let result = rawResult;
      let nextId = createdFileIdFromResult(result);
      if (!nextId) {
        recoveries.set(filename, {
          sourceScreenId: screenId,
          content,
          fileType,
          geometry: createdGeometry,
          screenMetadata,
          localhostScreen,
          knownFileIds: [...knownFileIds],
        });
        const reconciled = await reconcileCreatedFile({
          queryClient,
          designId: id,
          filename,
          content,
          fileType,
          files,
          knownFileIds,
        });
        if (reconciled) {
          result = reconciled;
          nextId = reconciled.id;
        }
      }
      if (!nextId) {
        throw new Error(
          `Failed to duplicate "${filename}": create-file returned no id and no persisted file could be reconciled`,
        );
      }
      if (canCleanupCreatedFile) createdFileId = nextId;
      duplicateBatchCopyId = nextId;
      duplicateBatch?.copyIds.add(nextId);
      const latestPersistedGeometry = getCanvasFrameGeometry(
        designDataJsonRef.current,
      );
      const latestGeometry: CanvasFrameGeometryById = {
        ...latestPersistedGeometry,
      };
      for (const [frameId, liveGeometry] of Object.entries(
        liveFrameGeometryRef.current,
      )) {
        latestGeometry[frameId] = {
          ...latestPersistedGeometry[frameId],
          ...liveGeometry,
        };
        const persistedZ = latestPersistedGeometry[frameId]?.z;
        if (typeof persistedZ === "number") {
          latestGeometry[frameId] = {
            ...latestGeometry[frameId],
            z: persistedZ,
          };
        }
      }
      const latestSourceGeometry =
        [latestGeometry[screenId], sourceGeometry].find(
          isCompleteFrameGeometry,
        ) ?? sourceGeometry;
      latestGeometry[screenId] = latestSourceGeometry;
      const completedBatchCopyIds =
        duplicateBatch?.copyIds ?? new Set<string>();
      const latestScreens = new Map(
        overviewScreens
          .filter((screen) => !completedBatchCopyIds.has(screen.id))
          .map((screen) => [screen.id, screen]),
      );
      for (const frameId of Object.keys(latestGeometry)) {
        if (
          !completedBatchCopyIds.has(frameId) &&
          !latestScreens.has(frameId)
        ) {
          latestScreens.set(frameId, { id: frameId } as OverviewScreen);
        }
      }
      const latestStackGeometry = Object.fromEntries(
        Object.entries(latestGeometry).filter(
          ([frameId]) => !completedBatchCopyIds.has(frameId),
        ),
      );
      const landingStack = duplicateStackGeometry({
        mode: request?.mode,
        screenId,
        screens: [...latestScreens.values()],
        geometryById: latestStackGeometry,
        sourceIds: duplicateStackSourceIds,
      });
      const latestOccupiedGeometries = Object.entries(latestGeometry)
        .filter(([frameId]) => frameId !== screenId)
        .map(([, geometry]) => geometry)
        .filter(isCompleteFrameGeometry);
      const latestAdjacentGeometry = getDuplicateScreenGeometry(
        latestSourceGeometry,
        latestOccupiedGeometries,
      );
      const latestRequestedGeometry: FrameGeometry =
        recoveryState?.geometry ??
        (explicitDropPosition
          ? {
              ...latestSourceGeometry,
              x: explicitDropPosition.x,
              y: explicitDropPosition.y,
              z: latestAdjacentGeometry.z,
            }
          : latestAdjacentGeometry);
      const reservedGeometry =
        recoveryState?.geometry ??
        reserveDuplicateGeometry(
          filename,
          latestRequestedGeometry,
          preserveExplicitDropPosition ? [] : latestOccupiedGeometries,
          pendingDuplicateGeometriesRef.current,
          preserveExplicitDropPosition,
        );
      createdGeometry = {
        ...reservedGeometry,
        z: Math.max(
          landingStack.copyZBySourceId.get(screenId) ??
            latestRequestedGeometry.z ??
            0,
          reservedGeometry.z ?? 0,
        ),
      };
      pendingDuplicateGeometriesRef.current.set(filename, createdGeometry);
      const appliedStack = applyDuplicateStackHistoryChange(
        latestGeometry,
        landingStack,
        "redo",
      );
      const appliedStackChange = duplicateStackChangeBetween(
        latestGeometry,
        appliedStack.geometryById,
      );
      // Persist stack ordering as z-only edits so a concurrent screen move
      // cannot be replaced by the geometry snapshot captured at dispatch.
      const nextFrameGeometry = {
        ...appliedStack.geometryById,
        [nextId]: createdGeometry,
      };
      writeFrameGeometrySnapshot(nextFrameGeometry);
      const dataOperations: DesignDataOperation[] = [
        ...duplicateStackDataOperations(
          latestGeometry,
          appliedStack.geometryById,
        ),
        {
          op: "set",
          path: ["canvasFrames", nextId],
          value: createdGeometry,
        },
      ];
      if (screenMetadata) {
        dataOperations.push({
          op: "set",
          path: ["screenMetadata", nextId],
          value: screenMetadata,
        });
      }
      if (localhostScreen) {
        dataOperations.push({
          op: "set",
          path: ["localhostScreens", nextId],
          value: localhostScreen,
        });
      }
      const nextData = applyDesignDataOperations(
        designDataJsonRef.current,
        dataOperations,
      );
      designDataJsonRef.current = nextData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, data: JSON.stringify(nextData) };
      });
      await updateDesignAsync({ id, dataOperations } as any);
      optimisticallyInsertCreatedFile({
        fileId: nextId,
        filename,
        fileType,
        content,
        result,
      });
      focusCreatedScreen(nextId, createdGeometry, {
        preserveCamera: request?.preserveCamera,
        suppressLineupRecenter: request?.preserveCamera,
      });
      recordFileCreationHistoryEntry({
        filename,
        content,
        fileType,
        createdFileId: nextId,
        geometry: createdGeometry,
        preserveCamera: request?.preserveCamera,
        historyBatchId: request?.historyBatchId,
        ...(appliedStackChange ? { duplicateStack: appliedStackChange } : {}),
        screenMetadata,
        localhostScreen,
      });
      settleDuplicateBatchSource(
        pendingDuplicateGeometriesRef.current,
        request?.historyBatchId,
        duplicateBatch,
        screenId,
        nextId,
      );
      recoveries.delete(filename);
      pendingFilenames.delete(filename);
      pendingDuplicateGeometriesRef.current.delete(filename);
      toast.success(t("designEditor.toasts.screenDuplicated"));
      return nextId;
    })
    .catch(async (error: unknown) => {
      let errorMessage =
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.screenDuplicateError");
      let survivingFileId = createdFileId ?? recoveredFileId;
      if (createdFileId && canCleanupCreatedFile) {
        try {
          await deleteFileAsync({
            id: createdFileId,
            allowLockedLayers: true,
          } as any);
          recoveries.delete(filename);
          pendingFilenames.delete(filename);
          pendingDuplicateGeometriesRef.current.delete(filename);
        } catch (cleanupError) {
          const cleanupMessage =
            cleanupError instanceof Error
              ? cleanupError.message
              : t("designEditor.toasts.screenDuplicateError");
          errorMessage = `${errorMessage}; cleanup failed: ${cleanupMessage}`;
          const present = await isPersistedFilePresent({
            queryClient,
            designId: id,
            fileId: createdFileId,
          });
          if (present === true) {
            recoveries.set(filename, {
              sourceScreenId: screenId,
              fileId: createdFileId,
              knownFileIds: [...knownFileIds],
              content,
              fileType,
              geometry: createdGeometry,
              screenMetadata,
              localhostScreen,
            });
          } else {
            survivingFileId = undefined;
            recoveries.set(filename, {
              sourceScreenId: screenId,
              content,
              fileType,
              geometry: createdGeometry,
              screenMetadata,
              localhostScreen,
              knownFileIds: [...knownFileIds],
            });
          }
        }
      } else if (recoveredFileId) {
        const present = await isPersistedFilePresent({
          queryClient,
          designId: id,
          fileId: recoveredFileId,
        });
        if (present !== true) {
          survivingFileId = undefined;
          recoveries.set(filename, {
            sourceScreenId: screenId,
            ...recoveryState,
            fileId: undefined,
          });
        }
      }
      if (survivingFileId) {
        const nextGeometry = {
          ...getCanvasFrameGeometry(designDataJsonRef.current),
        };
        delete nextGeometry[survivingFileId];
        writeFrameGeometrySnapshot(nextGeometry, {
          replacePendingGeometrySave: true,
        });
      } else if (!recoveries.has(filename)) {
        pendingFilenames.delete(filename);
        pendingDuplicateGeometriesRef.current.delete(filename);
      }
      if (duplicateBatchCopyId && duplicateBatchCopyId !== survivingFileId) {
        duplicateBatch?.copyIds.delete(duplicateBatchCopyId);
      }
      settleDuplicateBatchSource(
        pendingDuplicateGeometriesRef.current,
        request?.historyBatchId,
        duplicateBatch,
        screenId,
        survivingFileId,
      );
      await queryClient.invalidateQueries({
        queryKey: ["action", "get-design"],
      });
      toast.error(errorMessage);
      return undefined;
    })
    .finally(() => {
      duplicateInFlightRef.current.delete(filename);
    });
  return operation;
}
