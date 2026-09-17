import { useActionMutation } from "@agent-native/core/client/hooks";
import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import { toast } from "sonner";

import { getInitialFrameGeometry } from "@/components/design/multi-screen/frame-geometry";
import type { FrameGeometry } from "@/components/design/multi-screen/types";
import {
  nextDuplicatedFilename,
  normalizedDesignFileType,
  reassignDuplicatedNodeIds,
} from "@/pages/design-editor/canvas-primitive-insert";
import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  getCanvasFrameGeometry,
  getDesignDataRecord,
} from "@/pages/design-editor/design-data-geometry-utils";
import type { FileCreationHistoryEntry } from "@/pages/design-editor/history";
import type { DesignFile } from "@/pages/design-editor/types";

const DUPLICATE_SCREEN_GAP = 56;

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
  const rowBottom = sourceGeometry.y + sourceGeometry.height;
  const rowGeometries = occupiedGeometries.filter(
    (geometry) =>
      geometry.y < rowBottom && geometry.y + geometry.height > sourceGeometry.y,
  );
  const x = Math.max(
    sourceGeometry.x + sourceGeometry.width + DUPLICATE_SCREEN_GAP,
    ...rowGeometries.map(
      (geometry) => geometry.x + geometry.width + DUPLICATE_SCREEN_GAP,
    ),
  );
  const z = Math.max(
    sourceGeometry.z ?? 0,
    ...occupiedGeometries.map((geometry) => geometry.z ?? 0),
  );
  return { ...sourceGeometry, x, y: sourceGeometry.y, z: z + 1 };
}

export interface DuplicateScreenArgs {
  canEditDesign: boolean;
  createFileAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "create-file">
  >["mutateAsync"];
  designDataJsonRef: RefObject<Record<string, unknown>>;
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
  queryClient: QueryClient;
  recordFileCreationHistoryEntry: (entry: FileCreationHistoryEntry) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  updateDesignAsync: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-design">
  >["mutateAsync"];
  writeFrameGeometrySnapshot: (
    geometryById: CanvasFrameGeometryById,
    options?: { syncViewportFrameIds?: string[]; pinHeightFrameIds?: string[] },
  ) => void;
}

export function runDuplicateScreen(
  {
    canEditDesign,
    createFileAsync,
    designDataJsonRef,
    files,
    focusCreatedScreen,
    id,
    liveFrameGeometryRef,
    optimisticallyInsertCreatedFile,
    overviewScreens,
    queryClient,
    recordFileCreationHistoryEntry,
    t,
    updateDesignAsync,
    writeFrameGeometrySnapshot,
  }: DuplicateScreenArgs,
  screenId: string,
  request?: {
    canvasPosition?: { x: number; y: number };
    preserveCamera?: boolean;
  },
) {
  if (!id || !canEditDesign) return;
  const source = files.find((file) => file.id === screenId);
  if (!source) return;
  const filename = nextDuplicatedFilename(files, source.filename);
  const content = reassignDuplicatedNodeIds(source.content);
  const fileType = normalizedDesignFileType(source.fileType);
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
  const occupiedGeometries = overviewScreens
    .filter((screen) => screen.id !== screenId)
    .map(
      (screen) =>
        liveFrameGeometryRef.current[screen.id] ?? persistedGeometry[screen.id],
    )
    .filter(isCompleteFrameGeometry);
  const adjacentGeometry = getDuplicateScreenGeometry(
    sourceGeometry,
    occupiedGeometries,
  );
  const createdGeometry: FrameGeometry = request?.canvasPosition
    ? {
        ...sourceGeometry,
        x: request.canvasPosition.x,
        y: request.canvasPosition.y,
        z: adjacentGeometry.z,
      }
    : adjacentGeometry;
  // Per-call mutate callbacks, not a promise, would silently strand every
  // duplicate but the last: a second mutate() detaches the observer from
  // the first mutation, so only the newest call's onSuccess ever runs.
  void createFileAsync({
    designId: id,
    filename,
    content,
    fileType,
  } as any)
    .then(async (result: any) => {
      const nextId = typeof result?.id === "string" ? result.id : null;
      // Refetch only when there is no created id to insert optimistically:
      // a whole-design refetch re-downloads every screen's HTML, which is
      // what made adding a frame feel slow.
      if (!nextId) {
        void queryClient.invalidateQueries({
          queryKey: ["action", "get-design"],
        });
      } else {
        // Optimistic geometry keeps frame, selection, and camera agreeing
        // before the refetch. Write it before the file enters `screens`, or
        // the geometry-sync effect can render a fallback frame first and
        // preserve that stale position over the requested drop point.
        writeFrameGeometrySnapshot({
          ...getCanvasFrameGeometry(designDataJsonRef.current),
          [nextId]: createdGeometry,
        });
        // Carry screen dimensions/height mode for every duplicate so the new
        // frame uses the same overview scale. Runtime metadata also keeps
        // localhost/fusion duplicates URL-backed. The carry must be
        // path-addressed or it replaces a peer's metadata for every other
        // screen.
        const sourceMetadataById = getDesignDataRecord(
          designDataJsonRef.current,
          "screenMetadata",
        );
        const sourceMetadata = getDesignDataRecord(
          sourceMetadataById,
          screenId,
        );
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
        const screenMetadata =
          Object.keys(metadataToCopy).length > 0
            ? { ...metadataToCopy }
            : undefined;
        const sourceLocalhostScreen = carriesRuntimeMetadata
          ? getDesignDataRecord(
              getDesignDataRecord(
                designDataJsonRef.current,
                "localhostScreens",
              ),
              screenId,
            )
          : {};
        const localhostScreen =
          Object.keys(sourceLocalhostScreen).length > 0
            ? { ...sourceLocalhostScreen }
            : undefined;
        const dataOperations: DesignDataOperation[] = [
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
        if (dataOperations.length > 0) {
          const nextData = applyDesignDataOperations(
            designDataJsonRef.current,
            dataOperations,
          );
          designDataJsonRef.current = nextData;
          queryClient.setQueryData(
            ["action", "get-design", { id }],
            (old: any) => {
              if (!old || typeof old !== "object") return old;
              return { ...old, data: JSON.stringify(nextData) };
            },
          );
          try {
            await updateDesignAsync({ id, dataOperations } as any);
          } catch (error) {
            await queryClient.invalidateQueries({
              queryKey: ["action", "get-design"],
            });
            throw error;
          }
        }
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
          geometry: createdGeometry,
          preserveCamera: request?.preserveCamera,
          screenMetadata,
          localhostScreen,
        });
      }
      toast.success(t("designEditor.toasts.screenDuplicated"));
    })
    .catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.screenDuplicateError"),
      );
    });
}
