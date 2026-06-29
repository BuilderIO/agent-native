import { useT } from "@agent-native/core/client";
import {
  DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
  appendPolylinePoint,
  computeMoveSnap,
  computeResizeSnap,
  getDraftGeometryFromPoints,
  getFrameGroupBounds,
  getNudgeDelta,
  getPanForZoomToCursor,
  resizeFrameGroupFromDelta,
  resizeFrameGroupToBounds,
  screenToCanvasPoint,
  type ArrowNudgeKey,
} from "@shared/canvas-math";
import {
  appendPenNode,
  clonePenPath,
  closePenPath,
  constrainPointTo45Degrees,
  createCornerNode,
  createSmoothNode,
  getPenPathGeometry,
  isPenCloseTarget,
  scalePenPathToGeometry,
  serializePenPath,
  translatePenPath,
  type PenNode,
  type PenPath,
} from "@shared/pen-path";
import { IconCopy, IconMaximize } from "@tabler/icons-react";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";

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
type MultiScreenCanvasTool =
  | "move"
  | "frame"
  | "rect"
  | "rectangle"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "pen"
  | "hand"
  | "comment"
  | "draw"
  | "scale";

interface CanvasToolProps {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
}

export interface CanvasPrimitiveInsert {
  kind: DraftPrimitiveKind;
  nodeId?: string;
  geometry: FrameGeometry;
  points?: Point[];
  pathData?: string;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  autoSize?: boolean;
}

interface PersistedDraftPrimitive {
  frameId: string;
  nodeId: string;
}

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
  canvasOffset?: { x: number; y: number };
  dropCanvasPosition?: { x: number; y: number };
}

interface MultiScreenCanvasProps {
  screens: ScreenFile[];
  zoom: number;
  activeId?: string | null;
  activeTool?: MultiScreenCanvasTool;
  toolProps?: CanvasToolProps;
  onActiveToolChange?: (tool: MultiScreenCanvasTool) => void;
  onPick: (id: string) => void;
  onEdit?: (id: string) => void;
  metadataById?: Record<string, ScreenMetadata | undefined>;
  getScreenMetadata?: (screen: ScreenFile) => ScreenMetadata | undefined;
  onDuplicate?: (id: string, request: DuplicateRequest) => void;
  geometryById?: Record<string, Partial<FrameGeometry> | undefined>;
  onGeometryChange?: (geometryById: FrameGeometryById) => void;
  onGeometryCommit?: (
    before: FrameGeometryById,
    after: FrameGeometryById,
  ) => void;
  onCreatePrimitive?: (
    screenId: string,
    primitive: CanvasPrimitiveInsert,
  ) => boolean | string;
  onCreateScreenFrame?: (geometry: FrameGeometry) => void;
  onDeleteSelection?: (ids: string[]) => boolean | void;
  onZoomChange?: (zoom: number) => void;
  onZoomToEdit?: (id: string) => void;
  zoomToEditThreshold?: number;
  renderScreenContent?: (
    screen: ScreenFile,
    metadata: ResolvedScreenMetadata,
    geometry: FrameGeometry,
  ) => ReactNode;
  selectAllRequest?: number;
  clearSelectionRequest?: number;
}

