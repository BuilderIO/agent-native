import { useT } from "@agent-native/core/client";
import {
  DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
  computeMoveSnap,
  computeResizeSnap,
  getPanForZoomToCursor,
  resizeFrameFromDelta,
  screenToCanvasPoint,
} from "@shared/canvas-math";
import {
  IconCloud,
  IconCode,
  IconCopy,
  IconDeviceDesktop,
} from "@tabler/icons-react";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

interface ScreenFile {
  id: string;
  filename: string;
  content: string;
  source?: string;
  sourceType?: string;
  lod?: string;
  previewState?: string;
  status?: string;
  title?: string;
  width?: number;
  height?: number;
  url?: string;
  previewUrl?: string;
}

type ScreenSourceType = "localhost" | "fusion" | "inline";
type ScreenPreviewState = "live" | "snapshot" | "preview";

interface ScreenMetadata {
  source?: string;
  sourceType?: string;
  lod?: string;
  previewState?: string;
  title?: string;
  width?: number;
  height?: number;
  url?: string;
  previewUrl?: string;
}

interface DuplicateRequest {
  mode: "alt-click" | "alt-drag";
  screen: ScreenFile;
  canvasPosition: { x: number; y: number };
}

interface MultiScreenCanvasProps {
  screens: ScreenFile[];
  zoom: number;
  activeId?: string | null;
  onPick: (id: string) => void;
  metadataById?: Record<string, ScreenMetadata | undefined>;
  getScreenMetadata?: (screen: ScreenFile) => ScreenMetadata | undefined;
  onDuplicate?: (id: string, request: DuplicateRequest) => void;
  geometryById?: Record<string, Partial<FrameGeometry> | undefined>;
  onGeometryChange?: (geometryById: FrameGeometryById) => void;
  onZoomChange?: (zoom: number) => void;
  selectAllRequest?: number;
}

/**
 * Figma-style overview canvas. Renders every file in the design as a movable,
 * resizable frame inside an infinite, pannable surface.
 */
const SCREEN_WIDTH = 320;
const SCREEN_HEIGHT = 640;
const SCREEN_CARD_HEIGHT = SCREEN_HEIGHT + 26;
const SCREEN_GAP = 56;
const SURFACE_PADDING = 240;
const DUPLICATE_DRAG_THRESHOLD = 6;
const DRAG_THRESHOLD = 3;
const FRAME_LABEL_HEIGHT = 28;
const MIN_ZOOM = 2;
const MAX_ZOOM = 800;
const ZOOM_SENSITIVITY = 0.002;
const PIXEL_GRID_ZOOM = 800;
const RULER_SIZE = 24;

interface ResolvedScreenMetadata {
  source: ScreenSourceType;
  previewState: ScreenPreviewState;
  title?: string;
  width: number;
  height: number;
  previewUrl?: string;
}

interface DuplicatePreview {
  display: string;
  x: number;
  y: number;
  canDuplicate: boolean;
  moved: boolean;
}

interface FrameGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
}

type FrameGeometryById = Record<string, FrameGeometry>;

interface Point {
  x: number;
  y: number;
}

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

interface MoveDragState {
  type: "move";
  originClient: Point;
  originFrames: FrameGeometryById;
  targetIds: string[];
  primaryId: string;
  hasMoved: boolean;
}

interface ResizeDragState {
  type: "resize";
  originClient: Point;
  originFrame: FrameGeometry;
  frameId: string;
  handle: ResizeHandle;
  hasMoved: boolean;
}

interface RotateDragState {
  type: "rotate";
  originClient: Point;
  originFrame: FrameGeometry;
  frameId: string;
  originPointerAngle: number;
  originRotation: number;
  hasMoved: boolean;
}

interface MarqueeDragState {
  type: "marquee";
  originClient: Point;
  originCanvas: Point;
  baseSelectedIds: string[];
  additive: boolean;
  hasMoved: boolean;
}

interface PanDragState {
  type: "pan";
  originClient: Point;
  originPan: Point;
}

type DragState =
  | MoveDragState
  | ResizeDragState
  | RotateDragState
  | MarqueeDragState
  | PanDragState;