/**
 * design-editor overview canvas. Renders every file in the design as a movable,
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
const MAX_WHEEL_ZOOM_DELTA = 80;
const MAX_WHEEL_PAN_DELTA = 140;
const PIXEL_GRID_ZOOM = 800;
const DRAFT_FRAME_WIDTH = 320;
const DRAFT_FRAME_HEIGHT = 640;
const DRAFT_RECT_WIDTH = 160;
const DRAFT_RECT_HEIGHT = 120;
const DRAFT_TEXT_WIDTH = 180;
const DRAFT_TEXT_HEIGHT = 48;
const DRAFT_LINE_WIDTH = 160;
const DRAFT_PATH_MIN_SIZE = 12;
const PEN_SAMPLE_DISTANCE_SCREEN_PX = 5;
const PEN_CLOSE_HIT_RADIUS_SCREEN_PX = 10;

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
  width: number;
  height: number;
  canDuplicate: boolean;
  moved: boolean;
}

interface TransformBadge {
  x: number;
  y: number;
  text: string;
}

export interface FrameGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
}

type FrameGeometryById = Record<string, FrameGeometry>;

export interface Point {
  x: number;
  y: number;
}

export type DraftPrimitiveKind =
  | "frame"
  | "rectangle"
  | "ellipse"
  | "polygon"
  | "star"
  | "line"
  | "arrow"
  | "text"
  | "path";
type DraftCreationTool =
  | "frame"
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "pen";

interface DraftPrimitive {
  id: string;
  kind: DraftPrimitiveKind;
  geometry: FrameGeometry;
  points?: Point[];
  penPath?: PenPath;
  pathData?: string;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  autoSize?: boolean;
}

type DraftPrimitiveById = Record<string, DraftPrimitive>;

interface DraftPrimitiveInput {
  tool: DraftCreationTool;
  start: Point;
  end: Point;
  points?: Point[];
  moved: boolean;
  toolProps?: CanvasToolProps;
  fallbackText: string;
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
  originFrames: FrameGeometryById;
  originBounds: FrameGeometry;
  targetIds: string[];
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
  baseSelectedDraftIds: string[];
  additive: boolean;
  hasMoved: boolean;
}

interface PanDragState {
  type: "pan";
  originClient: Point;
  originPan: Point;
}

interface DraftMoveDragState {
  type: "draft-move";
  originClient: Point;
  originDrafts: DraftPrimitiveById;
  targetIds: string[];
  primaryId: string;
  hasMoved: boolean;
}

interface DraftResizeDragState {
  type: "draft-resize";
  originClient: Point;
  originDrafts: DraftPrimitiveById;
  originBounds: FrameGeometry;
  targetIds: string[];
  handle: ResizeHandle;
  hasMoved: boolean;
}

interface DraftCreateDragState {
  type: "draft-create";
  tool: DraftCreationTool;
  originClient: Point;
  originCanvas: Point;
  originFrameId?: string;
  points: Point[];
  hasMoved: boolean;
}

interface PenNodeDragState {
  type: "pen-node";
  originClient: Point;
  anchor: Point;
  pathBefore: PenPath | null;
  hasMoved: boolean;
}

interface DraftCreationPreview {
  tool: DraftCreationTool;
  geometry: FrameGeometry;
  points?: Point[];
}

type DragState =
  | MoveDragState
  | ResizeDragState
  | RotateDragState
  | MarqueeDragState
  | PanDragState
  | DraftMoveDragState
  | DraftResizeDragState
  | DraftCreateDragState
  | PenNodeDragState;

export function MultiScreenCanvas({
  screens,
  zoom,
  activeId,
  activeTool,
  toolProps,
  onActiveToolChange,
  onPick,
  onEdit,
  metadataById,
  getScreenMetadata,
  onDuplicate,
  geometryById,
  onGeometryChange,
  onGeometryCommit,
  onCreatePrimitive,
  onCreateScreenFrame,
  onDeleteSelection,
  onZoomChange,
  onZoomToEdit,
  zoomToEditThreshold,
  renderScreenContent,
  selectAllRequest,
  clearSelectionRequest,
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
  const onGeometryCommitRef = useRef(onGeometryCommit);
  const [draftPrimitives, setDraftPrimitives] = useState<DraftPrimitive[]>([]);
  const draftPrimitivesRef = useRef(draftPrimitives);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const selectedDraftIdsRef = useRef(selectedDraftIds);
  const [creationPreview, setCreationPreview] =
    useState<DraftCreationPreview | null>(null);
  const [activePenPath, setActivePenPath] = useState<PenPath | null>(null);
  const activePenPathRef = useRef<PenPath | null>(activePenPath);
  const [penGesturePreview, setPenGesturePreview] = useState<PenPath | null>(
    null,
  );
  const [penPointer, setPenPointer] = useState<Point | null>(null);
  const [penCloseHover, setPenCloseHover] = useState(false);
  const [localActiveTool, setLocalActiveTool] =
    useState<MultiScreenCanvasTool>("move");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    activeId ? [activeId] : [],
  );
  const selectedIdsRef = useRef(selectedIds);
  const dragState = useRef<DragState | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const duplicateCleanup = useRef<(() => void) | null>(null);
  const handledSelectAllRequestRef = useRef(selectAllRequest);
  const handledClearSelectionRequestRef = useRef(clearSelectionRequest);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [duplicatePreview, setDuplicatePreview] =
    useState<DuplicatePreview | null>(null);
  const [transformBadge, setTransformBadge] = useState<TransformBadge | null>(
    null,
  );
  const [dragCursor, setDragCursor] = useState<string | null>(null);
  const suppressNextPick = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  useEffect(() => {
    onGeometryCommitRef.current = onGeometryCommit;
  }, [onGeometryCommit]);

  useEffect(() => {
    activePenPathRef.current = activePenPath;
  }, [activePenPath]);

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

  const updateDraftPrimitives = useCallback(
    (updater: (current: DraftPrimitive[]) => DraftPrimitive[]) => {
      setDraftPrimitives((current) => {
        const next = updater(current);
        draftPrimitivesRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateSelectedDraftIds = useCallback(
    (updater: (current: string[]) => string[]) => {
      setSelectedDraftIds((current) => {
        const currentIds = new Set(
          draftPrimitivesRef.current.map(({ id }) => id),
        );
        const next = dedupeIds(updater(current)).filter((id) =>
          currentIds.has(id),
        );
        if (sameIds(current, next)) {
          selectedDraftIdsRef.current = current;
          return current;
        }
        selectedDraftIdsRef.current = next;
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
    draftPrimitivesRef.current = draftPrimitives;
  }, [draftPrimitives]);

  useEffect(() => {
    selectedDraftIdsRef.current = selectedDraftIds;
  }, [selectedDraftIds]);

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
        const resolved = {
          ...getInitialFrameGeometry(index),
          ...persisted,
        } as FrameGeometry;
        next[screen.id] = persisted ? resolved : (existing ?? resolved);
        if (
          !existing ||
          (persisted && !sameFrameGeometry(existing, resolved))
        ) {
          changed = true;
        }
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
    updateSelectedDraftIds(() => []);
    updateSelectedIds(() => screens.map((screen) => screen.id));
  }, [screens, selectAllRequest, updateSelectedDraftIds, updateSelectedIds]);

  useEffect(() => {
    if (
      clearSelectionRequest === undefined ||
      clearSelectionRequest === handledClearSelectionRequestRef.current
    ) {
      return;
    }
    handledClearSelectionRequestRef.current = clearSelectionRequest;
    updateSelectedDraftIds(() => []);
    updateSelectedIds(() => []);
    setMarquee(null);
    setAlignmentGuides([]);
    setTransformBadge(null);
  }, [clearSelectionRequest, updateSelectedDraftIds, updateSelectedIds]);

  // Center the lineup on first mount so the user sees screens, not whitespace.
  useEffect(() => {
    if (!surfaceRef.current || screens.length === 0) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const columns = Math.min(screens.length, 3);
    const rows = Math.ceil(screens.length / columns);
    const scale = zoomRef.current / 100;
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
  }, [screens.length]);

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
      duplicateCleanup.current?.();
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
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

  const getCurrentDraftEntries = useCallback(
    () =>
      draftPrimitivesRef.current.map((draft) => ({
        id: draft.id,
        geometry: draft.geometry,
      })),
    [],
  );

  const getCurrentCanvasEntries = useCallback(
    () => [...getCurrentFrameEntries(), ...getCurrentDraftEntries()],
    [getCurrentDraftEntries, getCurrentFrameEntries],
  );

  const getFrameEntryAtPoint = useCallback(
    (point: Point) =>
      getCurrentFrameEntries()
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) =>
          rectContainsPoint(
            {
              left: entry.geometry.x,
              top: entry.geometry.y,
              right: entry.geometry.x + entry.geometry.width,
              bottom: entry.geometry.y + entry.geometry.height,
            },
            point,
          ),
        )
        .sort(
          (a, b) =>
            (b.geometry.z ?? 0) - (a.geometry.z ?? 0) || b.index - a.index,
        )[0],
    [getCurrentFrameEntries],
  );

  const getFrameAtClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      const point = canvasPointFromClient(clientX, clientY);
      return getFrameEntryAtPoint(point)?.id;
    },
    [canvasPointFromClient, getFrameEntryAtPoint],
  );

  const deleteSelectedItems = useCallback(() => {
    const frameIds = selectedIdsRef.current.filter(
      (id) => frameGeometryRef.current[id],
    );
    const draftIds = selectedDraftIdsRef.current.filter((id) =>
      draftPrimitivesRef.current.some((draft) => draft.id === id),
    );
    if (frameIds.length === 0 && draftIds.length === 0) return false;

    if (draftIds.length > 0) {
      updateDraftPrimitives((current) =>
        current.filter((draft) => !draftIds.includes(draft.id)),
      );
      updateSelectedDraftIds((current) =>
        current.filter((id) => !draftIds.includes(id)),
      );
    }

    if (frameIds.length > 0) {
      const accepted = onDeleteSelection?.(frameIds);
      if (accepted !== false && onDeleteSelection) {
        const before = cloneFrameGeometryById(frameGeometryRef.current);
        const after = cloneFrameGeometryById(before);
        frameIds.forEach((id) => {
          delete after[id];
        });
        updateFrameGeometry(() => after);
        onGeometryCommitRef.current?.(before, after);
        updateSelectedIds((current) =>
          current.filter((id) => !frameIds.includes(id)),
        );
      }
    }

    setMarquee(null);
    setAlignmentGuides([]);
    setTransformBadge(null);
    return true;
  }, [
    onDeleteSelection,
    updateDraftPrimitives,
    updateFrameGeometry,
    updateSelectedDraftIds,
    updateSelectedIds,
  ]);

  const installDragListeners = useCallback(
    (
      handleMouseMove: (ev: MouseEvent) => void,
      handleMouseUp: (ev: MouseEvent) => void,
    ) => {
      dragCleanup.current?.();
      let lastMouseEvent: MouseEvent | null = null;
      const move = (ev: MouseEvent) => {
        lastMouseEvent = ev;
        ev.preventDefault();
        handleMouseMove(ev);
      };
      const up = (ev: MouseEvent) => {
        lastMouseEvent = ev;
        ev.preventDefault();
        handleMouseUp(ev);
      };
      const cleanupOnBlur = () =>
        handleMouseUp(lastMouseEvent ?? new MouseEvent("mouseup"));
      dragCleanup.current = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("blur", cleanupOnBlur);
        dragCleanup.current = null;
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      window.addEventListener("blur", cleanupOnBlur);
    },
    [],
  );

  const scheduleFeedbackClear = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setAlignmentGuides([]);
      setTransformBadge(null);
      feedbackTimerRef.current = null;
    }, 650);
  }, []);

  const showTransformFeedback = useCallback(
    (text: string, clientX: number, clientY: number) => {
      setTransformBadge({
        text,
        x: clientX + 12,
        y: clientY + 12,
      });
    },
    [],
  );

  const finishDrag = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    dragState.current = null;
    setIsDragging(false);
    setIsPanning(false);
    setMarquee(null);
    setCreationPreview(null);
    setAlignmentGuides([]);
    setTransformBadge(null);
    setDragCursor(null);
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
        baseSelectedDraftIds: selectedDraftIdsRef.current,
        additive: e.shiftKey,
        hasMoved: false,
      };
      setMarquee({ ...originCanvas, width: 0, height: 0 });
      if (!e.shiftKey) {
        updateSelectedIds(() => []);
        updateSelectedDraftIds(() => []);
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
        const hitDraftIds = getCurrentDraftEntries()
          .filter((entry) =>
            rectIntersects(rect, getSelectableBounds(entry.geometry)),
          )
          .map((entry) => entry.id);
        updateSelectedIds(() =>
          state.additive
            ? dedupeIds([...state.baseSelectedIds, ...hitIds])
            : hitIds,
        );
        updateSelectedDraftIds(() =>
          state.additive
            ? dedupeIds([...state.baseSelectedDraftIds, ...hitDraftIds])
            : hitDraftIds,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "marquee" && !state.hasMoved && !state.additive) {
          updateSelectedIds(() => []);
          updateSelectedDraftIds(() => []);
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCanvasPoint,
      getCurrentDraftEntries,
      getCurrentFrameEntries,
      installDragListeners,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const getTargetFrameForDraft = useCallback(
    (draft: DraftPrimitive, preferredFrameId?: string) => {
      const entries = getCurrentFrameEntries();
      const preferred = preferredFrameId
        ? entries.find((entry) => entry.id === preferredFrameId)
        : undefined;
      if (preferred) return preferred;

      return entries
        .filter(({ geometry }) =>
          rectContainsPoint(
            {
              left: geometry.x,
              top: geometry.y,
              right: geometry.x + geometry.width,
              bottom: geometry.y + geometry.height,
            },
            getFrameCenter(draft.geometry),
          ),
        )
        .sort((a, b) => (b.geometry.z ?? 0) - (a.geometry.z ?? 0))[0];
    },
    [getCurrentFrameEntries],
  );

  const persistDraftPrimitive = useCallback(
    (
      draft: DraftPrimitive,
      preferredFrameId?: string,
    ): PersistedDraftPrimitive | null => {
      const targetFrame = getTargetFrameForDraft(draft, preferredFrameId);
      if (!targetFrame || !onCreatePrimitive) return null;
      const targetScreen = screens.find(
        (screen) => screen.id === targetFrame.id,
      );
      const targetMetadata = targetScreen
        ? resolveScreenMetadata(
            targetScreen,
            metadataById?.[targetScreen.id],
            getScreenMetadata?.(targetScreen),
          )
        : undefined;

      const localPrimitive = draftPrimitiveToInsert(
        draft,
        targetFrame.geometry,
        targetMetadata,
      );
      const persisted = onCreatePrimitive(targetFrame.id, localPrimitive);
      if (!persisted) return null;
      return {
        frameId: targetFrame.id,
        nodeId:
          (typeof persisted === "string" ? persisted : localPrimitive.nodeId) ??
          draft.id,
      };
    },
    [
      getScreenMetadata,
      getTargetFrameForDraft,
      metadataById,
      onCreatePrimitive,
      screens,
    ],
  );

  const commitDraftPrimitive = useCallback(
    (nextDraft: DraftPrimitive, preferredFrameId?: string) => {
      const persisted = persistDraftPrimitive(nextDraft, preferredFrameId);
      if (persisted) {
        updateDraftPrimitives((current) =>
          current.filter((draft) => draft.id !== nextDraft.id),
        );
        updateSelectedDraftIds(() => []);
        updateSelectedIds(() => [persisted.nodeId]);
        return;
      }

      updateDraftPrimitives((current) => [...current, nextDraft]);
      updateSelectedIds(() => []);
      updateSelectedDraftIds(() => [nextDraft.id]);
    },
    [
      persistDraftPrimitive,
      updateDraftPrimitives,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const clearActivePenPath = useCallback(() => {
    setActivePenPath(null);
    setPenGesturePreview(null);
    setPenPointer(null);
    setPenCloseHover(false);
  }, []);

  const finishPenPath = useCallback(
    (path = activePenPathRef.current) => {
      if (!path || path.nodes.length < 2) {
        clearActivePenPath();
        return;
      }

      commitDraftPrimitive(
        createPenDraftPrimitive(path, {
          stroke: toolProps?.stroke,
          strokeWidth: toolProps?.strokeWidth,
        }),
      );
      clearActivePenPath();
      onActiveToolChange?.("pen");
    },
    [clearActivePenPath, commitDraftPrimitive, onActiveToolChange, toolProps],
  );

  const getPenAnchorPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      shiftKey: boolean,
      path: PenPath | null,
    ) => {
      const rawPoint = getCanvasPoint(clientX, clientY);
      const lastAnchor = path?.nodes[path.nodes.length - 1]?.point;
      return shiftKey && lastAnchor
        ? constrainPointTo45Degrees(lastAnchor, rawPoint)
        : rawPoint;
    },
    [getCanvasPoint],
  );

  const updatePenPointer = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      const path = activePenPathRef.current;
      if (!path || path.closed) {
        setPenPointer(null);
        setPenCloseHover(false);
        return;
      }

      const rawPoint = getCanvasPoint(clientX, clientY);
      const closeHover = isPenCloseTarget(
        path,
        rawPoint,
        PEN_CLOSE_HIT_RADIUS_SCREEN_PX / (zoomRef.current / 100),
      );
      setPenCloseHover(closeHover);
      setPenPointer(
        closeHover
          ? path.nodes[0].point
          : getPenAnchorPoint(clientX, clientY, shiftKey, path),
      );
    },
    [getCanvasPoint, getPenAnchorPoint],
  );

  const beginPenNodeCreation = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextPick.current = true;

      const pathBefore = activePenPathRef.current?.closed
        ? null
        : activePenPathRef.current;
      const rawPoint = getCanvasPoint(e.clientX, e.clientY);
      if (
        pathBefore &&
        isPenCloseTarget(
          pathBefore,
          rawPoint,
          PEN_CLOSE_HIT_RADIUS_SCREEN_PX / (zoomRef.current / 100),
        )
      ) {
        finishPenPath(closePenPath(pathBefore));
        return;
      }

      const anchor = getPenAnchorPoint(
        e.clientX,
        e.clientY,
        e.shiftKey,
        pathBefore,
      );
      const pathSnapshot = pathBefore ? clonePenPath(pathBefore) : null;
      dragState.current = {
        type: "pen-node",
        originClient: { x: e.clientX, y: e.clientY },
        anchor,
        pathBefore: pathSnapshot,
        hasMoved: false,
      };
      setPenGesturePreview(
        appendPenNode(pathSnapshot, createCornerNode(anchor)),
      );
      setPenPointer(null);
      setPenCloseHover(false);
      setIsDragging(true);
      setDragCursor("crosshair");

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "pen-node") return;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }

        const handlePoint = getCanvasPoint(ev.clientX, ev.clientY);
        const node = state.hasMoved
          ? createSmoothNode(
              state.anchor,
              ev.shiftKey
                ? constrainPointTo45Degrees(state.anchor, handlePoint)
                : handlePoint,
            )
          : createCornerNode(state.anchor);
        setPenGesturePreview(appendPenNode(state.pathBefore, node));
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "pen-node") {
          finishDrag();
          return;
        }

        const handlePoint = getCanvasPoint(ev.clientX, ev.clientY);
        const node: PenNode = state.hasMoved
          ? createSmoothNode(
              state.anchor,
              ev.shiftKey
                ? constrainPointTo45Degrees(state.anchor, handlePoint)
                : handlePoint,
            )
          : createCornerNode(state.anchor);
        setActivePenPath(appendPenNode(state.pathBefore, node));
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
        onActiveToolChange?.("pen");
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      finishPenPath,
      getCanvasPoint,
      getPenAnchorPoint,
      installDragListeners,
      onActiveToolChange,
    ],
  );

  const beginDraftCreation = useCallback(
    (tool: DraftCreationTool, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const originCanvas = getCanvasPoint(e.clientX, e.clientY);
      const originFrameId = getFrameEntryAtPoint(originCanvas)?.id;
      const initialGeometry = getDraftGeometryForTool(
        tool,
        originCanvas,
        originCanvas,
      );
      const initialPoints =
        tool === "pen"
          ? [originCanvas]
          : tool === "line" || tool === "arrow"
            ? [
                originCanvas,
                { x: originCanvas.x + DRAFT_LINE_WIDTH, y: originCanvas.y },
              ]
            : undefined;
      dragState.current = {
        type: "draft-create",
        tool,
        originClient: { x: e.clientX, y: e.clientY },
        originCanvas,
        originFrameId,
        points: initialPoints ?? [],
        hasMoved: false,
      };
      setCreationPreview({
        tool,
        geometry: initialGeometry,
        points: initialPoints,
      });
      setIsDragging(true);
      setDragCursor(tool === "pen" ? "crosshair" : "crosshair");

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "draft-create") return;
        const nextCanvas = getCanvasPoint(ev.clientX, ev.clientY);
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }

        if (state.tool === "pen") {
          const minDistance =
            PEN_SAMPLE_DISTANCE_SCREEN_PX / (zoomRef.current / 100);
          state.points = appendPolylinePoint(
            state.points,
            nextCanvas,
            minDistance,
          );
          setCreationPreview({
            tool,
            geometry: getPathGeometry(state.points),
            points: state.points,
          });
          return;
        }

        setCreationPreview({
          tool,
          geometry: getDraftGeometryForTool(
            tool,
            state.originCanvas,
            nextCanvas,
          ),
          points:
            state.tool === "line" || state.tool === "arrow"
              ? [state.originCanvas, nextCanvas]
              : undefined,
        });
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "draft-create") {
          finishDrag();
          return;
        }

        let endCanvas = getCanvasPoint(ev.clientX, ev.clientY);
        const canvasMoved =
          Math.hypot(
            endCanvas.x - state.originCanvas.x,
            endCanvas.y - state.originCanvas.y,
          ) >= 0.5;
        const releaseMoved =
          state.hasMoved ||
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD ||
          canvasMoved;
        state.hasMoved = releaseMoved;
        let points = state.tool === "pen" ? state.points : undefined;
        if (state.tool === "pen") {
          points = appendPolylinePoint(state.points, endCanvas, 0);
          if (!releaseMoved || points.length < 2) {
            finishDrag();
            return;
          }
          endCanvas = points[points.length - 1] ?? endCanvas;
        }
        if (state.tool === "frame" && onCreateScreenFrame) {
          onCreateScreenFrame(
            getDraftGeometryForTool(state.tool, state.originCanvas, endCanvas),
          );
          if (activeTool === undefined) {
            setLocalActiveTool("move");
          }
          onActiveToolChange?.("move");
          finishDrag();
          return;
        }
        const nextDraft = createDraftPrimitive({
          tool: state.tool,
          start: state.originCanvas,
          end: endCanvas,
          points,
          moved: releaseMoved,
          toolProps,
          fallbackText: t("designEditor.tools.text"),
        });
        commitDraftPrimitive(nextDraft, state.originFrameId);
        if (activeTool === undefined) {
          setLocalActiveTool("move");
        }
        if (state.tool === "pen") {
          if (activeTool === undefined) {
            setLocalActiveTool("pen");
          }
          onActiveToolChange?.("pen");
        } else {
          onActiveToolChange?.("move");
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      activeTool,
      commitDraftPrimitive,
      finishDrag,
      getCanvasPoint,
      getFrameEntryAtPoint,
      installDragListeners,
      onActiveToolChange,
      onCreateScreenFrame,
      t,
      toolProps,
    ],
  );

  const beginDraftDrag = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button !== 0 || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();

      const currentSelectedDraftIds = selectedDraftIdsRef.current;
      const targetIds = currentSelectedDraftIds.includes(id)
        ? currentSelectedDraftIds
        : [id];
      const originDrafts = Object.fromEntries(
        draftPrimitivesRef.current
          .filter((draft) => targetIds.includes(draft.id))
          .map((draft) => [draft.id, cloneDraftPrimitive(draft)]),
      ) as DraftPrimitiveById;
      if (!originDrafts[id]) return;
      updateSelectedIds(() => []);
      updateSelectedDraftIds((current) =>
        current.includes(id) ? current : [id],
      );

      dragState.current = {
        type: "draft-move",
        originClient: { x: e.clientX, y: e.clientY },
        originDrafts,
        targetIds,
        primaryId: id,
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor("grabbing");

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "draft-move") return;
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

        const movingEntries = state.targetIds.map((targetId) => {
          const origin = state.originDrafts[targetId].geometry;
          return {
            id: targetId,
            geometry: {
              ...origin,
              x: origin.x + dx,
              y: origin.y + dy,
            },
          };
        });
        const stationaryEntries = getCurrentCanvasEntries().filter(
          (entry) => !state.targetIds.includes(entry.id),
        );
        const snap = computeMoveSnap(movingEntries, stationaryEntries, {
          thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
          zoom: zoomRef.current,
          bypass: ev.metaKey || ev.ctrlKey,
        });

        updateDraftPrimitives((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            if (!origin) return draft;
            return moveDraftPrimitive(origin, dx + snap.dx, dy + snap.dy);
          }),
        );
        setAlignmentGuides(snap.guides);
        const primary = state.originDrafts[state.primaryId].geometry;
        showTransformFeedback(
          `X ${Math.round(primary.x + dx + snap.dx)}  Y ${Math.round(
            primary.y + dy + snap.dy,
          )}`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "draft-move" && state.hasMoved) {
          const persisted: Array<{
            draftId: string;
            frameId: string;
            nodeId: string;
          }> = [];
          draftPrimitivesRef.current.forEach((draft) => {
            if (!state.targetIds.includes(draft.id)) return;
            const result = persistDraftPrimitive(draft);
            if (result) {
              persisted.push({
                draftId: draft.id,
                frameId: result.frameId,
                nodeId: result.nodeId,
              });
            }
          });

          if (persisted.length > 0) {
            const persistedDraftIds = new Set(
              persisted.map((entry) => entry.draftId),
            );
            updateDraftPrimitives((current) =>
              current.filter((draft) => !persistedDraftIds.has(draft.id)),
            );
            updateSelectedDraftIds((current) =>
              current.filter((draftId) => !persistedDraftIds.has(draftId)),
            );
            const lastNodeId = persisted[persisted.length - 1]?.nodeId;
            if (lastNodeId) updateSelectedIds(() => [lastNodeId]);
          } else {
            // No draft landed in a frame — restore each moved draft to its
            // original position so the move is atomic (commit or revert).
            updateDraftPrimitives((current) =>
              current.map((draft) => {
                if (!state.targetIds.includes(draft.id)) return draft;
                const origin = state.originDrafts[draft.id];
                return origin ?? draft;
              }),
            );
          }
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCurrentCanvasEntries,
      installDragListeners,
      persistDraftPrimitive,
      showTransformFeedback,
      updateDraftPrimitives,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const beginDraftResize = useCallback(
    (id: string, handle: ResizeHandle, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const currentSelectedDraftIds = selectedDraftIdsRef.current;
      const targetIds = currentSelectedDraftIds.includes(id)
        ? currentSelectedDraftIds
        : [id];
      const originDrafts = Object.fromEntries(
        draftPrimitivesRef.current
          .filter((draft) => targetIds.includes(draft.id))
          .map((draft) => [draft.id, cloneDraftPrimitive(draft)]),
      ) as DraftPrimitiveById;
      const originEntries = Object.values(originDrafts).map((draft) => ({
        id: draft.id,
        geometry: draft.geometry,
      }));
      const originBounds = getFrameGroupBounds(originEntries);
      if (!originBounds || !originDrafts[id]) return;
      updateSelectedIds(() => []);
      updateSelectedDraftIds((current) =>
        current.includes(id) ? current : [id],
      );

      dragState.current = {
        type: "draft-resize",
        originClient: { x: e.clientX, y: e.clientY },
        originDrafts,
        originBounds: frameBoundsToGeometry(originBounds),
        targetIds,
        handle,
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor(getResizeCursor(handle));

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "draft-resize") return;
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

        const originEntries = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: state.originDrafts[targetId].geometry,
        }));
        const resized = resizeFrameGroupFromDelta(
          originEntries,
          state.originBounds,
          state.handle,
          dx,
          dy,
          {
            preserveAspectRatio: ev.shiftKey,
            resizeFromCenter: ev.altKey,
            minWidth: 8,
            minHeight: 8,
          },
        );
        const snap = computeResizeSnap(
          resized.bounds,
          getCurrentCanvasEntries().filter(
            (entry) => !state.targetIds.includes(entry.id),
          ),
          state.handle,
          {
            thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
            zoom: zoomRef.current,
            bypass: ev.metaKey || ev.ctrlKey,
          },
        );
        const resizedEntries = resizeFrameGroupToBounds(
          originEntries,
          state.originBounds,
          snap.frame,
        );
        const resizedById = Object.fromEntries(
          resizedEntries.map((entry) => [entry.id, entry.geometry]),
        ) as FrameGeometryById;

        updateDraftPrimitives((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            const geometry = resizedById[draft.id];
            if (!origin || !geometry) return draft;
            return applyDraftGeometry(origin, geometry);
          }),
        );
        setAlignmentGuides(snap.guides);
        showTransformFeedback(
          `${Math.round(snap.frame.width)} x ${Math.round(snap.frame.height)}`,
          ev.clientX,
          ev.clientY,
        );
      };

      installDragListeners(handleMouseMove, finishDrag);
    },
    [
      finishDrag,
      getCurrentCanvasEntries,
      installDragListeners,
      showTransformFeedback,
      updateDraftPrimitives,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const beginDraftGroupResize = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent) => {
      const firstSelectedId = selectedDraftIdsRef.current[0];
      if (!firstSelectedId) return;
      beginDraftResize(firstSelectedId, handle, e);
    },
    [beginDraftResize],
  );

  const handleDraftClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      updateSelectedIds(() => []);
      updateSelectedDraftIds((current) => {
        if (e.shiftKey) {
          return current.includes(id)
            ? current.filter((selectedId) => selectedId !== id)
            : [...current, id];
        }
        return [id];
      });
    },
    [updateSelectedDraftIds, updateSelectedIds],
  );

  const beginFrameDrag = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.button !== 0 || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      // Frame mousedowns stop propagation, so they never reach handleMouseDown.
      // Clear stale suppression here too so a prior gesture can't swallow this
      // frame's selecting click. This gesture re-arms suppression on mouse-up
      // only if it actually moves.
      suppressNextPick.current = false;

      const currentSelectedIds = selectedIdsRef.current;
      const targetIds = currentSelectedIds.includes(id)
        ? currentSelectedIds
        : [id];
      if (!currentSelectedIds.includes(id)) {
        updateSelectedIds(() => [id]);
        onPick(id);
      }
      updateSelectedDraftIds(() => []);

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
      setDragCursor("grabbing");

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
          bypass: ev.metaKey || ev.ctrlKey,
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
        const primary = state.originFrames[state.primaryId];
        showTransformFeedback(
          `X ${Math.round(primary.x + dx + snap.dx)}  Y ${Math.round(
            primary.y + dy + snap.dy,
          )}`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "move" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          onGeometryCommitRef.current?.(
            frameGeometryWithOverrides(after, state.originFrames),
            after,
          );
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
      onPick,
      showTransformFeedback,
      updateFrameGeometry,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const beginResize = useCallback(
    (id: string, handle: ResizeHandle, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextPick.current = true;

      const currentSelectedIds = selectedIdsRef.current;
      const targetIds = currentSelectedIds.includes(id)
        ? currentSelectedIds
        : [id];
      const originEntries = getCurrentFrameEntries().filter((entry) =>
        targetIds.includes(entry.id),
      );
      const originBounds = getFrameGroupBounds(originEntries);
      if (!originBounds || originEntries.length === 0) return;
      updateSelectedIds((current) => (current.includes(id) ? current : [id]));

      dragState.current = {
        type: "resize",
        originClient: { x: e.clientX, y: e.clientY },
        originFrames: Object.fromEntries(
          originEntries.map((entry) => [entry.id, entry.geometry]),
        ) as FrameGeometryById,
        originBounds: frameBoundsToGeometry(originBounds),
        targetIds: originEntries.map((entry) => entry.id),
        handle,
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor(getResizeCursor(handle));

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

        const originEntries = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: state.originFrames[targetId],
        }));
        const resized = resizeFrameGroupFromDelta(
          originEntries,
          state.originBounds,
          state.handle,
          dx,
          dy,
          {
            preserveAspectRatio: ev.shiftKey,
            resizeFromCenter: ev.altKey,
            minWidth: 1,
            minHeight: 1,
          },
        );
        const snap = computeResizeSnap(
          resized.bounds,
          getCurrentFrameEntries().filter(
            (entry) => !state.targetIds.includes(entry.id),
          ),
          state.handle,
          {
            thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
            zoom: zoomRef.current,
            bypass: ev.metaKey || ev.ctrlKey,
          },
        );
        const resizedEntries = resizeFrameGroupToBounds(
          originEntries,
          state.originBounds,
          snap.frame,
        );
        updateFrameGeometry((current) => {
          const next = { ...current };
          resizedEntries.forEach((entry) => {
            next[entry.id] = {
              ...state.originFrames[entry.id],
              ...entry.geometry,
            };
          });
          return next;
        });
        setAlignmentGuides(snap.guides);
        showTransformFeedback(
          `${Math.round(snap.frame.width)} x ${Math.round(snap.frame.height)}`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "resize" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          onGeometryCommitRef.current?.(
            frameGeometryWithOverrides(after, state.originFrames),
            after,
          );
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCurrentFrameEntries,
      installDragListeners,
      showTransformFeedback,
      updateFrameGeometry,
      updateSelectedIds,
    ],
  );

  const beginGroupResize = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent) => {
      const firstSelectedId = selectedIdsRef.current[0];
      if (!firstSelectedId) return;
      beginResize(firstSelectedId, handle, e);
    },
    [beginResize],
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
      setDragCursor("grabbing");

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
        showTransformFeedback(
          `${Math.round(rotation)}deg`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "rotate" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          onGeometryCommitRef.current?.(
            frameGeometryWithOverrides(after, {
              [state.frameId]: state.originFrame,
            }),
            after,
          );
        }
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
      showTransformFeedback,
      updateFrameGeometry,
      updateSelectedIds,
    ],
  );

  const handleFrameClick = useCallback(
    (id: string, e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      if (suppressNextPick.current) {
        suppressNextPick.current = false;
        return;
      }

      if (e.shiftKey) {
        updateSelectedDraftIds(() => []);
        updateSelectedIds((current) =>
          current.includes(id)
            ? current.filter((selectedId) => selectedId !== id)
            : [...current, id],
        );
        return;
      }

      updateSelectedDraftIds(() => []);
      updateSelectedIds(() => [id]);
      onPick(id);
    },
    [onPick, updateSelectedDraftIds, updateSelectedIds],
  );

  const handleFrameDoubleClick = useCallback(
    (id: string, e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      updateSelectedDraftIds(() => []);
      updateSelectedIds(() => [id]);
      onPick(id);
      onEdit?.(id);
    },
    [onEdit, onPick, updateSelectedDraftIds, updateSelectedIds],
  );

  const beginDuplicateGesture = useCallback(
    (screen: ScreenFile, display: string, e: React.MouseEvent<HTMLElement>) => {
      if (e.button !== 0 || !e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      duplicateCleanup.current?.();

      const surfaceRect = surfaceRef.current?.getBoundingClientRect();
      const origin = { x: e.clientX, y: e.clientY };
      const originCanvas = canvasPointFromClient(e.clientX, e.clientY);
      const sourceFrame = getCurrentFrameEntries().find(
        (entry) => entry.id === screen.id,
      );
      const pointerOffset = sourceFrame
        ? {
            x: originCanvas.x - sourceFrame.geometry.x,
            y: originCanvas.y - sourceFrame.geometry.y,
          }
        : { x: 0, y: 0 };
      const previewPoint = {
        x: surfaceRect ? e.clientX - surfaceRect.left + 16 : e.clientX,
        y: surfaceRect ? e.clientY - surfaceRect.top + 16 : e.clientY,
      };

      const previewWidth = sourceFrame?.geometry.width ?? SCREEN_WIDTH;
      const previewHeight = sourceFrame?.geometry.height ?? SCREEN_HEIGHT;

      setDuplicatePreview({
        display,
        x: previewPoint.x,
        y: previewPoint.y,
        width: previewWidth,
        height: previewHeight,
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
          width: previewWidth,
          height: previewHeight,
          canDuplicate: !!onDuplicate,
          moved,
        });
      };

      const cleanupDuplicateGesture = () => {
        setDuplicatePreview(null);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        window.removeEventListener("blur", handleBlur);
        duplicateCleanup.current = null;
      };

      const handleBlur = () => {
        cleanupDuplicateGesture();
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const moved =
          Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) >=
          DUPLICATE_DRAG_THRESHOLD;
        const mode = moved ? "alt-drag" : "alt-click";

        if (onDuplicate) {
          const dropCanvasPosition = canvasPointFromClient(
            ev.clientX,
            ev.clientY,
          );
          const canvasPosition =
            moved || !sourceFrame
              ? {
                  x: dropCanvasPosition.x - pointerOffset.x,
                  y: dropCanvasPosition.y - pointerOffset.y,
                }
              : {
                  x: sourceFrame.geometry.x + SCREEN_GAP / 2,
                  y: sourceFrame.geometry.y + SCREEN_GAP / 2,
                };
          onDuplicate(screen.id, {
            mode,
            screen,
            canvasPosition,
            canvasOffset: pointerOffset,
            dropCanvasPosition,
          });
        } else if (!moved) {
          onPick(screen.id);
        }

        cleanupDuplicateGesture();
      };

      duplicateCleanup.current = cleanupDuplicateGesture;
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("blur", handleBlur);
    },
    [canvasPointFromClient, getCurrentFrameEntries, onDuplicate, onPick],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Clear any stale pick-suppression left over from a prior resize/rotate/move
      // gesture that never received its trailing frame click — otherwise it would
      // silently swallow this unrelated interaction.
      suppressNextPick.current = false;
      const target = e.target as HTMLElement;
      const onFrame = !!target.closest("[data-frame-shell]");
      const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
      if (e.button === 1) {
        beginPan(e);
        return;
      }
      if (e.button === 0 && tool === "hand") {
        beginPan(e);
        return;
      }
      if (e.button === 0 && tool === "pen") {
        beginPenNodeCreation(e);
        return;
      }
      const creationTool = getDraftCreationTool(tool);
      if (e.button === 0 && creationTool) {
        beginDraftCreation(creationTool, e);
        return;
      }
      if (e.button === 0 && !onFrame) {
        beginMarquee(e);
      }
    },
    [
      activeTool,
      beginDraftCreation,
      beginMarquee,
      beginPan,
      beginPenNodeCreation,
      localActiveTool,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
      if (tool !== "pen" || dragState.current?.type === "pen-node") return;
      updatePenPointer(e.clientX, e.clientY, e.shiftKey);
    },
    [activeTool, localActiveTool, updatePenPointer],
  );

  const handleWheelEvent = useCallback(
    (event: WheelEvent) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = getWheelDelta(event);

      if (event.ctrlKey || event.metaKey) {
        const currentZoom = zoomRef.current;
        const zoomDeltaY = clamp(
          delta.y,
          -MAX_WHEEL_ZOOM_DELTA,
          MAX_WHEEL_ZOOM_DELTA,
        );
        const nextZoom = clamp(
          currentZoom * Math.exp(-zoomDeltaY * ZOOM_SENSITIVITY),
          MIN_ZOOM,
          MAX_ZOOM,
        );
        if (nextZoom === currentZoom) return;

        const nextPan = getPanForZoomToCursor({
          pan: panRef.current,
          cursor: { x: event.clientX - rect.left, y: event.clientY - rect.top },
          oldZoom: currentZoom,
          nextZoom,
        });
        const zoomEditFrameId =
          zoomToEditThreshold !== undefined &&
          currentZoom < zoomToEditThreshold &&
          nextZoom >= zoomToEditThreshold
            ? getFrameAtClientPoint(event.clientX, event.clientY)
            : undefined;

        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        setCanvasZoom(nextZoom);
        setPan(nextPan);
        onZoomChange?.(nextZoom);
        if (zoomEditFrameId) {
          onZoomToEdit?.(zoomEditFrameId);
        }
        return;
      }

      const deltaX = clamp(
        event.shiftKey && delta.x === 0 ? delta.y : delta.x,
        -MAX_WHEEL_PAN_DELTA,
        MAX_WHEEL_PAN_DELTA,
      );
      const deltaY = clamp(
        event.shiftKey && delta.x === 0 ? 0 : delta.y,
        -MAX_WHEEL_PAN_DELTA,
        MAX_WHEEL_PAN_DELTA,
      );
      const nextPan = {
        x: panRef.current.x - deltaX,
        y: panRef.current.y - deltaY,
      };
      panRef.current = nextPan;
      setPan(nextPan);
    },
    [getFrameAtClientPoint, onZoomChange, onZoomToEdit, zoomToEditThreshold],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.addEventListener("wheel", handleWheelEvent, {
      capture: true,
      passive: false,
    });
    return () => {
      surface.removeEventListener("wheel", handleWheelEvent, {
        capture: true,
      });
    };
  }, [handleWheelEvent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activePenPathRef.current) return;
      if (!isArrowNudgeKey(event.key) || isEditableHotkeyTarget(event.target)) {
        return;
      }

      const targetIds = selectedIdsRef.current.filter(
        (id) => frameGeometryRef.current[id],
      );
      const targetDraftIds = selectedDraftIdsRef.current.filter((id) =>
        draftPrimitivesRef.current.some((draft) => draft.id === id),
      );
      if (targetIds.length === 0 && targetDraftIds.length === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const nudge = getNudgeDelta(event.key, {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
      const movingFrameEntries = targetIds.map((targetId) => {
        const origin = frameGeometryRef.current[targetId];
        return {
          id: targetId,
          geometry: {
            ...origin,
            x: origin.x + nudge.dx,
            y: origin.y + nudge.dy,
          },
        };
      });
      const movingDraftEntries = targetDraftIds
        .map((targetId) =>
          draftPrimitivesRef.current.find((draft) => draft.id === targetId),
        )
        .filter(isDraftPrimitive)
        .map((draft) => ({
          id: draft.id,
          geometry: {
            ...draft.geometry,
            x: draft.geometry.x + nudge.dx,
            y: draft.geometry.y + nudge.dy,
          },
        }));
      const movingEntries = [...movingFrameEntries, ...movingDraftEntries];
      const movingIds = [...targetIds, ...targetDraftIds];
      const stationaryEntries = getCurrentCanvasEntries().filter(
        (entry) => !movingIds.includes(entry.id),
      );
      const snap = computeMoveSnap(movingEntries, stationaryEntries, {
        thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
        zoom: zoomRef.current,
        bypass: nudge.snap.bypass,
      });

      if (targetIds.length > 0) {
        const before = cloneFrameGeometryById(frameGeometryRef.current);
        const next = { ...before };
        targetIds.forEach((targetId) => {
          const origin = before[targetId] ?? frameGeometryRef.current[targetId];
          next[targetId] = {
            ...origin,
            x: origin.x + nudge.dx + snap.dx,
            y: origin.y + nudge.dy + snap.dy,
          };
        });
        updateFrameGeometry(() => next);
        onGeometryCommitRef.current?.(before, cloneFrameGeometryById(next));
      }
      if (targetDraftIds.length > 0) {
        updateDraftPrimitives((current) =>
          current.map((draft) =>
            targetDraftIds.includes(draft.id)
              ? moveDraftPrimitive(
                  draft,
                  nudge.dx + snap.dx,
                  nudge.dy + snap.dy,
                )
              : draft,
          ),
        );
      }
      setAlignmentGuides(snap.guides);
      scheduleFeedbackClear();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    getCurrentCanvasEntries,
    scheduleFeedbackClear,
    updateDraftPrimitives,
    updateFrameGeometry,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activePenPathRef.current) return;
      if (
        (event.key !== "Delete" && event.key !== "Backspace") ||
        event.metaKey ||
        event.ctrlKey ||
        isEditableHotkeyTarget(event.target)
      ) {
        return;
      }
      if (!deleteSelectedItems()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [deleteSelectedItems]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const path = activePenPathRef.current;
      if (
        !path ||
        event.metaKey ||
        event.ctrlKey ||
        isEditableHotkeyTarget(event.target)
      ) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        finishPenPath(path);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        clearActivePenPath();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const remainingNodes = path.nodes.slice(0, -1);
        if (remainingNodes.length === 0) {
          clearActivePenPath();
          return;
        }
        setActivePenPath({ nodes: remainingNodes, closed: false });
        setPenPointer(null);
        setPenCloseHover(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [clearActivePenPath, finishPenPath]);

  useEffect(() => {
    const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
    if (tool !== "pen") clearActivePenPath();
  }, [activeTool, clearActivePenPath, localActiveTool]);

  const scale = canvasZoom / 100;
  const chromeScale = scale > 0 ? 1 / scale : 1;
  const showPixelGrid = canvasZoom >= PIXEL_GRID_ZOOM;
  const effectiveTool = normalizeCanvasTool(activeTool ?? localActiveTool);
  const penActive = effectiveTool === "pen";
  const creationToolActive = Boolean(getDraftCreationTool(effectiveTool));
  const displayedPenPath = penGesturePreview
    ? penGesturePreview
    : activePenPath && penPointer && activePenPath.nodes.length > 0
      ? penCloseHover
        ? closePenPath(activePenPath)
        : appendPenNode(activePenPath, createCornerNode(penPointer))
      : activePenPath;
  const selectedIdSet = new Set(selectedIds);
  const selectedDraftIdSet = new Set(selectedDraftIds);
  const surfaceCursor = isPanning
    ? "grabbing"
    : dragCursor
      ? dragCursor
      : isDragging && marquee
        ? "crosshair"
        : penActive || getDraftCreationTool(effectiveTool)
          ? "crosshair"
          : effectiveTool === "hand"
            ? "grab"
            : "default";
  const canvasFrames = screens.map((screen, index) => ({
    screen,
    geometry: frameGeometry[screen.id] ?? getInitialFrameGeometry(index),
  }));
  const selectedFrameEntries = canvasFrames
    .filter(({ screen }) => selectedIdSet.has(screen.id))
    .map(({ screen, geometry }) => ({ id: screen.id, geometry }));
  const selectedGroupBounds =
    selectedFrameEntries.length > 1
      ? getFrameGroupBounds(selectedFrameEntries)
      : null;
  const hasGroupSelection = !!selectedGroupBounds;
  const selectedDraftEntries = draftPrimitives
    .filter((draft) => selectedDraftIdSet.has(draft.id))
    .map((draft) => ({ id: draft.id, geometry: draft.geometry }));
  const selectedDraftGroupBounds =
    selectedDraftEntries.length > 1
      ? getFrameGroupBounds(selectedDraftEntries)
      : null;
  return (
    <div
      ref={surfaceRef}
      className="relative h-full w-full select-none overflow-hidden bg-background"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      style={{ cursor: surfaceCursor, touchAction: "none" }}
    >
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
              screenContent={renderScreenContent?.(screen, metadata, geometry)}
              isActive={screen.id === activeId}
              isSelected={selectedIdSet.has(screen.id)}
              groupSelected={hasGroupSelection}
              handlesEnabled={!hasGroupSelection}
              penActive={penActive}
              creationToolActive={creationToolActive}
              chromeScale={chromeScale}
              onPick={handleFrameClick}
              onEdit={handleFrameDoubleClick}
              onStartFrameDrag={beginFrameDrag}
              onStartResize={beginResize}
              onStartRotate={beginRotate}
              onStartDuplicateGesture={beginDuplicateGesture}
            />
          );
        })}

        {draftPrimitives.map((draft) => (
          <DraftPrimitiveLayer
            key={draft.id}
            draft={draft}
            isSelected={selectedDraftIdSet.has(draft.id)}
            groupSelected={Boolean(selectedDraftGroupBounds)}
            penActive={penActive}
            chromeScale={chromeScale}
            onClick={handleDraftClick}
            onStartDrag={beginDraftDrag}
            onStartResize={beginDraftResize}
          />
        ))}

        {creationPreview ? (
          <DraftPrimitiveLayer
            draft={previewDraftPrimitive(creationPreview)}
            isSelected
            preview
            groupSelected={false}
            penActive={penActive}
            chromeScale={chromeScale}
            onClick={() => {}}
            onStartDrag={() => {}}
            onStartResize={() => {}}
          />
        ) : null}

        {displayedPenPath ? (
          <PenPathOverlay path={displayedPenPath} closeHover={penCloseHover} />
        ) : null}

        {selectedGroupBounds ? (
          <GroupSelectionBox
            bounds={selectedGroupBounds}
            chromeScale={chromeScale}
            onStartResize={beginGroupResize}
          />
        ) : null}

        {selectedDraftGroupBounds ? (
          <GroupSelectionBox
            bounds={selectedDraftGroupBounds}
            chromeScale={chromeScale}
            onStartResize={beginDraftGroupResize}
          />
        ) : null}

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
            className="pointer-events-none absolute z-40 border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)]"
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
            width: duplicatePreview.width * Math.min(scale, 1),
            height: duplicatePreview.height * Math.min(scale, 1),
            maxWidth: duplicatePreview.width,
            maxHeight: duplicatePreview.height,
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

      {transformBadge ? (
        <div
          className="pointer-events-none absolute z-50 rounded border border-border bg-background/95 px-1.5 py-0.5 font-mono text-[11px] leading-5 text-foreground shadow-lg backdrop-blur"
          style={{ left: transformBadge.x, top: transformBadge.y }}
        >
          {transformBadge.text}
        </div>
      ) : null}
    </div>
  );
}

function DraftPrimitiveLayer({
  draft,
  isSelected,
  groupSelected,
  penActive,
  chromeScale,
  preview = false,
  onClick,
  onStartDrag,
  onStartResize,
}: {
  draft: DraftPrimitive;
  isSelected: boolean;
  groupSelected: boolean;
  penActive: boolean;
  chromeScale: number;
  preview?: boolean;
  onClick: (id: string, e: React.MouseEvent) => void;
  onStartDrag: (id: string, e: React.MouseEvent) => void;
  onStartResize: (
    id: string,
    handle: ResizeHandle,
    e: React.MouseEvent,
  ) => void;
}) {
  const { geometry } = draft;
  const selected = isSelected && !groupSelected;
  return (
    <button
      data-frame-shell
      type="button"
      className={cn(
        "group/artboard pointer-events-auto absolute block overflow-visible text-left outline-none",
        preview || penActive ? "cursor-crosshair" : "cursor-move",
      )}
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
        zIndex: geometry.z ?? 40,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
      }}
      onClick={(event) => {
        if (penActive) return;
        if (!preview) onClick(draft.id, event);
      }}
      onMouseDown={(event) => {
        if (penActive) return;
        if (!preview) onStartDrag(draft.id, event);
      }}
    >
      <DraftPrimitiveContent draft={draft} preview={preview} />
      <span
        className={cn(
          "pointer-events-none absolute rounded-sm border transition-opacity",
          selected
            ? "border-[var(--design-editor-accent-color)] opacity-100"
            : "border-[var(--design-editor-accent-color)] opacity-0 group-hover/artboard:opacity-100",
        )}
        style={{
          inset: -5 * chromeScale,
          borderWidth: 1.5 * chromeScale,
        }}
      />
      <ResizeHandles
        active={selected || preview}
        enabled={!penActive && ((isSelected && !groupSelected) || preview)}
        showRotate={false}
        chromeScale={chromeScale}
        onStartResize={(handle, event) =>
          onStartResize(draft.id, handle, event)
        }
        onStartRotate={() => {}}
      />
    </button>
  );
}

function DraftPrimitiveContent({
  draft,
  preview,
}: {
  draft: DraftPrimitive;
  preview: boolean;
}) {
  const muted = preview ? "opacity-70" : "";
  if (
    draft.kind === "path" ||
    draft.kind === "line" ||
    draft.kind === "arrow"
  ) {
    const markerId = `arrow-${draft.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const pathData =
      draft.pathData ??
      (draft.penPath
        ? serializePenPath(draft.penPath)
        : pointsToPath(draft.points ?? []));
    return (
      <svg
        className={cn("block size-full overflow-visible", muted)}
        viewBox={`${draft.geometry.x} ${draft.geometry.y} ${draft.geometry.width} ${draft.geometry.height}`}
      >
        {draft.kind === "arrow" ? (
          <defs>
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
        ) : null}
        <path
          d={pathData}
          fill="none"
          stroke={draft.stroke ?? "hsl(var(--primary))"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={draft.strokeWidth ?? 3}
          markerEnd={draft.kind === "arrow" ? `url(#${markerId})` : undefined}
        />
      </svg>
    );
  }

  if (draft.kind === "text") {
    return (
      <div
        className={cn(
          "flex size-full items-start rounded-sm border border-dashed border-primary/60 bg-primary/5 px-2 py-1 text-sm font-medium text-foreground",
          muted,
        )}
      >
        <span className="truncate">{draft.text}</span>
      </div>
    );
  }

  if (draft.kind === "frame") {
    return (
      <div
        className={cn(
          "size-full rounded-sm border-2 border-dashed border-primary/70 bg-primary/5",
          muted,
        )}
      />
    );
  }

  if (draft.kind === "ellipse") {
    return (
      <div
        className={cn("size-full rounded-full border", muted)}
        style={{
          background: draft.fill ?? "hsl(var(--primary) / 0.12)",
          borderColor: draft.stroke ?? "hsl(var(--primary) / 0.7)",
          borderWidth: draft.strokeWidth ?? 1,
        }}
      />
    );
  }

  if (draft.kind === "polygon" || draft.kind === "star") {
    return (
      <svg
        className={cn("block size-full overflow-visible", muted)}
        viewBox={`0 0 ${Math.max(1, draft.geometry.width)} ${Math.max(
          1,
          draft.geometry.height,
        )}`}
      >
        <polygon
          points={polygonPointsForBox(
            draft.kind,
            draft.geometry.width,
            draft.geometry.height,
          )}
          fill={draft.fill ?? "hsl(var(--primary) / 0.12)"}
          stroke={draft.stroke ?? "hsl(var(--primary))"}
          strokeLinejoin="round"
          strokeWidth={draft.strokeWidth ?? 1.5}
        />
      </svg>
    );
  }

  return (
    <div
      className={cn("size-full rounded-sm border", muted)}
      style={{
        background: draft.fill ?? "hsl(var(--primary) / 0.12)",
        borderColor: draft.stroke ?? "hsl(var(--primary) / 0.7)",
        borderWidth: draft.strokeWidth ?? 1,
      }}
    />
  );
}

function PenPathOverlay({
  path,
  closeHover,
}: {
  path: PenPath;
  closeHover: boolean;
}) {
  const geometry = getPenPathGeometry(path);
  const pathData = serializePenPath(path);
  return (
    <div
      data-pen-path-overlay
      className="pointer-events-none absolute z-[90]"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <svg
        className="absolute inset-0 size-full overflow-visible"
        viewBox={`${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`}
      >
        {path.nodes.map((node, index) => (
          <g key={`handles-${index}`}>
            {node.handleIn ? (
              <line
                x1={node.point.x}
                y1={node.point.y}
                x2={node.handleIn.x}
                y2={node.handleIn.y}
                stroke="var(--design-editor-accent-color)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            ) : null}
            {node.handleOut ? (
              <line
                x1={node.point.x}
                y1={node.point.y}
                x2={node.handleOut.x}
                y2={node.handleOut.y}
                stroke="var(--design-editor-accent-color)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            ) : null}
          </g>
        ))}
        <path
          d={pathData}
          fill="none"
          stroke="rgba(255,255,255,0.95)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={5}
        />
        <path
          d={pathData}
          fill="none"
          stroke="var(--design-editor-accent-color)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
      </svg>
      {path.nodes.map((node, index) => (
        <span
          key={`anchor-${index}`}
          data-pen-anchor
          className={cn(
            "absolute size-2 rounded-[2px] border shadow-sm",
            index === 0 && closeHover
              ? "scale-125 border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] ring-4 ring-[var(--design-editor-selection-color)]"
              : "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)]",
          )}
          style={{
            left: node.point.x - geometry.x - 4,
            top: node.point.y - geometry.y - 4,
          }}
        />
      ))}
      {path.nodes.flatMap((node, index) =>
        [node.handleIn, node.handleOut]
          .filter(isPoint)
          .map((handle, handleIndex) => (
            <span
              key={`handle-${index}-${handleIndex}`}
              data-pen-handle
              className="absolute size-1.5 rounded-full border border-[var(--design-editor-accent-color)] bg-background shadow-sm"
              style={{
                left: handle.x - geometry.x - 3,
                top: handle.y - geometry.y - 3,
              }}
            />
          )),
      )}
    </div>
  );
}

function isPoint(point: Point | undefined): point is Point {
  return !!point;
}

function Screen({
  screen,
  metadata,
  geometry,
  isActive,
  isSelected,
  groupSelected,
  handlesEnabled,
  penActive,
  creationToolActive,
  chromeScale,
  onPick,
  onEdit,
  onStartFrameDrag,
  onStartResize,
  onStartRotate,
  onStartDuplicateGesture,
  screenContent,
}: {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  geometry: FrameGeometry;
  isActive: boolean;
  isSelected: boolean;
  groupSelected: boolean;
  handlesEnabled: boolean;
  penActive: boolean;
  creationToolActive: boolean;
  chromeScale: number;
  screenContent?: ReactNode;
  onPick: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  onEdit: (id: string, e: React.MouseEvent<HTMLElement>) => void;
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
    e: React.MouseEvent<HTMLElement>,
  ) => void;
}) {
  const t = useT();
  const display = metadata.title ?? prettyScreenName(screen.filename);
  const previewUrl = metadata.previewUrl ?? getPreviewUrl(screen.content);
  const suppressNextClick = useRef(false);
  const emphasized = isActive || isSelected;
  const selectionOutlined = isSelected && !groupSelected;
  const showHoverOutline =
    !creationToolActive && (!isSelected || !groupSelected);

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
          if (penActive || creationToolActive) return;
          if (e.shiftKey) {
            e.stopPropagation();
            onPick(screen.id, e);
            return;
          }
          onStartFrameDrag(screen.id, e);
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              emphasized ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <span
            className={cn(
              "truncate text-[11px] font-medium",
              emphasized ? "text-foreground" : "text-muted-foreground",
            )}
            title={screen.filename}
          >
            {display}
          </span>
          <span className="hidden shrink-0 text-[10px] tabular-nums text-muted-foreground/70 sm:inline">
            {metadata.width} x {metadata.height}
          </span>
        </div>
        <button
          type="button"
          className={cn(
            "relative z-40 flex h-5 max-w-[46%] shrink-0 items-center gap-1 overflow-hidden rounded-md border border-border bg-background/95 px-1.5 text-[10px] font-medium text-foreground opacity-0 shadow-sm transition-opacity",
            "hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "group-hover/frame:opacity-100 group-focus-within/frame:opacity-100",
            emphasized && "opacity-100",
          )}
          aria-label={t("multiScreenCanvas.fullView")}
          title={t("multiScreenCanvas.fullView")}
          onClick={(event) => onEdit(screen.id, event)}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <IconMaximize className="size-3 shrink-0" />
          <span className="truncate">{t("multiScreenCanvas.fullView")}</span>
        </button>
      </div>
      <div
        data-screen-card
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (isInteractiveScreenContentTarget(e.target)) return;
          e.stopPropagation();
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            return;
          }
          if (e.detail > 1) return;
          onPick(screen.id, e);
        }}
        onDoubleClick={(e) => {
          if (isInteractiveScreenContentTarget(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          if (creationToolActive) return;
          if (isInteractiveScreenContentTarget(e.target)) return;
          if (e.detail > 1) {
            e.stopPropagation();
            return;
          }
          if (penActive) return;
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
          emphasized
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        style={{
          width: geometry.width,
          height: geometry.height,
          cursor:
            penActive || creationToolActive
              ? "crosshair"
              : isSelected
                ? "move"
                : "pointer",
          touchAction: "none",
        }}
      >
        <span
          className={cn(
            "pointer-events-none absolute border transition-opacity",
            selectionOutlined
              ? "border-[var(--design-editor-accent-color)] opacity-100"
              : showHoverOutline
                ? "border-[var(--design-editor-accent-color)] opacity-0 group-hover/artboard:opacity-100"
                : "border-transparent opacity-0",
          )}
          style={{
            inset: -5 * chromeScale,
            borderRadius: 13 * chromeScale,
            borderWidth: 1.5 * chromeScale,
          }}
        />
        <span
          className={cn(
            "relative block h-full w-full overflow-hidden rounded-lg border bg-white shadow-2xl transition-colors",
            "border-border group-hover/artboard:border-muted-foreground/60",
          )}
          style={{ pointerEvents: penActive ? "none" : undefined }}
        >
          {screenContent ?? (
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
          )}
          {creationToolActive ? (
            <span
              className="absolute inset-0 z-20 cursor-crosshair"
              aria-hidden="true"
            />
          ) : null}
          <span className="pointer-events-none absolute inset-0 rounded-[7px] border border-black/5" />
        </span>
        <ResizeHandles
          active={selectionOutlined}
          enabled={!penActive && !creationToolActive && handlesEnabled}
          showRotate
          chromeScale={chromeScale}
          onStartResize={(handle, e) => onStartResize(screen.id, handle, e)}
          onStartRotate={(e) => onStartRotate(screen.id, e)}
        />
      </div>
    </div>
  );
}

function GroupSelectionBox({
  bounds,
  chromeScale,
  onStartResize,
}: {
  bounds: NonNullable<ReturnType<typeof getFrameGroupBounds>>;
  chromeScale: number;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
}) {
  return (
    <div
      data-frame-shell
      className="pointer-events-none absolute z-30 border border-[var(--design-editor-accent-color)]"
      style={{
        left: SURFACE_PADDING + bounds.left,
        top: SURFACE_PADDING + bounds.top,
        width: bounds.width,
        height: bounds.height,
        borderRadius: 13 * chromeScale,
        borderWidth: 1.5 * chromeScale,
      }}
    >
      <ResizeHandles
        active
        enabled
        showRotate={false}
        chromeScale={chromeScale}
        onStartResize={onStartResize}
        onStartRotate={() => {}}
      />
    </div>
  );
}

function ResizeHandles({
  active,
  enabled,
  showRotate = true,
  chromeScale = 1,
  onStartResize,
  onStartRotate,
}: {
  active: boolean;
  enabled: boolean;
  showRotate?: boolean;
  chromeScale?: number;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate: (e: React.MouseEvent) => void;
}) {
  if (!enabled) return null;

  const visibleHandleClass = cn(
    "pointer-events-auto absolute z-20 rounded-[2px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)] shadow transition-opacity",
    active
      ? "opacity-100"
      : "opacity-0 group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100",
  );
  const edgeHandleClass =
    "pointer-events-auto absolute z-10 bg-transparent opacity-0";

  return (
    <>
      {EDGE_RESIZE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-resize-handle
          className={edgeHandleClass}
          style={edgeHandleStyle(config.handle, config.cursor, chromeScale)}
          onMouseDown={(e) => onStartResize(config.handle, e)}
        />
      ))}
      {CORNER_RESIZE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-resize-handle
          className={visibleHandleClass}
          style={cornerHandleStyle(config.handle, config.cursor, chromeScale)}
          onMouseDown={(e) => onStartResize(config.handle, e)}
        />
      ))}
      {showRotate
        ? ROTATE_HANDLE_CONFIGS.map((config) => (
            <span
              key={config.corner}
              data-rotate-handle
              className={cn(
                "pointer-events-auto absolute z-10 size-5 rounded-full transition-opacity active:cursor-grabbing",
                active
                  ? "opacity-100"
                  : "opacity-0 group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100",
              )}
              style={rotateHandleStyle(config.corner, chromeScale)}
              onMouseDown={onStartRotate}
            />
          ))
        : null}
    </>
  );
}

const CORNER_RESIZE_HANDLE_CONFIGS: Array<{
  handle: ResizeHandle;
  cursor: string;
}> = [
  { handle: "nw", cursor: "nwse-resize" },
  { handle: "ne", cursor: "nesw-resize" },
  { handle: "se", cursor: "nwse-resize" },
  { handle: "sw", cursor: "nesw-resize" },
];

const EDGE_RESIZE_HANDLE_CONFIGS: Array<{
  handle: ResizeHandle;
  cursor: string;
}> = [
  { handle: "n", cursor: "ns-resize" },
  { handle: "e", cursor: "ew-resize" },
  { handle: "s", cursor: "ns-resize" },
  { handle: "w", cursor: "ew-resize" },
];

const ALL_RESIZE_HANDLE_CONFIGS = [
  ...CORNER_RESIZE_HANDLE_CONFIGS,
  ...EDGE_RESIZE_HANDLE_CONFIGS,
];

const ROTATE_HANDLE_CONFIGS: Array<{
  corner: string;
}> = [{ corner: "nw" }, { corner: "ne" }, { corner: "se" }, { corner: "sw" }];

function edgeHandleStyle(
  handle: ResizeHandle,
  cursor: string,
  chromeScale: number,
): CSSProperties {
  const size = 14 * chromeScale;
  const offset = -size / 2;
  if (handle === "n" || handle === "s") {
    return {
      cursor,
      left: 0,
      right: 0,
      height: size,
      [handle === "n" ? "top" : "bottom"]: offset,
    };
  }
  return {
    cursor,
    top: 0,
    bottom: 0,
    width: size,
    [handle === "w" ? "left" : "right"]: offset,
  };
}

function cornerHandleStyle(
  handle: ResizeHandle,
  cursor: string,
  chromeScale: number,
): CSSProperties {
  const size = 10 * chromeScale;
  const offset = -size / 2;
  return {
    cursor,
    width: size,
    height: size,
    borderWidth: Math.max(1, 1.25 * chromeScale),
    ...(handle.includes("n") ? { top: offset } : { bottom: offset }),
    ...(handle.includes("w") ? { left: offset } : { right: offset }),
  };
}

function rotateHandleStyle(corner: string, chromeScale: number): CSSProperties {
  const size = 28 * chromeScale;
  const offset = -34 * chromeScale;
  return {
    cursor: "grab",
    width: size,
    height: size,
    ...(corner.includes("n") ? { top: offset } : { bottom: offset }),
    ...(corner.includes("w") ? { left: offset } : { right: offset }),
  };
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

function isArrowNudgeKey(key: string): key is ArrowNudgeKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowRight" ||
    key === "ArrowDown" ||
    key === "ArrowLeft"
  );
}

function isEditableHotkeyTarget(target: EventTarget | null) {
  if (!target || typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  const editable = target.closest(
    [
      "input",
      "textarea",
      "select",
      "[contenteditable]",
      '[role="textbox"]',
      '[data-hotkeys-scope="text"]',
    ].join(","),
  );
  if (!editable) return false;
  if (
    editable.getAttribute("role") === "textbox" ||
    editable.hasAttribute("data-hotkeys-scope")
  ) {
    return true;
  }
  if (editable instanceof HTMLElement && editable.isContentEditable) {
    return true;
  }
  const tagName = editable.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function isInteractiveScreenContentTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        ".design-canvas-iframe-wrapper,[data-design-preview-iframe]",
      ),
    )
  );
}

function frameBoundsToGeometry(bounds: {
  left: number;
  top: number;
  width: number;
  height: number;
}): FrameGeometry {
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
}

function getResizeCursor(handle: ResizeHandle) {
  return (
    ALL_RESIZE_HANDLE_CONFIGS.find((config) => config.handle === handle)
      ?.cursor ?? "default"
  );
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

function rectContainsPoint(bounds: BoundsRect, point: Point) {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function sameFrameGeometry(a: FrameGeometry, b: FrameGeometry) {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    (a.rotation ?? 0) === (b.rotation ?? 0) &&
    (a.z ?? 0) === (b.z ?? 0)
  );
}

function cloneFrameGeometryById(
  geometryById: FrameGeometryById,
): FrameGeometryById {
  return Object.fromEntries(
    Object.entries(geometryById).map(([id, geometry]) => [id, { ...geometry }]),
  );
}

function frameGeometryWithOverrides(
  base: FrameGeometryById,
  overrides: FrameGeometryById,
): FrameGeometryById {
  const next = cloneFrameGeometryById(base);
  Object.entries(overrides).forEach(([id, geometry]) => {
    next[id] = { ...geometry };
  });
  return next;
}

function isDraftPrimitive(
  value: DraftPrimitive | undefined,
): value is DraftPrimitive {
  return Boolean(value);
}

function getDraftGeometryForTool(
  tool: DraftCreationTool,
  start: Point,
  end: Point,
): FrameGeometry {
  if (tool === "pen" || tool === "line" || tool === "arrow") {
    return getPathGeometry([start, end]);
  }
  const options =
    tool === "frame"
      ? {
          minWidth: 24,
          minHeight: 24,
          defaultWidth: DRAFT_FRAME_WIDTH,
          defaultHeight: DRAFT_FRAME_HEIGHT,
        }
      : tool === "text"
        ? {
            minWidth: 24,
            minHeight: 18,
            defaultWidth: DRAFT_TEXT_WIDTH,
            defaultHeight: DRAFT_TEXT_HEIGHT,
          }
        : {
            minWidth: 8,
            minHeight: 8,
            defaultWidth: DRAFT_RECT_WIDTH,
            defaultHeight: DRAFT_RECT_HEIGHT,
          };
  return getDraftGeometryFromPoints(start, end, options);
}

function getPathGeometry(points: readonly Point[]): FrameGeometry {
  if (points.length === 0) {
    return {
      x: 0,
      y: 0,
      width: DRAFT_PATH_MIN_SIZE,
      height: DRAFT_PATH_MIN_SIZE,
    };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(DRAFT_PATH_MIN_SIZE, right - left),
    height: Math.max(DRAFT_PATH_MIN_SIZE, bottom - top),
  };
}

function createDraftPrimitive({
  tool,
  start,
  end,
  points,
  moved,
  toolProps,
  fallbackText,
}: DraftPrimitiveInput): DraftPrimitive {
  const id = createDraftId(tool);
  const geometry = moved
    ? getDraftGeometryForTool(tool, start, end)
    : getDraftGeometryForTool(tool, start, start);
  if (tool === "pen") {
    const pathPoints =
      points && points.length > 1
        ? points
        : [
            start,
            { x: start.x + 64, y: start.y + 24 },
            { x: start.x + 128, y: start.y },
          ];
    return createPenDraftPrimitive(
      {
        nodes: pathPoints.map(createCornerNode),
        closed: false,
      },
      {
        id,
        stroke: toolProps?.stroke,
        strokeWidth: toolProps?.strokeWidth,
      },
    );
  }
  if (tool === "text") {
    return {
      id,
      kind: "text",
      geometry,
      text: toolProps?.text ?? fallbackText,
      fill: toolProps?.fill,
      stroke: toolProps?.stroke,
      autoSize: !moved,
    };
  }
  if (tool === "line" || tool === "arrow") {
    const pathPoints = moved
      ? [start, end]
      : [start, { x: start.x + DRAFT_LINE_WIDTH, y: start.y }];
    return {
      id,
      kind: tool,
      geometry: getPathGeometry(pathPoints),
      points: pathPoints,
      stroke: toolProps?.stroke,
      strokeWidth: toolProps?.strokeWidth ?? 3,
    };
  }
  return {
    id,
    kind:
      tool === "frame"
        ? "frame"
        : tool === "ellipse" || tool === "polygon" || tool === "star"
          ? tool
          : "rectangle",
    geometry,
    fill: toolProps?.fill,
    stroke: toolProps?.stroke,
    strokeWidth: toolProps?.strokeWidth,
  };
}

function createPenDraftPrimitive(
  path: PenPath,
  {
    id = createDraftId("pen"),
    stroke,
    strokeWidth,
  }: { id?: string; stroke?: string; strokeWidth?: number } = {},
): DraftPrimitive {
  const penPath = clonePenPath(path);
  return {
    id,
    kind: "path",
    geometry: getPenPathGeometry(penPath),
    penPath,
    pathData: serializePenPath(penPath),
    stroke,
    strokeWidth: strokeWidth ?? 3,
  };
}

function createDraftId(tool: DraftCreationTool) {
  return `draft-${tool}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function cloneDraftPrimitive(draft: DraftPrimitive): DraftPrimitive {
  return {
    ...draft,
    geometry: { ...draft.geometry },
    points: draft.points?.map((point) => ({ ...point })),
    penPath: draft.penPath ? clonePenPath(draft.penPath) : undefined,
  };
}

function draftPrimitiveToInsert(
  draft: DraftPrimitive,
  frameGeometry: FrameGeometry,
  metadata?: ResolvedScreenMetadata,
): CanvasPrimitiveInsert {
  const scaleX =
    metadata && frameGeometry.width > 0
      ? metadata.width / frameGeometry.width
      : 1;
  const scaleY =
    metadata && frameGeometry.height > 0
      ? metadata.height / frameGeometry.height
      : 1;
  const toLocalPoint = (point: Point) => ({
    x: Math.round((point.x - frameGeometry.x) * scaleX),
    y: Math.round((point.y - frameGeometry.y) * scaleY),
  });
  const localGeometry = {
    ...draft.geometry,
    x: Math.round((draft.geometry.x - frameGeometry.x) * scaleX),
    y: Math.round((draft.geometry.y - frameGeometry.y) * scaleY),
    width: Math.max(1, Math.round(draft.geometry.width * scaleX)),
    height: Math.max(1, Math.round(draft.geometry.height * scaleY)),
  };
  const scaledPenPath = draft.penPath
    ? scalePenPathToGeometry(draft.penPath, frameGeometry, {
        x: 0,
        y: 0,
        width: metadata?.width ?? frameGeometry.width,
        height: metadata?.height ?? frameGeometry.height,
      })
    : undefined;
  return {
    kind: draft.kind,
    nodeId: draft.id,
    geometry: localGeometry,
    points: draft.points?.map(toLocalPoint),
    pathData: scaledPenPath ? serializePenPath(scaledPenPath) : undefined,
    text: draft.text,
    fill: draft.fill,
    stroke: draft.stroke,
    strokeWidth: draft.strokeWidth,
    autoSize: draft.autoSize,
  };
}

function moveDraftPrimitive(
  draft: DraftPrimitive,
  dx: number,
  dy: number,
): DraftPrimitive {
  const movedPenPath = draft.penPath
    ? translatePenPath(draft.penPath, dx, dy)
    : undefined;
  return {
    ...draft,
    geometry: {
      ...draft.geometry,
      x: draft.geometry.x + dx,
      y: draft.geometry.y + dy,
    },
    points: draft.points?.map((point) => ({
      x: point.x + dx,
      y: point.y + dy,
    })),
    penPath: movedPenPath,
    pathData: movedPenPath ? serializePenPath(movedPenPath) : draft.pathData,
  };
}

function applyDraftGeometry(
  draft: DraftPrimitive,
  geometry: FrameGeometry,
): DraftPrimitive {
  const origin = draft.geometry;
  const scaleX = geometry.width / Math.max(1, origin.width);
  const scaleY = geometry.height / Math.max(1, origin.height);
  const scaledPenPath = draft.penPath
    ? scalePenPathToGeometry(draft.penPath, origin, geometry)
    : undefined;
  return {
    ...draft,
    geometry,
    points: draft.points?.map((point) => ({
      x: geometry.x + (point.x - origin.x) * scaleX,
      y: geometry.y + (point.y - origin.y) * scaleY,
    })),
    penPath: scaledPenPath,
    pathData: scaledPenPath ? serializePenPath(scaledPenPath) : draft.pathData,
  };
}

function normalizeCanvasTool(
  tool: MultiScreenCanvasTool,
): MultiScreenCanvasTool {
  return tool === "rectangle" ? "rect" : tool;
}

function getDraftCreationTool(
  tool: MultiScreenCanvasTool,
): DraftCreationTool | null {
  if (
    tool === "frame" ||
    tool === "rect" ||
    tool === "line" ||
    tool === "arrow" ||
    tool === "ellipse" ||
    tool === "polygon" ||
    tool === "star" ||
    tool === "text" ||
    tool === "pen"
  ) {
    return tool;
  }
  return null;
}

function polygonPointsForBox(
  kind: "polygon" | "star",
  width: number,
  height: number,
) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const cx = safeWidth / 2;
  const cy = safeHeight / 2;
  const radius = Math.max(1, Math.min(safeWidth, safeHeight) / 2);
  const points: Point[] = [];

  if (kind === "polygon") {
    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / 3;
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }
  } else {
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const r = index % 2 === 0 ? radius : radius * 0.45;
      points.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      });
    }
  }

  return points
    .map((point) => `${roundCoord(point.x)},${roundCoord(point.y)}`)
    .join(" ");
}

function pointsToPath(points: readonly Point[]) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return [
    `M ${roundCoord(first.x)} ${roundCoord(first.y)}`,
    ...rest.map((point) => `L ${roundCoord(point.x)} ${roundCoord(point.y)}`),
  ].join(" ");
}

function roundCoord(value: number) {
  return Math.round(value * 10) / 10;
}

function previewDraftPrimitive(preview: DraftCreationPreview): DraftPrimitive {
  return {
    id: "draft-preview",
    kind:
      preview.tool === "pen"
        ? "path"
        : preview.tool === "frame"
          ? "frame"
          : preview.tool === "text"
            ? "text"
            : preview.tool === "line" ||
                preview.tool === "arrow" ||
                preview.tool === "ellipse" ||
                preview.tool === "polygon" ||
                preview.tool === "star"
              ? preview.tool
              : "rectangle",
    geometry: preview.geometry,
    points:
      preview.points ??
      (preview.tool === "line" || preview.tool === "arrow"
        ? [
            {
              x: preview.geometry.x,
              y: preview.geometry.y + preview.geometry.height / 2,
            },
            {
              x: preview.geometry.x + preview.geometry.width,
              y: preview.geometry.y + preview.geometry.height / 2,
            },
          ]
        : undefined),
    text: "Text", // i18n-ignore preview-only canvas placeholder
  };
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