export function MultiScreenCanvas({
  screens,
  zoom,
  activeId,
  onPick,
  metadataById,
  getScreenMetadata,
  onDuplicate,
  geometryById,
  onGeometryChange,
  onZoomChange,
  selectAllRequest,
}: MultiScreenCanvasProps) {
  const t = useT();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const [canvasZoom, setCanvasZoom] = useState(zoom);
  const zoomRef = useRef(zoom);
  const [frameGeometry, setFrameGeometry] = useState<FrameGeometryById>({});
  const frameGeometryRef = useRef(frameGeometry);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    activeId ? [activeId] : [],
  );
  const selectedIdsRef = useRef(selectedIds);
  const dragState = useRef<DragState | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const duplicateCleanup = useRef<(() => void) | null>(null);
  const handledSelectAllRequestRef = useRef(selectAllRequest);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [duplicatePreview, setDuplicatePreview] =
    useState<DuplicatePreview | null>(null);
  const suppressNextPick = useRef(false);

  useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  const updateFrameGeometry = useCallback(
    (updater: (current: FrameGeometryById) => FrameGeometryById) => {
      setFrameGeometry((current) => {
        const next = updater(current);
        frameGeometryRef.current = next;
        onGeometryChangeRef.current?.(next);
        return next;
      });
    },
    [],
  );

  const updateSelectedIds = useCallback(
    (updater: (current: string[]) => string[]) => {
      setSelectedIds((current) => {
        const next = dedupeIds(updater(current));
        if (sameIds(current, next)) {
          selectedIdsRef.current = current;
          return current;
        }
        selectedIdsRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = canvasZoom;
  }, [canvasZoom]);

  useEffect(() => {
    frameGeometryRef.current = frameGeometry;
  }, [frameGeometry]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    setCanvasZoom(zoom);
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    const currentIds = new Set(screens.map((screen) => screen.id));
    updateFrameGeometry((current) => {
      const next: FrameGeometryById = {};
      let changed = Object.keys(current).some((id) => !currentIds.has(id));

      screens.forEach((screen, index) => {
        const existing = current[screen.id];
        const persisted = geometryById?.[screen.id];
        next[screen.id] =
          existing ??
          ({
            ...getInitialFrameGeometry(index),
            ...persisted,
          } as FrameGeometry);
        if (!existing) changed = true;
      });

      return changed ? next : current;
    });
    updateSelectedIds((current) => {
      const next = current.filter((id) => currentIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [geometryById, screens, updateFrameGeometry, updateSelectedIds]);

  useEffect(() => {
    if (!activeId) return;
    updateSelectedIds((current) =>
      current.includes(activeId) ? current : [activeId],
    );
  }, [activeId, updateSelectedIds]);

  useEffect(() => {
    if (
      selectAllRequest === undefined ||
      selectAllRequest === handledSelectAllRequestRef.current
    ) {
      return;
    }
    handledSelectAllRequestRef.current = selectAllRequest;
    updateSelectedIds(() => screens.map((screen) => screen.id));
  }, [screens, selectAllRequest, updateSelectedIds]);

  // Center the lineup on first mount so the user sees screens, not whitespace.
  useEffect(() => {
    if (!surfaceRef.current || screens.length === 0) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const columns = Math.min(screens.length, 3);
    const rows = Math.ceil(screens.length / columns);
    const scale = zoom / 100;
    const totalWidth = columns * SCREEN_WIDTH + (columns - 1) * SCREEN_GAP;
    const totalHeight = rows * SCREEN_CARD_HEIGHT + (rows - 1) * SCREEN_GAP;
    const visualLeft = Math.max(24, (rect.width - totalWidth * scale) / 2);
    const visualTop = Math.max(24, (rect.height - totalHeight * scale) / 2);
    const nextPan = {
      x: visualLeft - SURFACE_PADDING * scale,
      y: visualTop - SURFACE_PADDING * scale,
    };
    panRef.current = nextPan;
    setPan(nextPan);
    // Only on mount or when screen count changes, not on every pan update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.length, zoom]);

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
      duplicateCleanup.current?.();
    };
  }, []);

  const canvasPointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToCanvasPoint(
        { x: clientX, y: clientY },
        { ...panRef.current, zoom: zoomRef.current },
        { x: rect.left, y: rect.top },
        SURFACE_PADDING,
        true,
      );
    },
    [],
  );

  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToCanvasPoint(
      { x: clientX, y: clientY },
      { ...panRef.current, zoom: zoomRef.current },
      { x: rect.left, y: rect.top },
      SURFACE_PADDING,
    );
  }, []);

  const getCurrentFrameEntries = useCallback(
    () => getFrameEntries(screens, frameGeometryRef.current),
    [screens],
  );

  const installDragListeners = useCallback(
    (
      handleMouseMove: (ev: MouseEvent) => void,
      handleMouseUp: (ev: MouseEvent) => void,
    ) => {
      dragCleanup.current?.();
      dragCleanup.current = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        dragCleanup.current = null;
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  const finishDrag = useCallback(() => {
    dragState.current = null;
    setIsDragging(false);
    setIsPanning(false);
    setMarquee(null);
    setAlignmentGuides([]);
    dragCleanup.current?.();
  }, []);

  const beginPan = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragState.current = {
        type: "pan",
        originClient: { x: e.clientX, y: e.clientY },
        originPan: panRef.current,
      };
      setIsPanning(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "pan") return;
        const nextPan = {
          x: state.originPan.x + ev.clientX - state.originClient.x,
          y: state.originPan.y + ev.clientY - state.originClient.y,
        };
        panRef.current = nextPan;
        setPan(nextPan);
      };

      installDragListeners(handleMouseMove, finishDrag);
    },
    [finishDrag, installDragListeners],
  );

  const beginMarquee = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const originCanvas = getCanvasPoint(e.clientX, e.clientY);
      dragState.current = {
        type: "marquee",
        originClient: { x: e.clientX, y: e.clientY },
        originCanvas,
        baseSelectedIds: selectedIdsRef.current,
        additive: e.shiftKey,
        hasMoved: false,
      };
      setMarquee({ ...originCanvas, width: 0, height: 0 });
      if (!e.shiftKey) {
        updateSelectedIds(() => []);
      }
      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "marquee") return;
        const nextPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const rect = normalizeRectFromPoints(state.originCanvas, nextPoint);
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }
        setMarquee(rect);

        const hitIds = getCurrentFrameEntries()
          .filter((entry) =>
            rectIntersects(rect, getSelectableBounds(entry.geometry)),
          )
          .map((entry) => entry.id);
        updateSelectedIds(() =>
          state.additive
            ? dedupeIds([...state.baseSelectedIds, ...hitIds])
            : hitIds,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "marquee" && !state.hasMoved && !state.additive) {
          updateSelectedIds(() => []);
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCanvasPoint,
      getCurrentFrameEntries,
      installDragListeners,
      updateSelectedIds,
    ],
  );

  const beginFrameDrag = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button !== 0 || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();

      const currentSelectedIds = selectedIdsRef.current;
      const targetIds = currentSelectedIds.includes(id)
        ? currentSelectedIds
        : [id];
      if (!currentSelectedIds.includes(id)) {
        updateSelectedIds(() => [id]);
      }

      const entries = getCurrentFrameEntries();
      const originFrames = Object.fromEntries(
        entries
          .filter((entry) => targetIds.includes(entry.id))
          .map((entry) => [entry.id, entry.geometry]),
      ) as FrameGeometryById;
      if (!originFrames[id]) return;

      dragState.current = {
        type: "move",
        originClient: { x: e.clientX, y: e.clientY },
        originFrames,
        targetIds,
        primaryId: id,
        hasMoved: false,
      };
      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "move") return;
        const scale = zoomRef.current / 100;
        const dx = (ev.clientX - state.originClient.x) / scale;
        const dy = (ev.clientY - state.originClient.y) / scale;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }

        const movingEntries = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: {
            ...state.originFrames[targetId],
            x: state.originFrames[targetId].x + dx,
            y: state.originFrames[targetId].y + dy,
          },
        }));
        const stationaryEntries = getCurrentFrameEntries().filter(
          (entry) => !state.targetIds.includes(entry.id),
        );
        const snap = computeMoveSnap(movingEntries, stationaryEntries, {
          thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
          zoom: zoomRef.current,
        });

        updateFrameGeometry((current) => {
          const next = { ...current };
          state.targetIds.forEach((targetId) => {
            const origin = state.originFrames[targetId];
            next[targetId] = {
              ...origin,
              x: origin.x + dx + snap.dx,
              y: origin.y + dy + snap.dy,
            };
          });
          return next;
        });
        setAlignmentGuides(snap.guides);
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "move" && state.hasMoved) {
          suppressNextPick.current = true;
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCurrentFrameEntries,
      installDragListeners,
      updateFrameGeometry,
      updateSelectedIds,
    ],
  );

  const beginResize = useCallback(
    (id: string, handle: ResizeHandle, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextPick.current = true;

      const originFrame = getCurrentFrameEntries().find(
        (entry) => entry.id === id,
      )?.geometry;
      if (!originFrame) return;
      updateSelectedIds((current) => (current.includes(id) ? current : [id]));

      dragState.current = {
        type: "resize",
        originClient: { x: e.clientX, y: e.clientY },
        originFrame,
        frameId: id,
        handle,
        hasMoved: false,
      };
      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "resize") return;
        const scale = zoomRef.current / 100;
        const dx = (ev.clientX - state.originClient.x) / scale;
        const dy = (ev.clientY - state.originClient.y) / scale;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }

        const resizedFrame = resizeFrameFromDelta(
          state.originFrame,
          state.handle,
          dx,
          dy,
        );
        const snap = computeResizeSnap(
          resizedFrame,
          getCurrentFrameEntries().filter(
            (entry) => entry.id !== state.frameId,
          ),
          state.handle,
          {
            thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
            zoom: zoomRef.current,
          },
        );
        updateFrameGeometry((current) => ({
          ...current,
          [state.frameId]: snap.frame,
        }));
        setAlignmentGuides(snap.guides);
      };

      installDragListeners(handleMouseMove, finishDrag);
    },
    [
      finishDrag,
      getCurrentFrameEntries,
      installDragListeners,
      updateFrameGeometry,
      updateSelectedIds,
    ],
  );

  const beginRotate = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextPick.current = true;

      const originFrame = getCurrentFrameEntries().find(
        (entry) => entry.id === id,
      )?.geometry;
      if (!originFrame) return;
      updateSelectedIds((current) => (current.includes(id) ? current : [id]));

      const pointer = getCanvasPoint(e.clientX, e.clientY);
      const center = getFrameCenter(originFrame);
      dragState.current = {
        type: "rotate",
        originClient: { x: e.clientX, y: e.clientY },
        originFrame,
        frameId: id,
        originPointerAngle: angleBetween(center, pointer),
        originRotation: originFrame.rotation ?? 0,
        hasMoved: false,
      };
      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "rotate") return;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }
        const pointer = getCanvasPoint(ev.clientX, ev.clientY);
        const center = getFrameCenter(state.originFrame);
        const raw =
          state.originRotation +
          angleBetween(center, pointer) -
          state.originPointerAngle;
        const rotation = ev.shiftKey ? Math.round(raw / 15) * 15 : raw;
        updateFrameGeometry((current) => ({
          ...current,
          [state.frameId]: {
            ...state.originFrame,
            rotation: Math.round(rotation * 10) / 10,
          },
        }));
      };

      const handleMouseUp = () => {
        suppressNextPick.current = true;
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCanvasPoint,
      getCurrentFrameEntries,
      installDragListeners,
      updateFrameGeometry,
      updateSelectedIds,
    ],
  );

  const handleFrameClick = useCallback(
    (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (suppressNextPick.current) {
        suppressNextPick.current = false;
        return;
      }

      if (e.shiftKey) {
        updateSelectedIds((current) =>
          current.includes(id)
            ? current.filter((selectedId) => selectedId !== id)
            : [...current, id],
        );
        return;
      }

      updateSelectedIds(() => [id]);
      onPick(id);
    },
    [onPick, updateSelectedIds],
  );

  const beginDuplicateGesture = useCallback(
    (
      screen: ScreenFile,
      display: string,
      e: React.MouseEvent<HTMLButtonElement>,
    ) => {
      if (e.button !== 0 || !e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      duplicateCleanup.current?.();

      const surfaceRect = surfaceRef.current?.getBoundingClientRect();
      const origin = { x: e.clientX, y: e.clientY };
      const previewPoint = {
        x: surfaceRect ? e.clientX - surfaceRect.left + 16 : e.clientX,
        y: surfaceRect ? e.clientY - surfaceRect.top + 16 : e.clientY,
      };

      setDuplicatePreview({
        display,
        x: previewPoint.x,
        y: previewPoint.y,
        canDuplicate: !!onDuplicate,
        moved: false,
      });

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - origin.x;
        const dy = ev.clientY - origin.y;
        const moved = Math.hypot(dx, dy) >= DUPLICATE_DRAG_THRESHOLD;
        const rect = surfaceRef.current?.getBoundingClientRect();
        setDuplicatePreview({
          display,
          x: rect ? ev.clientX - rect.left + 16 : ev.clientX,
          y: rect ? ev.clientY - rect.top + 16 : ev.clientY,
          canDuplicate: !!onDuplicate,
          moved,
        });
      };

      const cleanupDuplicateGesture = () => {
        setDuplicatePreview(null);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        duplicateCleanup.current = null;
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const moved =
          Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) >=
          DUPLICATE_DRAG_THRESHOLD;
        const mode = moved ? "alt-drag" : "alt-click";

        if (onDuplicate) {
          onDuplicate(screen.id, {
            mode,
            screen,
            canvasPosition: canvasPointFromClient(ev.clientX, ev.clientY),
          });
        } else if (!moved) {
          onPick(screen.id);
        }

        cleanupDuplicateGesture();
      };

      duplicateCleanup.current = cleanupDuplicateGesture;
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [canvasPointFromClient, onDuplicate, onPick],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const onFrame = !!target.closest("[data-frame-shell]");
      if (e.button === 1) {
        beginPan(e);
        return;
      }
      if (e.button === 0 && !onFrame) {
        beginMarquee(e);
      }
    },
    [beginMarquee, beginPan],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      const delta = getWheelDelta(e.nativeEvent);

      if (e.ctrlKey || e.metaKey) {
        const currentZoom = zoomRef.current;
        const nextZoom = clamp(
          currentZoom * Math.exp(-delta.y * ZOOM_SENSITIVITY),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        if (nextZoom === currentZoom) return;

        const nextPan = getPanForZoomToCursor({
          pan: panRef.current,
          cursor: { x: e.clientX - rect.left, y: e.clientY - rect.top },
          oldZoom: currentZoom,
          nextZoom,
        });

        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        setCanvasZoom(nextZoom);
        setPan(nextPan);
        onZoomChange?.(nextZoom);
        return;
      }

      const deltaX = e.shiftKey && delta.x === 0 ? delta.y : delta.x;
      const deltaY = e.shiftKey && delta.x === 0 ? 0 : delta.y;
      const nextPan = {
        x: panRef.current.x - deltaX,
        y: panRef.current.y - deltaY,
      };
      panRef.current = nextPan;
      setPan(nextPan);
    },
    [onZoomChange],
  );

  const scale = canvasZoom / 100;
  const gridSize = 24 * scale;
  const showPixelGrid = canvasZoom >= PIXEL_GRID_ZOOM;
  const selectedIdSet = new Set(selectedIds);
  const surfaceCursor = isPanning
    ? "grabbing"
    : isDragging && marquee
      ? "crosshair"
      : "default";
  const canvasFrames = screens.map((screen, index) => ({
    screen,
    geometry: frameGeometry[screen.id] ?? getInitialFrameGeometry(index),
  }));
  const rulerTicks = useMemo(
    () =>
      getRulerTicks({
        pan,
        zoom: canvasZoom,
        width: surfaceRef.current?.clientWidth ?? 0,
        height: surfaceRef.current?.clientHeight ?? 0,
      }),
    [canvasZoom, pan],
  );

  return (
    <div
      ref={surfaceRef}
      className="relative h-full w-full select-none overflow-hidden bg-background"
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      style={{ cursor: surfaceCursor }}
    >
      {/* Dot grid extends past the surface so panning never shows page bg. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
          backgroundPosition: `${pan.x}px ${pan.y}px`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
        }}
      />
      {showPixelGrid ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)",
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            backgroundSize: `${scale}px ${scale}px`,
          }}
        />
      ) : null}

      <CanvasRulers ticks={rulerTicks} />

      <div
        className="pointer-events-none absolute"
        style={{
          left: pan.x,
          top: pan.y,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {canvasFrames.map(({ screen, geometry }) => {
          const metadata = resolveScreenMetadata(
            screen,
            metadataById?.[screen.id],
            getScreenMetadata?.(screen),
          );
          return (
            <Screen
              key={screen.id}
              screen={screen}
              metadata={metadata}
              geometry={geometry}
              isActive={screen.id === activeId}
              isSelected={selectedIdSet.has(screen.id)}
              canDuplicate={!!onDuplicate}
              onPick={handleFrameClick}
              onStartFrameDrag={beginFrameDrag}
              onStartResize={beginResize}
              onStartRotate={beginRotate}
              onStartDuplicateGesture={beginDuplicateGesture}
            />
          );
        })}

        {alignmentGuides.map((guide, index) => (
          <span
            key={`${guide.orientation}-${guide.position}-${index}`}
            className="pointer-events-none absolute z-30 bg-destructive/90"
            style={
              guide.orientation === "vertical"
                ? {
                    left: SURFACE_PADDING + guide.position,
                    top: SURFACE_PADDING + guide.start,
                    width: 1,
                    height: Math.max(1, guide.end - guide.start),
                  }
                : {
                    left: SURFACE_PADDING + guide.start,
                    top: SURFACE_PADDING + guide.position,
                    width: Math.max(1, guide.end - guide.start),
                    height: 1,
                  }
            }
          />
        ))}

        {marquee ? (
          <span
            className="pointer-events-none absolute z-40 border border-primary/80 bg-primary/10"
            style={{
              left: SURFACE_PADDING + marquee.x,
              top: SURFACE_PADDING + marquee.y,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        ) : null}
      </div>

      {duplicatePreview ? (
        <div
          className={cn(
            "pointer-events-none absolute z-20 rounded-lg border bg-background/90 shadow-2xl backdrop-blur-sm transition-colors",
            duplicatePreview.canDuplicate
              ? "border-primary/80 ring-4 ring-primary/15"
              : "border-dashed border-muted-foreground/45",
          )}
          style={{
            left: duplicatePreview.x,
            top: duplicatePreview.y,
            width: SCREEN_WIDTH * Math.min(scale, 1),
            height: SCREEN_HEIGHT * Math.min(scale, 1),
            maxWidth: SCREEN_WIDTH,
            maxHeight: SCREEN_HEIGHT,
          }}
        >
          <div className="flex h-full w-full items-start justify-between rounded-lg bg-muted/20 p-2">
            <span className="max-w-[190px] truncate text-[11px] font-medium text-foreground">
              {duplicatePreview.display}
            </span>
            <span className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
              <IconCopy className="h-3 w-3" />
              {duplicatePreview.canDuplicate
                ? duplicatePreview.moved
                  ? t("multiScreenCanvas.fork")
                  : t("multiScreenCanvas.duplicate")
                : t("multiScreenCanvas.preview")}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Screen({
  screen,
  metadata,
  geometry,
  isActive,
  isSelected,
  canDuplicate,
  onPick,
  onStartFrameDrag,
  onStartResize,
  onStartRotate,
  onStartDuplicateGesture,
}: {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  geometry: FrameGeometry;
  isActive: boolean;
  isSelected: boolean;
  canDuplicate: boolean;
  onPick: (id: string, e: React.MouseEvent<HTMLButtonElement>) => void;
  onStartFrameDrag: (id: string, e: React.MouseEvent) => void;
  onStartResize: (
    id: string,
    handle: ResizeHandle,
    e: React.MouseEvent,
  ) => void;
  onStartRotate: (id: string, e: React.MouseEvent) => void;
  onStartDuplicateGesture: (
    screen: ScreenFile,
    display: string,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  const t = useT();
  const display = metadata.title ?? prettyScreenName(screen.filename);
  const sourceConfig = SOURCE_CONFIG[metadata.source];
  const previewConfig = PREVIEW_CONFIG[metadata.previewState];
  const SourceIcon = sourceConfig.icon;
  const previewUrl = metadata.previewUrl ?? getPreviewUrl(screen.content);
  const suppressNextClick = useRef(false);
  const highlighted = isActive || isSelected;

  return (
    <div
      data-frame-shell
      className="group/frame pointer-events-auto absolute"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y - FRAME_LABEL_HEIGHT,
        width: geometry.width,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${FRAME_LABEL_HEIGHT + geometry.height / 2}px`,
        zIndex: geometry.z,
      }}
    >
      <div
        className="flex h-7 w-full cursor-default items-center justify-between gap-2 px-1"
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.shiftKey) {
            e.stopPropagation();
            return;
          }
          onStartFrameDrag(screen.id, e);
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              highlighted ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <span
            className={cn(
              "truncate text-[11px] font-medium",
              highlighted ? "text-foreground" : "text-muted-foreground",
            )}
            title={screen.filename}
          >
            {display}
          </span>
          <span className="hidden shrink-0 text-[10px] tabular-nums text-muted-foreground/70 sm:inline">
            {metadata.width} x {metadata.height}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium",
              sourceConfig.className,
            )}
            title={t(sourceConfig.titleKey)}
          >
            <SourceIcon className="h-3 w-3" />
            {t(sourceConfig.labelKey)}
          </span>
          <span
            className={cn(
              "h-5 rounded-md border px-1.5 text-[10px] font-medium leading-5",
              previewConfig.className,
            )}
            title={t(previewConfig.titleKey)}
          >
            {t(previewConfig.labelKey)}
          </span>
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-screen-card
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (suppressNextClick.current) {
                suppressNextClick.current = false;
                return;
              }
              onPick(screen.id, e);
            }}
            onMouseDown={(e) => {
              if (e.altKey && e.button === 0) {
                suppressNextClick.current = true;
                onStartDuplicateGesture(screen, display, e);
                return;
              }
              if (e.button === 0) {
                if (e.shiftKey) {
                  e.stopPropagation();
                  return;
                }
                onStartFrameDrag(screen.id, e);
              }
            }}
            className={cn(
              "group/artboard relative block overflow-visible rounded-lg bg-background text-left outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              highlighted
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            style={{
              width: geometry.width,
              height: geometry.height,
              cursor: isSelected ? "move" : "pointer",
            }}
          >
            <span
              className={cn(
                "pointer-events-none absolute -inset-[5px] rounded-[13px] border transition-opacity",
                highlighted
                  ? cn(
                      "border-primary opacity-100",
                      isActive
                        ? "ring-4 ring-primary/15"
                        : "ring-2 ring-primary/10",
                    )
                  : "border-primary/40 opacity-0 group-hover/artboard:opacity-100",
              )}
            />
            <span
              className={cn(
                "relative block h-full w-full overflow-hidden rounded-lg border bg-white shadow-2xl transition-colors",
                highlighted
                  ? "border-primary/70"
                  : "border-border group-hover/artboard:border-muted-foreground/60",
              )}
            >
              <iframe
                src={previewUrl}
                srcDoc={previewUrl ? undefined : screen.content}
                sandbox="allow-scripts"
                loading="lazy"
                className="pointer-events-none border-0"
                style={{
                  width: metadata.width,
                  height: metadata.height,
                  transform: `scale(${geometry.width / metadata.width}, ${
                    geometry.height / metadata.height
                  })`,
                  transformOrigin: "top left",
                }}
                title={screen.filename}
              />
              <span className="pointer-events-none absolute inset-0 rounded-[7px] border border-black/5" />
              <span className="pointer-events-none absolute right-2 top-2 flex h-6 max-w-[calc(100%-1rem)] translate-y-1 items-center gap-1 truncate rounded-md border border-border bg-background/95 px-1.5 text-[10px] font-medium text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-all group-hover/artboard:translate-y-0 group-hover/artboard:opacity-100 group-focus-visible/artboard:translate-y-0 group-focus-visible/artboard:opacity-100">
                <IconCopy className="h-3 w-3" />
                {canDuplicate
                  ? t("multiScreenCanvas.option")
                  : t("multiScreenCanvas.preview")}
              </span>
              <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border bg-background/95 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100">
                {t(previewConfig.shortLabelKey)}
              </span>
            </span>
            <ResizeHandles
              active={highlighted}
              onStartResize={(handle, e) => onStartResize(screen.id, handle, e)}
              onStartRotate={(e) => onStartRotate(screen.id, e)}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {canDuplicate
            ? t("multiScreenCanvas.openAndDuplicate", { display })
            : t("multiScreenCanvas.openAndPreview", { display })}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function ResizeHandles({
  active,
  onStartResize,
  onStartRotate,
}: {
  active: boolean;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate: (e: React.MouseEvent) => void;
}) {
  const handleClass = cn(
    "pointer-events-auto absolute z-20 size-2 rounded-[2px] border border-primary/80 bg-background shadow-sm transition-opacity",
    active
      ? "opacity-100"
      : "opacity-0 group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100",
  );

  return (
    <>
      {RESIZE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-resize-handle
          className={cn(handleClass, config.className)}
          style={{ cursor: config.cursor }}
          onMouseDown={(e) => onStartResize(config.handle, e)}
        />
      ))}
      {ROTATE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.corner}
          data-rotate-handle
          className={cn(
            "pointer-events-auto absolute z-10 size-5 rounded-full transition-opacity",
            active
              ? "opacity-100"
              : "opacity-0 group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100",
            config.className,
          )}
          style={{ cursor: "grab" }}
          onMouseDown={onStartRotate}
        />
      ))}
    </>
  );
}

const RESIZE_HANDLE_CONFIGS: Array<{
  handle: ResizeHandle;
  className: string;
  cursor: string;
}> = [
  { handle: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
  {
    handle: "n",
    className: "-top-1 left-1/2 -translate-x-1/2",
    cursor: "ns-resize",
  },
  { handle: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
  {
    handle: "e",
    className: "-right-1 top-1/2 -translate-y-1/2",
    cursor: "ew-resize",
  },
  { handle: "se", className: "-bottom-1 -right-1", cursor: "nwse-resize" },
  {
    handle: "s",
    className: "-bottom-1 left-1/2 -translate-x-1/2",
    cursor: "ns-resize",
  },
  { handle: "sw", className: "-bottom-1 -left-1", cursor: "nesw-resize" },
  {
    handle: "w",
    className: "-left-1 top-1/2 -translate-y-1/2",
    cursor: "ew-resize",
  },
];

const ROTATE_HANDLE_CONFIGS: Array<{
  corner: string;
  className: string;
}> = [
  { corner: "nw", className: "-left-7 -top-7" },
  { corner: "ne", className: "-right-7 -top-7" },
  { corner: "se", className: "-bottom-7 -right-7" },
  { corner: "sw", className: "-bottom-7 -left-7" },
];

function CanvasRulers({ ticks }: { ticks: RulerTicks }) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-border/70 bg-background/85 backdrop-blur"
        style={{ height: RULER_SIZE }}
      >
        {ticks.x.map((tick) => (
          <span
            key={`x-${tick.value}`}
            className="absolute bottom-0 w-px bg-border"
            style={{
              left: tick.screen,
              height: tick.major ? 12 : 6,
            }}
          >
            {tick.major ? (
              <span className="absolute bottom-3 left-1 text-[9px] tabular-nums text-muted-foreground">
                {tick.label}
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div
        className="pointer-events-none absolute bottom-0 left-0 top-0 z-20 border-r border-border/70 bg-background/85 backdrop-blur"
        style={{ width: RULER_SIZE }}
      >
        {ticks.y.map((tick) => (
          <span
            key={`y-${tick.value}`}
            className="absolute right-0 h-px bg-border"
            style={{
              top: tick.screen,
              width: tick.major ? 12 : 6,
            }}
          >
            {tick.major ? (
              <span className="absolute left-1 top-1 text-[9px] tabular-nums text-muted-foreground [writing-mode:vertical-rl]">
                {tick.label}
              </span>
            ) : null}
          </span>
        ))}
      </div>
      <div
        className="pointer-events-none absolute left-0 top-0 z-30 border-b border-r border-border bg-background"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />
    </>
  );
}

interface FrameEntry {
  id: string;
  geometry: FrameGeometry;
}

interface BoundsRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RulerTick {
  value: number;
  screen: number;
  label: string;
  major: boolean;
}

interface RulerTicks {
  x: RulerTick[];
  y: RulerTick[];
}

function getInitialFrameGeometry(index: number): FrameGeometry {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: column * (SCREEN_WIDTH + SCREEN_GAP),
    y: row * (SCREEN_CARD_HEIGHT + SCREEN_GAP),
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  };
}

function getFrameEntries(
  screens: ScreenFile[],
  geometryById: FrameGeometryById,
): FrameEntry[] {
  return screens.map((screen, index) => ({
    id: screen.id,
    geometry: geometryById[screen.id] ?? getInitialFrameGeometry(index),
  }));
}

function dedupeIds(ids: string[]) {
  return [...new Set(ids)];
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function normalizeRectFromPoints(start: Point, end: Point): MarqueeRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function rectIntersects(rect: MarqueeRect, bounds: BoundsRect) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return (
    rect.x <= bounds.right &&
    right >= bounds.left &&
    rect.y <= bounds.bottom &&
    bottom >= bounds.top
  );
}

function getFrameCenter(frame: FrameGeometry): Point {
  return {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
}

function angleBetween(center: Point, point: Point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function getRulerTicks({
  pan,
  zoom,
  width,
  height,
}: {
  pan: Point;
  zoom: number;
  width: number;
  height: number;
}): RulerTicks {
  const scale = zoom / 100;
  const step = getRulerStep(scale);
  return {
    x: getAxisTicks(pan.x, scale, width, step),
    y: getAxisTicks(pan.y, scale, height, step),
  };
}

function getRulerStep(scale: number) {
  const targetScreenStep = 80;
  const raw = targetScreenStep / Math.max(0.01, scale);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const multiplier = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function getAxisTicks(
  panValue: number,
  scale: number,
  viewportSize: number,
  step: number,
): RulerTick[] {
  if (viewportSize <= 0) return [];
  const canvasStart = (-panValue / scale - SURFACE_PADDING) / step;
  const canvasEnd =
    ((viewportSize - panValue) / scale - SURFACE_PADDING) / step;
  const first = Math.floor(canvasStart) - 1;
  const last = Math.ceil(canvasEnd) + 1;
  const ticks: RulerTick[] = [];
  for (let index = first; index <= last; index += 1) {
    const value = index * step;
    const screen = panValue + (value + SURFACE_PADDING) * scale;
    const major = index % 2 === 0;
    ticks.push({
      value,
      screen,
      label: formatRulerValue(value),
      major,
    });
  }
  return ticks;
}

function formatRulerValue(value: number) {
  return Math.abs(value) >= 1000
    ? `${Math.round(value / 100) / 10}k`
    : String(value);
}

function getSelectableBounds(geometry: FrameGeometry): BoundsRect {
  return {
    left: geometry.x,
    top: geometry.y - FRAME_LABEL_HEIGHT,
    right: geometry.x + geometry.width,
    bottom: geometry.y + geometry.height,
  };
}

function getWheelDelta(event: WheelEvent) {
  const multiplier =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
  return {
    x: event.deltaX * multiplier,
    y: event.deltaY * multiplier,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveScreenMetadata(
  screen: ScreenFile,
  keyedMetadata?: ScreenMetadata,
  getterMetadata?: ScreenMetadata,
): ResolvedScreenMetadata {
  const metadata = { ...screen, ...keyedMetadata, ...getterMetadata };
  const previewUrl =
    metadata.url ??
    metadata.previewUrl ??
    screen.previewUrl ??
    getPreviewUrl(screen.content);
  const width = metadata.width && metadata.width > 0 ? metadata.width : 1280;
  const height =
    metadata.height && metadata.height > 0 ? metadata.height : 2560;
  return {
    source:
      normalizeSource(metadata.sourceType ?? metadata.source) ??
      deriveSource(screen, previewUrl),
    previewState:
      normalizePreviewState(
        metadata.lod ?? metadata.previewState ?? metadata.status,
      ) ?? derivePreviewState(screen, previewUrl),
    title: metadata.title,
    width,
    height,
    previewUrl,
  };
}

function normalizeSource(value?: string): ScreenSourceType | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "local" || normalized === "localhost") return "localhost";
  if (normalized === "fusion" || normalized === "remote-fusion")
    return "fusion";
  if (normalized === "inline" || normalized === "code") return "inline";
  return undefined;
}

function normalizePreviewState(value?: string): ScreenPreviewState | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "live") return "live";
  if (normalized === "snapshot" || normalized === "cached") return "snapshot";
  if (normalized === "preview" || normalized === "draft") return "preview";
  return undefined;
}

function deriveSource(
  screen: ScreenFile,
  previewUrl?: string,
): ScreenSourceType {
  const haystack =
    `${screen.filename} ${screen.content.slice(0, 4000)}`.toLowerCase();
  const url = getUrl(previewUrl ?? screen.content);

  if (
    url?.hostname === "localhost" ||
    url?.hostname === "127.0.0.1" ||
    url?.hostname.endsWith(".local") ||
    haystack.includes("localhost") ||
    haystack.includes("127.0.0.1")
  ) {
    return "localhost";
  }

  if (haystack.includes("fusion") || url?.hostname.includes("fusion")) {
    return "fusion";
  }

  return "inline";
}

function derivePreviewState(
  screen: ScreenFile,
  previewUrl?: string,
): ScreenPreviewState {
  const haystack =
    `${screen.filename} ${screen.content.slice(0, 4000)}`.toLowerCase();

  if (
    haystack.includes("snapshot") ||
    haystack.includes("screenshot") ||
    haystack.includes("cached") ||
    haystack.includes("data:image/")
  ) {
    return "snapshot";
  }

  if (previewUrl || deriveSource(screen, previewUrl) !== "inline") {
    return "live";
  }

  return "preview";
}

function getPreviewUrl(content: string) {
  return getUrl(content.trim())?.toString();
}

function getUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

const SOURCE_CONFIG = {
  localhost: {
    labelKey: "multiScreenCanvas.sources.localhost.label",
    titleKey: "multiScreenCanvas.sources.localhost.title",
    icon: IconDeviceDesktop,
    className:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  fusion: {
    labelKey: "multiScreenCanvas.sources.fusion.label",
    titleKey: "multiScreenCanvas.sources.fusion.title",
    icon: IconCloud,
    className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  inline: {
    labelKey: "multiScreenCanvas.sources.inline.label",
    titleKey: "multiScreenCanvas.sources.inline.title",
    icon: IconCode,
    className: "border-border bg-muted/70 text-muted-foreground",
  },
} satisfies Record<
  ScreenSourceType,
  {
    labelKey: string;
    titleKey: string;
    icon: typeof IconDeviceDesktop;
    className: string;
  }
>;

const PREVIEW_CONFIG = {
  live: {
    labelKey: "multiScreenCanvas.previews.live.label",
    shortLabelKey: "multiScreenCanvas.previews.live.shortLabel",
    titleKey: "multiScreenCanvas.previews.live.title",
    className:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  snapshot: {
    labelKey: "multiScreenCanvas.previews.snapshot.label",
    shortLabelKey: "multiScreenCanvas.previews.snapshot.shortLabel",
    titleKey: "multiScreenCanvas.previews.snapshot.title",
    className:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  preview: {
    labelKey: "multiScreenCanvas.previews.preview.label",
    shortLabelKey: "multiScreenCanvas.previews.preview.shortLabel",
    titleKey: "multiScreenCanvas.previews.preview.title",
    className: "border-border bg-muted/70 text-muted-foreground",
  },
} satisfies Record<
  ScreenPreviewState,
  {
    labelKey: string;
    shortLabelKey: string;
    titleKey: string;
    className: string;
  }
>;
