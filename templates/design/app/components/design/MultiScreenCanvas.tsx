import { useT } from "@agent-native/core/client";
import {
  DEFAULT_ASSIGNED_REGION_GAP,
  DEFAULT_ASSIGNED_REGION_HEIGHT,
  DEFAULT_ASSIGNED_REGION_MAX_COLUMNS,
  DEFAULT_ASSIGNED_REGION_WIDTH,
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
import { IconCopy, IconMaximize, IconPlus } from "@tabler/icons-react";
import {
  memo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";

import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

import { canvasPrimitiveReactStyle } from "./canvas-primitive-style";
import {
  DesignCanvas,
  LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT,
  appendHitTestResponder,
} from "./DesignCanvas";
import {
  DEVICE_FRAME_VIEWPORTS,
  type DeviceFrameType,
  type ElementInfo,
} from "./types";

// Re-export so consumers of MultiScreenCanvas can use the same script without
// importing DesignCanvas directly.
export { LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT };

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
  updatedAt?: string;
  width?: number;
  height?: number;
  url?: string;
  previewUrl?: string;
  /**
   * When set, renders multiple side-by-side breakpoint frames (mobile-first,
   * §6.4). Each entry is a pixel width; the active breakpoint determines the
   * edit scope (Tailwind prefix: base / md: / lg: / xl:).
   */
  breakpointWidths?: number[];
  /** Id of the currently active breakpoint frame for this screen. */
  activeBreakpointWidth?: number;
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
  selectedScreenIds?: string[];
  fullViewScreenIds?: string[];
  activeScreenHasHoveredChild?: boolean;
  hoveredChildScreenId?: string | null;
  directlyHoveredScreenId?: string | null;
  previewDeviceFrame?: DeviceFrameType;
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
  onPrimitiveCreated?: (screenId: string, nodeId: string) => void;
  onPrimitiveReparent?: (args: {
    sourceNodeId: string;
    sourceScreenId: string;
    targetNodeId: string;
    targetScreenId: string;
    placement: "inside";
  }) => void;
  onCreateScreenFrame?: (geometry: FrameGeometry) => void;
  onDeleteSelection?: (ids: string[]) => boolean | void;
  onZoomChange?: (zoom: number) => void;
  renderScreenContent?: (
    screen: ScreenFile,
    metadata: ResolvedScreenMetadata,
    geometry: FrameGeometry,
  ) => ReactNode;
  onScreenSelectionChange?: (ids: string[]) => void;
  selectAllRequest?: number;
  clearSelectionRequest?: number;
  /**
   * Called when the user clicks the + affordance on a screen's breakpoint
   * row to add the next standard breakpoint width (390 / 768 / 1280).
   */
  onAddBreakpoint?: (screenId: string, widthPx: number) => void;
  /**
   * Called when the user clicks a breakpoint frame header to make it the
   * active edit scope.
   */
  onActiveBreakpointChange?: (
    screenId: string,
    widthPx: number | undefined,
  ) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
  /**
   * Called when the user drags an element out of the active screen's iframe
   * and drops it onto a different screen.  The bridge in the source iframe
   * posts { type:"agent-native:cross-screen-drag" } messages; the host
   * translates them to board coords, finds the target frame, runs a hit-test
   * in the target iframe (50ms timeout), and calls this prop with the resolved
   * ids and anchor placement.
   */
  onCrossScreenElementDrop?: (args: {
    sourceSelector: string;
    sourceNodeId?: string;
    sourceScreenId: string;
    targetScreenId: string;
    /** data-agent-native-node-id of the deepest container at the drop point
     *  inside the target screen iframe (undefined when hit-test timed out). */
    targetAnchorNodeId?: string;
    /** DOM insertion placement relative to the anchor node. */
    targetAnchorPlacement?: "before" | "after" | "inside";
  }) => void;
  // ── Board file (new model) ───────────────────────────────────────────────
  /**
   * The id of the reserved "__board__.html" design file.
   * When provided, a full-surface board <DesignCanvas> is rendered below
   * the screen iframes so board elements are editable through the bridge.
   */
  boardFileId?: string;
  /**
   * The current HTML content of the board file.
   * Passed as `content` to the board <DesignCanvas> instance.
   */
  boardFileContent?: string;
  /**
   * The logical geometry of the board iframe in canvas coordinates.
   * Should be { x:0, y:0, width:totalSurfaceWidth, height:totalSurfaceHeight }.
   * Used to translate cross-screen-drag coords when the source is the board.
   */
  boardFrameGeometry?: FrameGeometry;
  /**
   * Called when a draft primitive is committed outside all screen frames
   * (and there is more than one screen).  The caller should append the
   * primitive into the board file's HTML content.
   *
   * Replaces the legacy onCreateBoardObject.
   */
  onBoardDrawPrimitive?: (primitive: CanvasPrimitiveInsert) => boolean | string;
  // ── Board edit callbacks (active-target model) ───────────────────────────
  /**
   * When true the board <DesignCanvas> is in edit mode.
   * Pass `canEditDesign` from DesignEditor. Defaults to false.
   */
  boardEditMode?: boolean;
  /**
   * Called when the user selects an element on the board surface.
   * DesignEditor should set boardFileId as the active file and push the
   * selection to the inspector.
   */
  onBoardElementSelect?: (info: ElementInfo) => void;
  /**
   * Called when the user hovers an element on the board surface.
   */
  onBoardElementHover?: (info: ElementInfo | null) => void;
  /**
   * Called when a drag / reorder / reparent / drop-into-container or delete
   * occurs on a board element.  Target file is boardFileId.
   */
  onBoardVisualStructureChange?: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      requestId?: string;
    },
  ) => boolean | void;
  /**
   * Called when a style property changes on a board element.
   * Target file is boardFileId.
   */
  onBoardVisualStyleChange?: (
    selector: string,
    styles: Record<string, string>,
    info?: ElementInfo,
  ) => void;
  /**
   * Called when an alt-drag clone is created on the board surface.
   * Target file is boardFileId.
   */
  onBoardVisualDuplicateChange?: (
    selector: string,
    cloneHtml: string,
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSelector?: string;
      anchorSourceId?: string;
      placement?: "before" | "after" | "inside";
    },
  ) => boolean | void;
  /**
   * Called when inline text is edited on a board element.
   * Target file is boardFileId.
   */
  onBoardTextContentChange?: (
    selector: string,
    value: string,
    info?: ElementInfo,
    details?: { html?: string },
  ) => void;
}

/**
 * design-editor overview canvas. Renders every file in the design as a movable,
 * resizable frame inside an infinite, pannable surface.
 */
export const OVERVIEW_FRAME_WIDTH = 320;
const SCREEN_WIDTH = OVERVIEW_FRAME_WIDTH;
const SCREEN_HEIGHT = 640;
const SCREEN_CARD_HEIGHT = SCREEN_HEIGHT + 26;
const SCREEN_GAP = 56;
export const SURFACE_PADDING = 240;
const DUPLICATE_DRAG_THRESHOLD = 6;
const DRAG_THRESHOLD = 3;
const FRAME_LABEL_HEIGHT = 28;
const FRAME_HEADER_BUTTON_OUTSIDE_WIDTH = 260;
const FRAME_HEADER_BUTTON_RESERVE = 116;
const FRAME_HEADER_DIMENSIONS_WIDTH = 72;
const FRAME_HEADER_TITLE_CHAR_WIDTH = 6.5;
const FRAME_HEADER_MIN_TITLE_WIDTH = 28;
const FRAME_HEADER_MAX_TITLE_WIDTH = 180;
const TRANSFORM_BADGE_OFFSET = 12;
const TRANSFORM_BADGE_EDGE_PADDING = 8;
const TRANSFORM_BADGE_HEIGHT = 28;
const TRANSFORM_BADGE_MIN_WIDTH = 64;
const TRANSFORM_BADGE_MAX_WIDTH = 180;
const MIN_ZOOM = 2;
const MAX_ZOOM = 800;
const ZOOM_SENSITIVITY = 0.01;
const MAX_WHEEL_ZOOM_DELTA = 120;
const MAX_WHEEL_PAN_DELTA = 140;
const PIXEL_GRID_ZOOM = 800;
// During a zoom gesture the constant-size selection chrome is frozen (we don't
// re-render); on commit it recomputes to its fixed screen size. These transitions
// are enabled only for that brief settle, so normal selection, resize, and
// screen-switch geometry stays pinned to the frame.
const CHROME_SETTLE_MS = 150;
const CHROME_OPACITY_TRANSITION = "opacity 150ms ease-out";
const CHROME_BORDER_SETTLE_TRANSITION = `inset ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const SELECTION_BOX_SETTLE_TRANSITION = `border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const CHROME_HANDLE_SETTLE_TRANSITION = `width ${CHROME_SETTLE_MS}ms ease-out, height ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, top ${CHROME_SETTLE_MS}ms ease-out, bottom ${CHROME_SETTLE_MS}ms ease-out, left ${CHROME_SETTLE_MS}ms ease-out, right ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
// Frame header (name + dimensions + "Full view" button) is counter-scaled via
// transform to stay a fixed screen size; ease that scale on zoom-settle. opacity
// is included so the button's hover-fade (transition-opacity) keeps working.
const CHROME_LABEL_SETTLE_TRANSITION = `transform ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;

export function getChromeBorderTransition(chromeSettling: boolean) {
  return chromeSettling
    ? CHROME_BORDER_SETTLE_TRANSITION
    : CHROME_OPACITY_TRANSITION;
}

export function getSelectionBoxTransition(chromeSettling: boolean) {
  return chromeSettling ? SELECTION_BOX_SETTLE_TRANSITION : "none";
}

export function isDirectScreenHoverTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
) {
  if (target === currentTarget) return true;
  const element =
    target && typeof (target as Element).closest === "function"
      ? (target as Element)
      : null;
  return !!element && !element.closest("[data-screen-content]");
}

function getChromeHandleTransition(chromeSettling: boolean) {
  return chromeSettling
    ? CHROME_HANDLE_SETTLE_TRANSITION
    : CHROME_OPACITY_TRANSITION;
}

function getChromeLabelTransition(chromeSettling: boolean) {
  return chromeSettling
    ? CHROME_LABEL_SETTLE_TRANSITION
    : CHROME_OPACITY_TRANSITION;
}
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

type PendingWheelGesture =
  | {
      mode: "zoom";
      deltaY: number;
      cursor: Point;
      clientX: number;
      clientY: number;
    }
  | {
      mode: "pan";
      deltaX: number;
      deltaY: number;
    };

export function MultiScreenCanvas({
  screens,
  zoom,
  activeId,
  selectedScreenIds,
  fullViewScreenIds,
  activeScreenHasHoveredChild = false,
  hoveredChildScreenId,
  directlyHoveredScreenId,
  previewDeviceFrame = "none",
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
  onPrimitiveCreated,
  onPrimitiveReparent,
  onCreateScreenFrame,
  onDeleteSelection,
  onZoomChange,
  renderScreenContent,
  onScreenSelectionChange,
  selectAllRequest,
  clearSelectionRequest,
  onAddBreakpoint,
  onActiveBreakpointChange,
  onSelectionChange,
  onCrossScreenElementDrop,
  boardFileId,
  boardFileContent,
  boardFrameGeometry,
  onBoardDrawPrimitive,
  boardEditMode = false,
  onBoardElementSelect,
  onBoardElementHover,
  onBoardVisualStructureChange,
  onBoardVisualStyleChange,
  onBoardVisualDuplicateChange,
  onBoardTextContentChange,
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
  const screensRef = useRef(screens);
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
    selectedScreenIds ?? [],
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
  const [primitiveDropTarget, setPrimitiveDropTarget] =
    useState<PrimitiveDropTarget | null>(null);
  const primitiveDropTargetRef = useRef<PrimitiveDropTarget | null>(null);
  const onPrimitiveReparentRef = useRef(onPrimitiveReparent);

  // Cross-screen element drag state — driven by postMessage from the source iframe.
  interface CrossScreenDragGhost {
    /** Board-space point where the ghost is shown (follows the cursor). */
    boardX: number;
    boardY: number;
  }
  interface CrossScreenDragTarget {
    /** The screen frame that is the candidate drop target. */
    id: string;
    geometry: FrameGeometry;
  }
  const [crossScreenGhost, setCrossScreenGhost] =
    useState<CrossScreenDragGhost | null>(null);
  const [crossScreenTarget, setCrossScreenTarget] =
    useState<CrossScreenDragTarget | null>(null);
  /** Ref kept in sync with state so the message handler can read without closures. */
  const crossScreenTargetRef = useRef<CrossScreenDragTarget | null>(null);
  /** The most-recent drag message payload — kept for use in the "end" handler. */
  const crossScreenDragMsgRef = useRef<{
    selector: string;
    sourceId?: string;
  } | null>(null);
  /** Board-space point from the last cross-screen-drag "move" message. */
  const crossScreenLastBoardPointRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  const onCrossScreenElementDropRef = useRef(onCrossScreenElementDrop);
  const onBoardDrawPrimitiveRef = useRef(onBoardDrawPrimitive);
  // Ref wrapper for finishDrag so callbacks declared before finishDrag can
  // reference it via the ref without hitting the const TDZ.
  const finishDragRef = useRef<() => void>(() => {});
  const suppressNextPick = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const pendingWheelGestureRef = useRef<PendingWheelGesture | null>(null);
  const wheelGestureFrameRef = useRef<number | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const pixelGridRef = useRef<HTMLDivElement>(null);
  const viewCommitTimerRef = useRef<number | null>(null);
  const pendingChromeSettleRef = useRef(false);
  const chromeSettleTimerRef = useRef<number | null>(null);
  const [chromeSettling, setChromeSettling] = useState(false);
  const previousPreviewDeviceFrameRef = useRef(previewDeviceFrame);

  const getResolvedMetadata = useCallback(
    (screen: ScreenFile) =>
      resolveScreenMetadata(
        screen,
        metadataById?.[screen.id],
        getScreenMetadata?.(screen),
        previewDeviceFrame,
      ),
    [getScreenMetadata, metadataById, previewDeviceFrame],
  );

  useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  useEffect(() => {
    onGeometryCommitRef.current = onGeometryCommit;
  }, [onGeometryCommit]);

  useEffect(() => {
    onPrimitiveReparentRef.current = onPrimitiveReparent;
  }, [onPrimitiveReparent]);

  useEffect(() => {
    onCrossScreenElementDropRef.current = onCrossScreenElementDrop;
  }, [onCrossScreenElementDrop]);

  useEffect(() => {
    onBoardDrawPrimitiveRef.current = onBoardDrawPrimitive;
  }, [onBoardDrawPrimitive]);

  useEffect(() => {
    screensRef.current = screens;
  }, [screens]);

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

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    onSelectionChangeRef.current?.(selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    onScreenSelectionChange?.(selectedIds);
  }, [onScreenSelectionChange, selectedIds]);

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
        const metadata = getResolvedMetadata(screen);
        const resolved = {
          ...getInitialFrameGeometry(index, metadata),
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
  }, [
    geometryById,
    getResolvedMetadata,
    screens,
    updateFrameGeometry,
    updateSelectedIds,
  ]);

  useEffect(() => {
    const previous = previousPreviewDeviceFrameRef.current;
    previousPreviewDeviceFrameRef.current = previewDeviceFrame;
    if (previous === previewDeviceFrame) return;

    updateFrameGeometry((current) => {
      const next = { ...current };
      let changed = false;

      screens.forEach((screen, index) => {
        const metadata = getResolvedMetadata(screen);
        const currentGeometry =
          current[screen.id] ?? getInitialFrameGeometry(index, metadata);
        const nextGeometry = getPreviewDeviceFrameGeometry({
          currentGeometry,
          metadata,
          previewDeviceFrame,
        });
        if (sameFrameGeometry(currentGeometry, nextGeometry)) return;
        next[screen.id] = nextGeometry;
        changed = true;
      });

      return changed ? next : current;
    });
  }, [getResolvedMetadata, previewDeviceFrame, screens, updateFrameGeometry]);

  useEffect(() => {
    if (!selectedScreenIds) return;
    updateSelectedIds(() => selectedScreenIds);
  }, [screens, selectedScreenIds, updateSelectedIds]);

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
    const scale = zoomRef.current / 100;
    const frames = screens.map((screen, index) => {
      const metadata = getResolvedMetadata(screen);
      const currentGeometry =
        frameGeometryRef.current[screen.id] ??
        getInitialFrameGeometry(index, metadata);
      return getPreviewDeviceFrameGeometry({
        currentGeometry,
        metadata,
        previewDeviceFrame,
      });
    });
    const bounds = getFrameGroupBounds(
      frames.map((geometry, index) => ({
        id: screens[index]?.id ?? String(index),
        geometry,
      })),
    );
    const totalWidth = bounds?.width ?? SCREEN_WIDTH;
    const totalHeight = bounds?.height ?? SCREEN_CARD_HEIGHT;
    const visualLeft = Math.max(24, (rect.width - totalWidth * scale) / 2);
    const visualTop = Math.max(24, (rect.height - totalHeight * scale) / 2);
    const nextPan = {
      x: visualLeft - SURFACE_PADDING * scale,
      y: visualTop - SURFACE_PADDING * scale,
    };
    panRef.current = nextPan;
    setPan(nextPan);
    // Only on mount, screen-count changes, or device-preview changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDeviceFrame, screens.length]);

  useEffect(() => {
    return () => {
      dragCleanup.current?.();
      duplicateCleanup.current?.();
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (wheelGestureFrameRef.current !== null) {
        window.cancelAnimationFrame(wheelGestureFrameRef.current);
      }
      if (viewCommitTimerRef.current !== null) {
        window.clearTimeout(viewCommitTimerRef.current);
      }
      if (chromeSettleTimerRef.current !== null) {
        window.clearTimeout(chromeSettleTimerRef.current);
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
    () =>
      screens.map((screen, index) => {
        const metadata = getResolvedMetadata(screen);
        return {
          id: screen.id,
          geometry:
            frameGeometryRef.current[screen.id] ??
            getInitialFrameGeometry(index, metadata),
        };
      }),
    [getResolvedMetadata, screens],
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
        .filter((entry) => {
          const bounds = {
            left: entry.geometry.x,
            top: entry.geometry.y,
            right: entry.geometry.x + entry.geometry.width,
            bottom: entry.geometry.y + entry.geometry.height,
          };
          const local = rotatePointAroundCenter(
            point,
            getFrameCenter(entry.geometry),
            entry.geometry.rotation ?? 0,
          );
          return rectContainsPoint(bounds, local);
        })
        .sort(
          (a, b) =>
            (b.geometry.z ?? 0) - (a.geometry.z ?? 0) || b.index - a.index,
        )[0],
    [getCurrentFrameEntries],
  );

  // ── Cross-screen element drag receiver ────────────────────────────────────
  // The source iframe (the active interactive screen) posts
  // { type: "agent-native:cross-screen-drag", phase, selector, sourceId,
  //   iframeX, iframeY, viewportW, viewportH }
  // during element drags that the bridge wants the host to handle.
  useEffect(() => {
    if (!onCrossScreenElementDrop) return;

    const clearCrossScreenDrag = () => {
      setCrossScreenGhost(null);
      setCrossScreenTarget(null);
      crossScreenTargetRef.current = null;
      crossScreenDragMsgRef.current = null;
    };

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "agent-native:cross-screen-drag") {
        return;
      }
      const msg = event.data as {
        type: string;
        phase: "move" | "end" | "cancel";
        selector?: string;
        sourceId?: string;
        iframeX?: number;
        iframeY?: number;
        viewportW?: number;
        viewportH?: number;
      };

      if (msg.phase === "cancel") {
        clearCrossScreenDrag();
        return;
      }

      // The drag originates from the active screen (only the active screen has
      // a live interactive iframe posting these messages).
      const sourceScreenId = activeId;
      if (!sourceScreenId) {
        // Always clear visual state (ghost + highlight) when we have no active
        // screen to attribute the drag to — regardless of the phase. Without
        // this, a "move" message arriving after activeId became null would leave
        // stale ghost/target state visible on the canvas.
        clearCrossScreenDrag();
        return;
      }

      if (msg.phase === "move") {
        const { iframeX, iframeY, viewportW, viewportH, selector, sourceId } =
          msg;
        if (
          iframeX === undefined ||
          iframeY === undefined ||
          viewportW === undefined ||
          viewportH === undefined
        ) {
          return;
        }

        // Remember the latest drag payload for use on "end".
        crossScreenDragMsgRef.current = {
          selector: selector ?? "",
          sourceId,
        };

        // Pointer is inside the source iframe — let the bridge handle it.
        if (
          iframeX >= 0 &&
          iframeY >= 0 &&
          iframeX <= viewportW &&
          iframeY <= viewportH
        ) {
          clearCrossScreenDrag();
          return;
        }

        // Translate iframe coords → board coords using source frame geometry.
        // Board math mirrors primitiveLocalToBoardRect:
        //   boardX = frame.x + iframeX * (frame.width / metadata.width)
        //   boardY = frame.y + iframeY * (frame.height / metadata.height)

        let boardX: number;
        let boardY: number;

        if (sourceScreenId === boardFileId && boardFrameGeometry) {
          // The board iframe is pixel-exact: 1 iframe pixel == 1 canvas unit.
          // iframeX/iframeY are already in canvas space (no scale needed).
          boardX = boardFrameGeometry.x + iframeX;
          boardY = boardFrameGeometry.y + iframeY;
        } else {
          const sourceScreen = screensRef.current.find(
            (s) => s.id === sourceScreenId,
          );
          const sourceGeometry = frameGeometryRef.current[sourceScreenId];
          if (!sourceScreen || !sourceGeometry) {
            clearCrossScreenDrag();
            return;
          }
          const sourceMetadata = getResolvedMetadata(sourceScreen);
          const scaleX =
            sourceGeometry.width / Math.max(1, sourceMetadata.width);
          const scaleY =
            sourceGeometry.height / Math.max(1, sourceMetadata.height);
          boardX = sourceGeometry.x + iframeX * scaleX;
          boardY = sourceGeometry.y + iframeY * scaleY;
        }
        const boardPoint = { x: boardX, y: boardY };

        // Remember the latest board-space position for use in the "end" handler.
        crossScreenLastBoardPointRef.current = boardPoint;

        setCrossScreenGhost({ boardX, boardY });

        // Find which screen frame the board point falls in.
        const target = getFrameEntryAtPoint(boardPoint);
        if (target && target.id !== sourceScreenId) {
          const nextTarget = { id: target.id, geometry: target.geometry };
          crossScreenTargetRef.current = nextTarget;
          setCrossScreenTarget(nextTarget);
        } else {
          crossScreenTargetRef.current = null;
          setCrossScreenTarget(null);
        }
        return;
      }

      if (msg.phase === "end") {
        const candidate = crossScreenTargetRef.current;
        // Use the saved payload from the last "move" as the primary source of
        // truth; fall back to the "end" message's own fields in case the ref
        // was cleared (e.g. a brief re-entry into the source iframe nulled it
        // via clearCrossScreenDrag while pointerOutsideIframe remained true).
        const payload = crossScreenDragMsgRef.current ?? {
          selector: msg.selector ?? "",
          sourceId: msg.sourceId,
        };
        const lastBoardPoint = crossScreenLastBoardPointRef.current;
        clearCrossScreenDrag();
        crossScreenLastBoardPointRef.current = null;
        // Guard: require at least one stable identifier (selector or sourceId)
        // so the drop handler in DesignEditor can resolve the node. An empty
        // selector AND a missing sourceId would produce nodeAttrId="" and
        // moveNodeBetweenDocuments would fail with a generic error toast.
        const hasIdentifier = !!(payload.selector || payload.sourceId);
        if (candidate && hasIdentifier && sourceScreenId) {
          // Translate the board-space drop point to the target iframe's local
          // coordinate space, then run a lightweight hit-test (postMessage +
          // 50 ms timeout) to find the deepest container at the drop site.
          const runHitTest = (): Promise<{
            anchorNodeId?: string;
            placement?: "before" | "after" | "inside";
          }> => {
            if (!lastBoardPoint) return Promise.resolve({});
            const targetScreen = screensRef.current.find(
              (s) => s.id === candidate.id,
            );
            if (!targetScreen) return Promise.resolve({});
            const targetGeometry = candidate.geometry;
            const targetMetadata = getResolvedMetadata(targetScreen);
            // Board → target iframe local coords
            const scaleX =
              targetMetadata.width / Math.max(1, targetGeometry.width);
            const scaleY =
              targetMetadata.height / Math.max(1, targetGeometry.height);
            const localX = (lastBoardPoint.x - targetGeometry.x) * scaleX;
            const localY = (lastBoardPoint.y - targetGeometry.y) * scaleY;

            const targetIframe =
              surfaceRef.current?.querySelector<HTMLIFrameElement>(
                `[data-screen-iframe-id="${CSS.escape(candidate.id)}"]`,
              );
            const targetContentWindow = targetIframe?.contentWindow;
            if (!targetContentWindow) return Promise.resolve({});

            const correlationId = `hit-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`;

            return new Promise((resolve) => {
              const timer = window.setTimeout(() => {
                window.removeEventListener("message", hitListener);
                resolve({});
              }, 50);

              const hitListener = (ev: MessageEvent) => {
                if (
                  !ev.data ||
                  ev.data.type !== "agent-native:hit-test-result" ||
                  ev.data.correlationId !== correlationId
                )
                  return;
                window.clearTimeout(timer);
                window.removeEventListener("message", hitListener);
                resolve({
                  anchorNodeId: ev.data.anchorNodeId ?? undefined,
                  placement: ev.data.placement ?? undefined,
                });
              };
              window.addEventListener("message", hitListener);

              targetContentWindow.postMessage(
                {
                  type: "agent-native:hit-test",
                  correlationId,
                  x: localX,
                  y: localY,
                },
                "*",
              );
            });
          };

          void runHitTest().then(({ anchorNodeId, placement }) => {
            onCrossScreenElementDropRef.current?.({
              sourceSelector: payload.selector,
              sourceNodeId: payload.sourceId,
              sourceScreenId,
              targetScreenId: candidate.id,
              targetAnchorNodeId: anchorNodeId,
              targetAnchorPlacement: placement,
            });
          });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [
    activeId,
    boardFileId,
    boardFrameGeometry,
    getFrameEntryAtPoint,
    getResolvedMetadata,
    onCrossScreenElementDrop,
  ]);

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
      handleCancel?: () => void,
    ) => {
      dragCleanup.current?.();
      const restorePreviewPointerEvents = mutePreviewIframePointerEvents(
        surfaceRef.current,
      );
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
      const cleanupOnBlur = () => {
        if (handleCancel) {
          handleCancel();
          return;
        }
        handleMouseUp(lastMouseEvent ?? new MouseEvent("mouseup"));
      };
      dragCleanup.current = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("blur", cleanupOnBlur);
        restorePreviewPointerEvents();
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
      const estimatedWidth = Math.min(
        TRANSFORM_BADGE_MAX_WIDTH,
        Math.max(TRANSFORM_BADGE_MIN_WIDTH, text.length * 7 + 16),
      );
      const maxX = Math.max(
        TRANSFORM_BADGE_EDGE_PADDING,
        window.innerWidth - estimatedWidth - TRANSFORM_BADGE_EDGE_PADDING,
      );
      const maxY = Math.max(
        TRANSFORM_BADGE_EDGE_PADDING,
        window.innerHeight -
          TRANSFORM_BADGE_HEIGHT -
          TRANSFORM_BADGE_EDGE_PADDING,
      );
      const preferredX =
        clientX + TRANSFORM_BADGE_OFFSET + estimatedWidth <=
        window.innerWidth - TRANSFORM_BADGE_EDGE_PADDING
          ? clientX + TRANSFORM_BADGE_OFFSET
          : clientX - estimatedWidth - TRANSFORM_BADGE_OFFSET;
      const preferredY =
        clientY + TRANSFORM_BADGE_OFFSET + TRANSFORM_BADGE_HEIGHT <=
        window.innerHeight - TRANSFORM_BADGE_EDGE_PADDING
          ? clientY + TRANSFORM_BADGE_OFFSET
          : clientY - TRANSFORM_BADGE_HEIGHT - TRANSFORM_BADGE_OFFSET;
      setTransformBadge({
        text,
        x: clampNumber(preferredX, TRANSFORM_BADGE_EDGE_PADDING, maxX),
        y: clampNumber(preferredY, TRANSFORM_BADGE_EDGE_PADDING, maxY),
      });
    },
    [],
  );

  const updatePrimitiveDropTarget = useCallback(
    (target: PrimitiveDropTarget | null) => {
      primitiveDropTargetRef.current = target;
      setPrimitiveDropTarget(target);
    },
    [],
  );

  const findPrimitiveDropTarget = useCallback(
    (
      point: Point,
      draggedNodeId: string | null,
    ): PrimitiveDropTarget | null => {
      if (!onPrimitiveReparentRef.current) return null;
      return getPrimitiveDropTargetForPoint(
        point,
        draggedNodeId,
        screensRef.current,
        frameGeometryRef.current,
        getResolvedMetadata,
      );
    },
    [getResolvedMetadata],
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
    primitiveDropTargetRef.current = null;
    setPrimitiveDropTarget(null);
    dragCleanup.current?.();
  }, []);

  // Keep the finishDragRef in sync so board-object callbacks declared before
  // finishDrag can call it via the ref without a TDZ forward-reference issue.
  finishDragRef.current = finishDrag;

  const cancelActiveDrag = useCallback(() => {
    let cancelled = false;
    const state = dragState.current;

    if (state) {
      cancelled = true;
      if (state.type === "move" || state.type === "resize") {
        updateFrameGeometry((current) =>
          frameGeometryWithOverrides(current, state.originFrames),
        );
      } else if (state.type === "rotate") {
        updateFrameGeometry((current) => ({
          ...current,
          [state.frameId]: { ...state.originFrame },
        }));
      } else if (state.type === "draft-move" || state.type === "draft-resize") {
        updateDraftPrimitives((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            return origin ? cloneDraftPrimitive(origin) : draft;
          }),
        );
      } else if (state.type === "marquee") {
        updateSelectedIds(() => state.baseSelectedIds);
        updateSelectedDraftIds(() => state.baseSelectedDraftIds);
      } else if (state.type === "pen-node") {
        setActivePenPath(
          state.pathBefore ? clonePenPath(state.pathBefore) : null,
        );
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
      }
    }

    if (duplicateCleanup.current) {
      cancelled = true;
      duplicateCleanup.current();
    }

    if (cancelled || dragCleanup.current) {
      finishDrag();
      return true;
    }
    return false;
  }, [
    finishDrag,
    updateDraftPrimitives,
    updateFrameGeometry,
    updateSelectedDraftIds,
    updateSelectedIds,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!cancelActiveDrag()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [cancelActiveDrag]);

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
            rotatedRectIntersects(
              rect,
              getSelectableBounds(entry.geometry),
              getFrameCenter(entry.geometry),
              entry.geometry.rotation ?? 0,
            ),
          )
          .map((entry) => entry.id);
        const hitDraftIds = getCurrentDraftEntries()
          .filter((entry) =>
            rotatedRectIntersects(
              rect,
              getSelectableBounds(entry.geometry),
              getFrameCenter(entry.geometry),
              entry.geometry.rotation ?? 0,
            ),
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

      const draftCenter = getFrameCenter(draft.geometry);

      // Primary: find the frame whose bounds contain the draft's center point.
      const containing = entries
        .filter(({ geometry }) => {
          const bounds = {
            left: geometry.x,
            top: geometry.y,
            right: geometry.x + geometry.width,
            bottom: geometry.y + geometry.height,
          };
          const local = rotatePointAroundCenter(
            draftCenter,
            getFrameCenter(geometry),
            geometry.rotation ?? 0,
          );
          return rectContainsPoint(bounds, local);
        })
        .sort((a, b) => (b.geometry.z ?? 0) - (a.geometry.z ?? 0))[0];

      if (containing) return containing;

      // Fallback: if no frame contains the center (shape drawn outside all
      // frames), use the nearest frame so the shape still persists rather than
      // becoming a lost draft primitive.
      //
      // Exception: when there is MORE THAN ONE screen, a draft whose center
      // falls outside all frames becomes a board object (floating on the
      // infinite canvas surface), not a primitive inside any screen.  In that
      // case return undefined so the caller can route to onCreateBoardObject.
      // With a single screen there is no meaningful "outside", so we always
      // absorb the draft into the only available frame (existing behaviour).
      if (entries.length === 0) return undefined;
      if (entries.length === 1) return entries[0];
      // Multiple screens: draft drawn outside all frames → board object.
      return undefined;
    },
    [getCurrentFrameEntries],
  );

  const persistDraftPrimitive = useCallback(
    (
      draft: DraftPrimitive,
      preferredFrameId?: string,
    ): PersistedDraftPrimitive | null => {
      const targetFrame = getTargetFrameForDraft(draft, preferredFrameId);

      // When the draft center is outside ALL frames (and screens.length > 1),
      // getTargetFrameForDraft returns undefined.  Route to onBoardDrawPrimitive
      // so the board file captures the new element.
      if (!targetFrame) {
        const handler = onBoardDrawPrimitiveRef.current;
        if (handler) {
          // Convert the draft into a board-space CanvasPrimitiveInsert.
          // The board uses a 1:1 coordinate mapping (no frame scaling needed).
          const boardPrimitive = draftPrimitiveToInsert(draft, {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          });
          const persisted = handler(boardPrimitive);
          if (!persisted) return null;
          // Return a sentinel PersistedDraftPrimitive so the caller can remove
          // the draft. The sentinel frameId "__board__" is detected downstream.
          return {
            frameId: "__board__",
            nodeId:
              (typeof persisted === "string"
                ? persisted
                : boardPrimitive.nodeId) ?? draft.id,
          };
        }
        return null;
      }

      if (!onCreatePrimitive) {
        return null;
      }
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
      if (!persisted) {
        return null;
      }
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
        updateSelectedIds(() => []);
        if (persisted.frameId !== "__board__") {
          onPrimitiveCreated?.(persisted.frameId, persisted.nodeId);
        }
        return;
      }

      updateDraftPrimitives((current) => [...current, nextDraft]);
      updateSelectedIds(() => []);
      updateSelectedDraftIds(() => [nextDraft.id]);
    },
    [
      persistDraftPrimitive,
      onPrimitiveCreated,
      updateDraftPrimitives,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const retryPersistedDraftPrimitives = useCallback(() => {
    const drafts = draftPrimitivesRef.current;
    if (drafts.length === 0 || !onCreatePrimitive) return;

    const persistedByDraftId = new Map<string, PersistedDraftPrimitive>();
    drafts.forEach((draft) => {
      const persisted = persistDraftPrimitive(draft);
      if (persisted) persistedByDraftId.set(draft.id, persisted);
    });
    if (persistedByDraftId.size === 0) return;

    const selectedDraftIds = selectedDraftIdsRef.current;
    updateDraftPrimitives((current) =>
      current.filter((draft) => !persistedByDraftId.has(draft.id)),
    );
    updateSelectedDraftIds((current) =>
      current.filter((id) => !persistedByDraftId.has(id)),
    );
    updateSelectedIds(() => []);

    const selectedPersisted = selectedDraftIds
      .map((id) => persistedByDraftId.get(id))
      .filter((entry): entry is PersistedDraftPrimitive => Boolean(entry));
    const persistedEntries =
      selectedPersisted.length > 0
        ? selectedPersisted
        : Array.from(persistedByDraftId.values());
    const lastPersisted = persistedEntries[persistedEntries.length - 1];
    // Do not call onPrimitiveCreated for board objects (sentinel frameId).
    if (lastPersisted && lastPersisted.frameId !== "__board__") {
      onPrimitiveCreated?.(lastPersisted.frameId, lastPersisted.nodeId);
    }
  }, [
    onCreatePrimitive,
    onPrimitiveCreated,
    persistDraftPrimitive,
    updateDraftPrimitives,
    updateSelectedDraftIds,
    updateSelectedIds,
  ]);

  useEffect(() => {
    retryPersistedDraftPrimitives();
  }, [frameGeometry, retryPersistedDraftPrimitives, screens]);

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

      const cancelPenGesture = () => {
        const state = dragState.current;
        if (state?.type === "pen-node") {
          setActivePenPath(state.pathBefore);
        }
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp, cancelPenGesture);
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
      const initialGeometry = getDraftPreviewGeometryForTool(
        tool,
        originCanvas,
        originCanvas,
        false,
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
          geometry: getDraftPreviewGeometryForTool(
            tool,
            state.originCanvas,
            nextCanvas,
            state.hasMoved,
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

        // Primitive drop-into-container detection: check if the dragged draft
        // is hovering over a committed container primitive on any screen.
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const primitiveTarget = findPrimitiveDropTarget(canvasPoint, null);
        updatePrimitiveDropTarget(primitiveTarget);
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        const dropTarget = primitiveDropTargetRef.current;
        if (state?.type === "draft-move" && state.hasMoved) {
          if (dropTarget) {
            // Drop into a container primitive: persist the draft into the
            // target's screen, then call onPrimitiveReparent to nest it.
            const persisted: Array<{
              draftId: string;
              frameId: string;
              nodeId: string;
            }> = [];
            draftPrimitivesRef.current.forEach((draft) => {
              if (!state.targetIds.includes(draft.id)) return;
              // Persist into the target's screen (not just any containing frame)
              const result = persistDraftPrimitive(draft, dropTarget.screenId);
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
              // Reparent each persisted node into the container primitive.
              persisted.forEach((entry) => {
                onPrimitiveReparentRef.current?.({
                  sourceNodeId: entry.nodeId,
                  sourceScreenId: entry.frameId,
                  targetNodeId: dropTarget.nodeId,
                  targetScreenId: dropTarget.screenId,
                  placement: "inside",
                });
              });
              const lastNodeId = persisted[persisted.length - 1]?.nodeId;
              if (lastNodeId) updateSelectedIds(() => [lastNodeId]);
            }
          } else {
            // Normal drop: persist into whichever screen contains the draft.
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
            }
          }
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      findPrimitiveDropTarget,
      finishDrag,
      getCanvasPoint,
      getCurrentCanvasEntries,
      installDragListeners,
      persistDraftPrimitive,
      showTransformFeedback,
      updateDraftPrimitives,
      updatePrimitiveDropTarget,
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
      if (activeId !== id) {
        onPick(id);
      }
      if (!currentSelectedIds.includes(id)) {
        updateSelectedIds(() => [id]);
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

        // When all dragged ids are committed primitive nodeIds (not screen
        // frames), check for a container primitive drop target to highlight.
        const currentFrameIds = Object.keys(frameGeometryRef.current);
        const allCommitted = state.targetIds.every(
          (targetId) => !currentFrameIds.includes(targetId),
        );
        if (allCommitted) {
          const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
          updatePrimitiveDropTarget(
            findPrimitiveDropTarget(canvasPoint, state.primaryId),
          );
        }
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        const dropTarget = primitiveDropTargetRef.current;
        if (state?.type === "move" && state.hasMoved) {
          // If all dragged ids are committed primitive nodeIds (not screen
          // frames), attempt a primitive reparent on drop.
          const currentFrameIds = Object.keys(frameGeometryRef.current);
          const allCommitted = state.targetIds.every(
            (targetId) => !currentFrameIds.includes(targetId),
          );
          if (allCommitted && dropTarget) {
            const sourceScreenId = resolveNodeScreenId(
              state.primaryId,
              screensRef.current,
            );
            if (sourceScreenId) {
              onPrimitiveReparentRef.current?.({
                sourceNodeId: state.primaryId,
                sourceScreenId,
                targetNodeId: dropTarget.nodeId,
                targetScreenId: dropTarget.screenId,
                placement: "inside",
              });
              suppressNextPick.current = true;
              finishDrag();
              return;
            }
          }

          // Normal screen-frame geometry commit.
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
      activeId,
      findPrimitiveDropTarget,
      finishDrag,
      getCanvasPoint,
      getCurrentFrameEntries,
      installDragListeners,
      onPick,
      showTransformFeedback,
      updateFrameGeometry,
      updatePrimitiveDropTarget,
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

      if (activeId !== id) {
        onPick(id);
      }

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
      activeId,
      finishDrag,
      getCurrentFrameEntries,
      installDragListeners,
      onPick,
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

      if (activeId !== id) {
        onPick(id);
      }

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
      activeId,
      finishDrag,
      getCanvasPoint,
      getCurrentFrameEntries,
      installDragListeners,
      onPick,
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
        const currentSelectedIds = selectedIdsRef.current;
        const nextSelectedIds = currentSelectedIds.includes(id)
          ? currentSelectedIds.filter((selectedId) => selectedId !== id)
          : [...currentSelectedIds, id];
        updateSelectedIds(() => nextSelectedIds);
        const nextPrimaryId =
          nextSelectedIds.length === 0
            ? null
            : nextSelectedIds.includes(id)
              ? id
              : (nextSelectedIds[nextSelectedIds.length - 1] ?? null);
        if (nextPrimaryId && nextPrimaryId !== activeId) {
          onPick(nextPrimaryId);
        }
        return;
      }

      updateSelectedDraftIds(() => []);
      updateSelectedIds(() => [id]);
      onPick(id);
    },
    [activeId, onPick, updateSelectedDraftIds, updateSelectedIds],
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

  // Push the current pan/zoom straight to the DOM. A wheel/pinch gesture must
  // NEVER re-render React's canvas tree during the gesture: each render re-runs
  // renderScreenContent (which re-creates the active screen's live DesignCanvas
  // iframe) and, with React DevTools attached, serializes every render over the
  // extension bridge — that re-render storm is the real source of zoom jank, not
  // layout/paint. We mutate the transform directly here and reconcile React
  // state once, after the gesture settles, via scheduleViewCommit().
  const applyViewToDom = useCallback(() => {
    const nextScale = zoomRef.current / 100;
    const p = panRef.current;
    const world = worldRef.current;
    if (world) {
      // 2D translate (not translate3d) so the layer is not GPU-pinned to a
      // stale low-res raster — keeps zoomed-in content crisp.
      world.style.transform = `translate(${p.x}px, ${p.y}px) scale(${nextScale})`;
    }
    const grid = pixelGridRef.current;
    if (grid) {
      grid.style.backgroundPosition = `${p.x}px ${p.y}px`;
      grid.style.backgroundSize = `${nextScale}px ${nextScale}px`;
    }
  }, []);

  const startChromeSettle = useCallback(() => {
    if (chromeSettleTimerRef.current !== null) {
      window.clearTimeout(chromeSettleTimerRef.current);
    }
    setChromeSettling(true);
    chromeSettleTimerRef.current = window.setTimeout(() => {
      chromeSettleTimerRef.current = null;
      setChromeSettling(false);
    }, CHROME_SETTLE_MS);
  }, []);

  const commitView = useCallback(() => {
    viewCommitTimerRef.current = null;
    const shouldSettleChrome = pendingChromeSettleRef.current;
    pendingChromeSettleRef.current = false;
    if (shouldSettleChrome) startChromeSettle();
    setCanvasZoom(zoomRef.current);
    setPan(panRef.current);
    onZoomChange?.(zoomRef.current);
  }, [onZoomChange, startChromeSettle]);

  // Debounced: only commit to React state once the gesture has been idle for a
  // beat, so a continuous pinch produces zero re-renders until the user pauses.
  const scheduleViewCommit = useCallback(
    (options?: { settleChrome?: boolean }) => {
      if (options?.settleChrome) {
        pendingChromeSettleRef.current = true;
      }
      if (viewCommitTimerRef.current !== null) {
        window.clearTimeout(viewCommitTimerRef.current);
      }
      viewCommitTimerRef.current = window.setTimeout(commitView, 120);
    },
    [commitView],
  );

  const flushPendingWheelGesture = useCallback(() => {
    wheelGestureFrameRef.current = null;
    const gesture = pendingWheelGestureRef.current;
    pendingWheelGestureRef.current = null;
    if (!gesture) return;

    if (gesture.mode === "zoom") {
      const currentZoom = zoomRef.current;
      const zoomDeltaY = clamp(
        gesture.deltaY,
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
        cursor: gesture.cursor,
        oldZoom: currentZoom,
        nextZoom,
      });
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      applyViewToDom();
      scheduleViewCommit({ settleChrome: true });
      return;
    }

    const nextPan = {
      x: panRef.current.x - gesture.deltaX,
      y: panRef.current.y - gesture.deltaY,
    };
    panRef.current = nextPan;
    applyViewToDom();
    scheduleViewCommit();
  }, [applyViewToDom, scheduleViewCommit]);

  const enqueueWheelGesture = useCallback(
    (gesture: PendingWheelGesture) => {
      const pending = pendingWheelGestureRef.current;
      if (pending?.mode === "zoom" && gesture.mode === "zoom") {
        pendingWheelGestureRef.current = {
          mode: "zoom",
          deltaY: pending.deltaY + gesture.deltaY,
          cursor: gesture.cursor,
          clientX: gesture.clientX,
          clientY: gesture.clientY,
        };
      } else if (pending?.mode === "pan" && gesture.mode === "pan") {
        pendingWheelGestureRef.current = {
          mode: "pan",
          deltaX: pending.deltaX + gesture.deltaX,
          deltaY: pending.deltaY + gesture.deltaY,
        };
      } else {
        pendingWheelGestureRef.current = gesture;
      }

      if (wheelGestureFrameRef.current !== null) return;
      wheelGestureFrameRef.current = window.requestAnimationFrame(
        flushPendingWheelGesture,
      );
    },
    [flushPendingWheelGesture],
  );

  const enqueueWheelGestureFromClient = useCallback(
    (args: {
      deltaX: number;
      deltaY: number;
      deltaMode: number;
      clientX: number;
      clientY: number;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      const delta = getWheelDeltaFromValues(
        args.deltaX,
        args.deltaY,
        args.deltaMode,
      );

      if (args.ctrlKey || args.metaKey) {
        const zoomDeltaY = clamp(
          delta.y,
          -MAX_WHEEL_ZOOM_DELTA,
          MAX_WHEEL_ZOOM_DELTA,
        );
        enqueueWheelGesture({
          mode: "zoom",
          deltaY: zoomDeltaY,
          cursor: {
            x: args.clientX - rect.left,
            y: args.clientY - rect.top,
          },
          clientX: args.clientX,
          clientY: args.clientY,
        });
        return;
      }

      const deltaX = clamp(
        args.shiftKey && delta.x === 0 ? delta.y : delta.x,
        -MAX_WHEEL_PAN_DELTA,
        MAX_WHEEL_PAN_DELTA,
      );
      const deltaY = clamp(
        args.shiftKey && delta.x === 0 ? 0 : delta.y,
        -MAX_WHEEL_PAN_DELTA,
        MAX_WHEEL_PAN_DELTA,
      );
      enqueueWheelGesture({ mode: "pan", deltaX, deltaY });
    },
    [enqueueWheelGesture],
  );

  const handleWheelEvent = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      enqueueWheelGestureFromClient({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
    },
    [enqueueWheelGestureFromClient],
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
    const handleEmbeddedWheelMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "embedded-canvas-wheel") return;
      const surface = surfaceRef.current;
      if (!surface) return;
      const sourceIframe = Array.from(
        surface.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ),
      ).find((iframe) => iframe.contentWindow === event.source);
      if (!sourceIframe) return;

      const rect = sourceIframe.getBoundingClientRect();
      const scaleX =
        sourceIframe.clientWidth > 0
          ? rect.width / sourceIframe.clientWidth
          : 1;
      const scaleY =
        sourceIframe.clientHeight > 0
          ? rect.height / sourceIframe.clientHeight
          : 1;
      enqueueWheelGestureFromClient({
        deltaX: Number(event.data.deltaX) || 0,
        deltaY: Number(event.data.deltaY) || 0,
        deltaMode: Number(event.data.deltaMode) || WheelEvent.DOM_DELTA_PIXEL,
        clientX: rect.left + (Number(event.data.clientX) || 0) * scaleX,
        clientY: rect.top + (Number(event.data.clientY) || 0) * scaleY,
        ctrlKey: Boolean(event.data.ctrlKey),
        metaKey: Boolean(event.data.metaKey),
        shiftKey: Boolean(event.data.shiftKey),
      });
    };

    window.addEventListener("message", handleEmbeddedWheelMessage);
    return () =>
      window.removeEventListener("message", handleEmbeddedWheelMessage);
  }, [enqueueWheelGestureFromClient]);

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

  // Cmd+D / Ctrl+D: duplicate the selected frame with a visible offset so the
  // copy doesn't land exactly on top of the original (Figma-style behaviour).
  useEffect(() => {
    if (!onDuplicate) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activePenPathRef.current) return;
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "d" ||
        isEditableHotkeyTarget(event.target)
      ) {
        return;
      }
      // Only act on frame IDs — filter out canvas primitives (sub-elements).
      const frameIds = selectedIdsRef.current.filter(
        (id) => frameGeometryRef.current[id],
      );
      const targetId = frameIds[0];
      if (!targetId) return;
      const screen = screens.find((s) => s.id === targetId);
      if (!screen) return;
      const sourceGeometry = frameGeometryRef.current[targetId];
      if (!sourceGeometry) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // Offset the duplicate by one grid gap to the right (and slightly down)
      // so it is visually distinct from the original, mirroring Figma's behaviour.
      const canvasPosition = {
        x: sourceGeometry.x + sourceGeometry.width + SCREEN_GAP,
        y: sourceGeometry.y,
      };
      onDuplicate(targetId, {
        mode: "alt-click",
        screen,
        canvasPosition,
        dropCanvasPosition: canvasPosition,
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onDuplicate, screens]);

  const scale = canvasZoom / 100;
  const chromeScale = scale > 0 ? 1 / scale : 1;
  const showPixelGrid = canvasZoom >= PIXEL_GRID_ZOOM;
  const effectiveTool = normalizeCanvasTool(activeTool ?? localActiveTool);
  const penActive = effectiveTool === "pen";
  const creationToolActive = Boolean(getDraftCreationTool(effectiveTool));
  const canvasGestureActive = isDragging || isPanning;
  const displayedPenPath = penGesturePreview
    ? penGesturePreview
    : activePenPath && penPointer && activePenPath.nodes.length > 0
      ? penCloseHover
        ? closePenPath(activePenPath)
        : appendPenNode(activePenPath, createCornerNode(penPointer))
      : activePenPath;
  const selectedIdSet = new Set(selectedIds);
  const fullViewIdSet = new Set(fullViewScreenIds ?? []);
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
  const canvasFrames = screens.map((screen, index) => {
    const metadata = getResolvedMetadata(screen);
    return {
      screen,
      metadata,
      geometry:
        frameGeometry[screen.id] ?? getInitialFrameGeometry(index, metadata),
    };
  });
  const screenContentById = useMemo(() => {
    if (!renderScreenContent) return new Map<string, ReactNode>();
    return new Map(
      screens.map((screen, index) => {
        const metadata = getResolvedMetadata(screen);
        const geometry =
          frameGeometry[screen.id] ?? getInitialFrameGeometry(index, metadata);
        return [
          screen.id,
          renderScreenContent(screen, metadata, geometry),
        ] as const;
      }),
    );
  }, [frameGeometry, getResolvedMetadata, renderScreenContent, screens]);
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
  const singleSelectedFrame =
    selectedFrameEntries.length === 1 && !selectedGroupBounds
      ? selectedFrameEntries[0]
      : null;
  const singleSelectedDraft =
    selectedDraftEntries.length === 1 && !selectedDraftGroupBounds
      ? selectedDraftEntries[0]
      : null;
  return (
    <div
      ref={surfaceRef}
      className="relative h-full w-full select-none overflow-hidden"
      onMouseDownCapture={handleMouseDown}
      onMouseMove={handleMouseMove}
      style={{ cursor: surfaceCursor, touchAction: "none" }}
    >
      {showPixelGrid ? (
        <div
          ref={pixelGridRef}
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
        ref={worldRef}
        className="pointer-events-none absolute"
        style={{
          left: 0,
          top: 0,
          // Plain 2D transform — NO will-change / translate3d. Forcing a
          // compositor layer pins a low-res cached raster that the GPU stretches
          // when you zoom in, leaving screen content permanently blurry. A 2D
          // transform lets the browser re-rasterize crisply at rest. Zoom smoothness
          // comes from never re-rendering React during the gesture (see
          // flushPendingWheelGesture / applyViewToDom), not from layer promotion —
          // the trace proved paint/composite was never the bottleneck.
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {boardFileId &&
          boardFileContent !== undefined &&
          (() => {
            const boardGeo = boardFrameGeometry ?? {
              x: 0,
              y: 0,
              width: 8192,
              height: 8192,
            };
            // Clamp board canvas to the DesignCanvas max safe dimension.
            const boardW = Math.min(boardGeo.width, 16384);
            const boardH = Math.min(boardGeo.height, 16384);
            return (
              // Overflow-hidden wrapper so the board iframe never bleeds outside
              // its declared logical surface. z-index 0 keeps it below screen
              // iframes (which have their own stacking context above this).
              <div
                style={{
                  position: "absolute",
                  left: SURFACE_PADDING,
                  top: SURFACE_PADDING,
                  width: boardW,
                  height: boardH,
                  overflow: "hidden",
                  pointerEvents: "auto",
                  // Board sits behind all screen iframes.
                  zIndex: 0,
                }}
              >
                <DesignCanvas
                  content={boardFileContent}
                  contentKey={boardFileId}
                  zoom={100}
                  deviceFrame="none"
                  editMode={boardEditMode}
                  interactMode={false}
                  registerRuntimeBridge={false}
                  onElementSelect={onBoardElementSelect ?? (() => {})}
                  onElementHover={onBoardElementHover ?? (() => {})}
                  onVisualStructureChange={onBoardVisualStructureChange}
                  onVisualStyleChange={onBoardVisualStyleChange}
                  onVisualDuplicateChange={onBoardVisualDuplicateChange}
                  onTextContentChange={onBoardTextContentChange}
                  tweakValues={{}}
                />
              </div>
            );
          })()}

        {canvasFrames.map(({ screen, metadata, geometry }) => {
          return (
            <Screen
              key={screen.id}
              screen={screen}
              metadata={metadata}
              geometry={geometry}
              screenContent={screenContentById.get(screen.id)}
              isActive={screen.id === activeId}
              isSelected={selectedIdSet.has(screen.id)}
              showFullView={fullViewIdSet.has(screen.id)}
              isDirectlyHovered={screen.id === directlyHoveredScreenId}
              hasHoveredChild={
                (screen.id === activeId && activeScreenHasHoveredChild) ||
                screen.id === hoveredChildScreenId
              }
              groupSelected={hasGroupSelection}
              handlesEnabled={!hasGroupSelection}
              penActive={penActive}
              creationToolActive={creationToolActive}
              canvasGestureActive={canvasGestureActive}
              chromeScale={chromeScale}
              chromeSettling={chromeSettling}
              onPick={handleFrameClick}
              onEdit={handleFrameDoubleClick}
              onStartFrameDrag={beginFrameDrag}
              onStartResize={beginResize}
              onStartRotate={beginRotate}
              onStartDuplicateGesture={beginDuplicateGesture}
              onAddBreakpoint={
                onAddBreakpoint
                  ? (widthPx) => onAddBreakpoint(screen.id, widthPx)
                  : undefined
              }
              onActiveBreakpointChange={
                onActiveBreakpointChange
                  ? (widthPx) => onActiveBreakpointChange(screen.id, widthPx)
                  : undefined
              }
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
            chromeSettling={chromeSettling}
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
            chromeSettling={chromeSettling}
            onClick={() => {}}
            onStartDrag={() => {}}
            onStartResize={() => {}}
          />
        ) : null}

        {displayedPenPath ? (
          <PenPathOverlay path={displayedPenPath} closeHover={penCloseHover} />
        ) : null}

        {singleSelectedFrame ? (
          <SelectionBox
            geometry={singleSelectedFrame.geometry}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            showRotate
            onStartResize={(handle, event) =>
              beginResize(singleSelectedFrame.id, handle, event)
            }
            onStartRotate={(event) =>
              beginRotate(singleSelectedFrame.id, event)
            }
          />
        ) : null}

        {singleSelectedDraft ? (
          <SelectionBox
            geometry={singleSelectedDraft.geometry}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            showRotate={false}
            onStartResize={(handle, event) =>
              beginDraftResize(singleSelectedDraft.id, handle, event)
            }
            onStartRotate={() => {}}
          />
        ) : null}

        {selectedGroupBounds ? (
          <GroupSelectionBox
            bounds={selectedGroupBounds}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            onStartResize={beginGroupResize}
          />
        ) : null}

        {selectedDraftGroupBounds ? (
          <GroupSelectionBox
            bounds={selectedDraftGroupBounds}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
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
      </div>

      {penActive || creationToolActive ? (
        <div
          data-canvas-creation-shield
          className="pointer-events-auto absolute inset-0 z-30 cursor-crosshair"
          aria-hidden="true"
        />
      ) : null}

      {marquee ? (
        <span
          className="pointer-events-none absolute z-40 border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)]"
          style={{
            // Convert canvas-space marquee to surface-space so this overlay
            // is never clipped or hidden by the canvas transform container.
            // Surface position = pan + (SURFACE_PADDING + canvasCoord) * scale
            left: pan.x + (SURFACE_PADDING + marquee.x) * scale,
            top: pan.y + (SURFACE_PADDING + marquee.y) * scale,
            width: Math.max(1, marquee.width * scale),
            height: Math.max(1, marquee.height * scale),
          }}
        />
      ) : null}

      {primitiveDropTarget ? (
        <span
          data-primitive-drop-target
          className="pointer-events-none absolute z-40 rounded-sm"
          style={{
            // Surface position = pan + (SURFACE_PADDING + canvasCoord) * scale
            left:
              pan.x +
              (SURFACE_PADDING + primitiveDropTarget.boardRect.x) * scale,
            top:
              pan.y +
              (SURFACE_PADDING + primitiveDropTarget.boardRect.y) * scale,
            width: Math.max(1, primitiveDropTarget.boardRect.width * scale),
            height: Math.max(1, primitiveDropTarget.boardRect.height * scale),
            // Match the in-screen inside-guide style: 2px accent border + 14%
            // accent fill. Uses the same CSS variable as the DesignCanvas guide.
            border: "2px solid var(--design-editor-accent-color)",
            background:
              "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)",
          }}
        />
      ) : null}

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
          data-transform-badge
          className="pointer-events-none fixed z-50 rounded border border-border bg-background/95 px-1.5 py-0.5 font-mono text-[11px] leading-5 text-foreground shadow-lg backdrop-blur"
          style={{ left: transformBadge.x, top: transformBadge.y }}
        >
          {transformBadge.text}
        </div>
      ) : null}

      {/* Cross-screen element drag: highlight the candidate target screen frame.
          Uses the same style as the primitiveDropTarget overlay (2px accent border
          + 14% accent fill) so it is visually consistent. */}
      {crossScreenTarget ? (
        <span
          data-cross-screen-drop-target
          className="pointer-events-none absolute z-40 rounded-sm"
          style={{
            // Surface position = pan + (SURFACE_PADDING + canvasCoord) * scale
            left:
              pan.x + (SURFACE_PADDING + crossScreenTarget.geometry.x) * scale,
            top:
              pan.y + (SURFACE_PADDING + crossScreenTarget.geometry.y) * scale,
            width: Math.max(1, crossScreenTarget.geometry.width * scale),
            height: Math.max(1, crossScreenTarget.geometry.height * scale),
            border: "2px solid var(--design-editor-accent-color)",
            background:
              "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)",
          }}
        />
      ) : null}

      {/* Cross-screen element drag: small ghost following the board-space cursor. */}
      {crossScreenGhost ? (
        <span
          data-cross-screen-drag-ghost
          className="pointer-events-none absolute z-50 rounded border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]/20 shadow"
          style={{
            // A fixed-size ghost (16×16 canvas-px) centred on the board point.
            // Surface position = pan + (SURFACE_PADDING + canvasCoord) * scale
            left:
              pan.x + (SURFACE_PADDING + crossScreenGhost.boardX) * scale - 8,
            top:
              pan.y + (SURFACE_PADDING + crossScreenGhost.boardY) * scale - 8,
            width: 16,
            height: 16,
          }}
        />
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
  chromeSettling,
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
  chromeSettling: boolean;
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
      data-screen-shell
      type="button"
      className={cn(
        "group/artboard pointer-events-auto absolute block overflow-visible text-left outline-none",
        preview || penActive ? "cursor-crosshair" : "cursor-pointer",
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
      {/* B3 fix: for the creation preview the outline must sit flush with the
          geometry box (inset: 0) so the blue accent border lands exactly on the
          shape edge with no visible gap between the gray content border and the
          blue selection outline.  For placed / hovered draft-primitives the
          existing -5px inset is intentional (matches the screen-frame chrome). */}
      <span
        className={cn(
          "pointer-events-none absolute rounded-sm border transition-opacity",
          preview
            ? "border-[var(--design-editor-accent-color)] opacity-100"
            : selected
              ? "border-transparent opacity-0"
              : "border-[var(--design-editor-accent-color)] opacity-0 group-hover/artboard:opacity-100",
        )}
        style={{
          inset: preview ? 0 : -5 * chromeScale,
          borderWidth: 1.5 * chromeScale,
          transition: getChromeBorderTransition(chromeSettling),
        }}
      />
      <ResizeHandles
        active={preview}
        enabled={!penActive && preview}
        showRotate={false}
        chromeScale={chromeScale}
        chromeSettling={chromeSettling}
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
    // B5 fix: use canonical style so preview matches the committed element.
    const textStyle = canvasPrimitiveReactStyle("text", {
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
    return (
      <div
        className={cn(
          "flex size-full items-start px-2 py-1 text-sm font-medium text-foreground",
          muted,
        )}
        style={textStyle}
      >
        <span className="truncate">{draft.text}</span>
      </div>
    );
  }

  if (draft.kind === "frame") {
    // B5 fix: use canonical style so preview matches the committed element.
    const frameStyle = canvasPrimitiveReactStyle("frame", {
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
    return <div className={cn("size-full", muted)} style={frameStyle} />;
  }

  if (draft.kind === "ellipse") {
    // B5/B6 fix: use canonical style — ellipse gets borderRadius:50% in both
    // the preview and the committed path, and the same calm neutral fill.
    const ellipseStyle = canvasPrimitiveReactStyle("ellipse", {
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
    return <div className={cn("size-full", muted)} style={ellipseStyle} />;
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

  // B5 fix: rect/rectangle — use canonical style so preview matches committed.
  const rectStyle = canvasPrimitiveReactStyle("rect", {
    fill: draft.fill,
    stroke: draft.stroke,
    strokeWidth: draft.strokeWidth,
  });
  return <div className={cn("size-full", muted)} style={rectStyle} />;
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

/** Standard Tailwind breakpoint widths, mobile-first (base / md: / lg: / xl:). */
const STANDARD_BREAKPOINT_WIDTHS = [390, 768, 1280] as const;

/** Derive the Tailwind prefix for a given frame width. */
function breakpointLabel(widthPx: number): string {
  if (widthPx <= 640) return "Mobile";
  if (widthPx <= 1024) return "Tablet";
  return "Desktop";
}

/** Suggest the next standard breakpoint not yet in the set. */
function nextBreakpointWidth(existing: number[]): number | undefined {
  return STANDARD_BREAKPOINT_WIDTHS.find((w) => !existing.includes(w));
}

interface ScreenProps {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  geometry: FrameGeometry;
  isActive: boolean;
  isSelected: boolean;
  showFullView: boolean;
  isDirectlyHovered: boolean;
  hasHoveredChild: boolean;
  groupSelected: boolean;
  handlesEnabled: boolean;
  penActive: boolean;
  creationToolActive: boolean;
  canvasGestureActive: boolean;
  chromeScale: number;
  chromeSettling: boolean;
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
  onAddBreakpoint?: (widthPx: number) => void;
  onActiveBreakpointChange?: (widthPx: number | undefined) => void;
}

const Screen = memo(function Screen({
  screen,
  metadata,
  geometry,
  isActive,
  isSelected,
  showFullView,
  isDirectlyHovered,
  hasHoveredChild,
  groupSelected,
  handlesEnabled,
  penActive,
  creationToolActive,
  canvasGestureActive,
  chromeScale,
  chromeSettling,
  onPick,
  onEdit,
  onStartFrameDrag,
  onStartResize,
  onStartRotate,
  onStartDuplicateGesture,
  screenContent,
  onAddBreakpoint,
  onActiveBreakpointChange,
}: ScreenProps) {
  const t = useT();
  const display = metadata.title ?? prettyScreenName(screen.filename);
  const previewUrl = metadata.previewUrl ?? getPreviewUrl(screen.content);
  const previewViewport = getScreenPreviewViewport(metadata, geometry);
  const suppressNextClick = useRef(false);
  const [directlyHovered, setDirectlyHovered] = useState(false);
  const frameDirectlyHovered =
    (directlyHovered || isDirectlyHovered) &&
    !creationToolActive &&
    !canvasGestureActive;
  const suppressFrameChromeForChild =
    hasHoveredChild && !directlyHovered && !isDirectlyHovered;
  const emphasized = isSelected || frameDirectlyHovered;
  const fullViewVisible = emphasized || showFullView;
  const activeOrEmphasized = isActive || emphasized;
  const selectionOutlined = isSelected && !groupSelected;
  const showHoverChrome =
    frameDirectlyHovered &&
    !isSelected &&
    !groupSelected &&
    !suppressFrameChromeForChild;
  const screenContentInteractive =
    Boolean(screenContent) &&
    !penActive &&
    !creationToolActive &&
    !canvasGestureActive;
  // Memoize the srcdoc with the hit-test responder injected so we don't
  // rebuild the string every render (that would reload the iframe).
  // Keyed only on screen.content; the hit-test script itself is constant.
  const srcdocWithHitTest = useMemo(
    () => appendHitTestResponder(screen.content),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screen.content],
  );

  const updateDirectHover = useCallback((next: boolean) => {
    setDirectlyHovered((current) => (current === next ? current : next));
  }, []);
  const frameLabelHeight = FRAME_LABEL_HEIGHT * chromeScale;
  const frameScreenWidth = geometry.width / Math.max(chromeScale, 0.001);
  const fullViewOutsideFrame =
    frameScreenWidth < FRAME_HEADER_BUTTON_OUTSIDE_WIDTH;
  const labelInfoMaxWidth = Math.max(
    64,
    frameScreenWidth - (fullViewOutsideFrame ? 8 : FRAME_HEADER_BUTTON_RESERVE),
  );
  const estimatedTitleWidth = clamp(
    display.length * FRAME_HEADER_TITLE_CHAR_WIDTH,
    FRAME_HEADER_MIN_TITLE_WIDTH,
    FRAME_HEADER_MAX_TITLE_WIDTH,
  );
  const showDimensions =
    frameScreenWidth >=
    estimatedTitleWidth +
      FRAME_HEADER_DIMENSIONS_WIDTH +
      (fullViewOutsideFrame ? 16 : FRAME_HEADER_BUTTON_RESERVE);
  const fullViewMaxWidth = fullViewOutsideFrame
    ? 120
    : Math.max(84, Math.min(180, frameScreenWidth * 0.46));

  return (
    <div
      data-frame-shell
      data-screen-shell
      className="group/frame pointer-events-auto absolute"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y - frameLabelHeight,
        width: geometry.width,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${frameLabelHeight + geometry.height / 2}px`,
        zIndex: geometry.z,
      }}
    >
      <div
        className="relative w-full cursor-default"
        style={{ height: frameLabelHeight }}
        onClick={(e) => {
          e.stopPropagation();
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            return;
          }
          if (e.detail > 1) return;
          onPick(screen.id, e);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onEdit(screen.id, e);
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (penActive || creationToolActive) return;
          if (e.altKey) {
            onStartDuplicateGesture(screen, display, e);
            return;
          }
          if (e.shiftKey) {
            e.stopPropagation();
            return;
          }
          onStartFrameDrag(screen.id, e);
        }}
      >
        <div
          data-frame-label
          className="absolute left-1 top-1/2 flex min-w-0 items-center gap-1.5"
          onMouseEnter={() => updateDirectHover(true)}
          onMouseLeave={() => updateDirectHover(false)}
          style={{
            maxWidth: labelInfoMaxWidth,
            transform: `translateY(-50%) scale(${chromeScale})`,
            transformOrigin: "left center",
            transition: getChromeLabelTransition(chromeSettling),
          }}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              emphasized ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <span
            data-frame-title
            className={cn(
              "min-w-0 truncate text-[11px] font-medium",
              emphasized
                ? "text-[var(--design-editor-accent-color)]"
                : activeOrEmphasized
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
            title={screen.filename}
          >
            {display}
          </span>
          {showDimensions ? (
            <span
              data-frame-dimensions
              className="hidden shrink-0 text-[10px] tabular-nums text-muted-foreground/70 sm:inline"
            >
              {previewViewport.displayWidth} x {previewViewport.displayHeight}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          data-frame-full-view
          className={cn(
            "absolute top-1/2 z-40 flex h-5 shrink-0 items-center gap-1 overflow-hidden rounded-md border border-border bg-background/95 px-1.5 text-[10px] font-medium text-foreground opacity-0 shadow-sm transition-opacity",
            "hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            fullViewVisible && "opacity-100",
            fullViewOutsideFrame ? "left-full" : "right-1",
          )}
          style={{
            maxWidth: fullViewMaxWidth,
            transform: `translateY(-50%) scale(${chromeScale})`,
            transformOrigin: fullViewOutsideFrame
              ? "left center"
              : "right center",
            transition: getChromeLabelTransition(chromeSettling),
          }}
          aria-label={t("multiScreenCanvas.fullView")}
          title={t("multiScreenCanvas.fullView")}
          onClick={(event) => onEdit(screen.id, event)}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseEnter={() => updateDirectHover(true)}
          onMouseLeave={() => updateDirectHover(false)}
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
          if (isInteractiveScreenContentTarget(e.target)) {
            e.stopPropagation();
            return;
          }
          e.stopPropagation();
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            return;
          }
          if (e.detail > 1) return;
          onPick(screen.id, e);
        }}
        onDoubleClick={(e) => {
          if (isInteractiveScreenContentTarget(e.target)) {
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
        }}
        onMouseDown={(e) => {
          if (isInteractiveScreenContentTarget(e.target)) {
            e.stopPropagation();
            return;
          }
          if (creationToolActive) return;
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
        onMouseMove={(e) => {
          updateDirectHover(
            isDirectScreenHoverTarget(e.target, e.currentTarget),
          );
        }}
        onMouseLeave={() => updateDirectHover(false)}
        className={cn(
          "group/artboard relative block overflow-visible rounded-lg bg-background text-left outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          emphasized
            ? "text-foreground"
            : cn(
                "text-muted-foreground",
                showHoverChrome && "hover:text-foreground",
              ),
        )}
        style={{
          width: geometry.width,
          height: geometry.height,
          cursor: penActive || creationToolActive ? "crosshair" : "pointer",
          touchAction: "none",
        }}
      >
        <span
          data-screen-content
          className={cn(
            "relative block h-full w-full overflow-hidden rounded-[inherit] bg-white shadow-2xl ring-1 ring-inset ring-border transition-colors",
          )}
          style={{ pointerEvents: screenContentInteractive ? "auto" : "none" }}
        >
          {screenContent ?? (
            <iframe
              data-screen-iframe-id={screen.id}
              src={previewUrl}
              srcDoc={previewUrl ? undefined : srcdocWithHitTest}
              sandbox="allow-scripts"
              loading="lazy"
              className="pointer-events-none border-0"
              style={{
                width: previewViewport.viewportWidth,
                height: previewViewport.viewportHeight,
                // Untouched same-aspect overview thumbnails may scale uniformly.
                // User-resized frames use their real iframe viewport so
                // responsive layouts recompute instead of getting stretched.
                transform:
                  previewViewport.scale === 1
                    ? undefined
                    : `scale(${previewViewport.scale})`,
                transformOrigin: "top left",
                backgroundColor: "white",
                colorScheme: "light",
                // Prevent the browser from discarding the composited layer at
                // fractional zoom levels, which causes the iframe to go black.
                // backface-visibility:hidden forces the browser to keep the
                // backing store alive even when the effective scale is very small
                // (e.g. 0.25 iframe scale × 0.5 canvas zoom = 0.125 total).
                backfaceVisibility: "hidden",
              }}
              title={screen.filename}
            />
          )}
          {creationToolActive ? (
            <span
              className="pointer-events-auto absolute inset-0 z-20 cursor-crosshair"
              aria-hidden="true"
            />
          ) : null}
          {canvasGestureActive && screenContent ? (
            <span
              data-screen-interaction-shield
              className="pointer-events-auto absolute inset-0 z-30"
              aria-hidden="true"
            />
          ) : null}
        </span>
        <span
          data-screen-hover-outline
          className={cn(
            "pointer-events-none absolute inset-0 z-10 rounded-[inherit] border border-[var(--design-editor-accent-color)] transition-opacity",
            showHoverChrome ? "opacity-100" : "opacity-0",
          )}
          style={{
            borderWidth: 1.5 * chromeScale,
            transition: getChromeBorderTransition(chromeSettling),
          }}
          aria-hidden="true"
        />
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] border border-black/5" />
        <ResizeHandles
          active={false}
          enabled={
            !selectionOutlined &&
            !penActive &&
            !creationToolActive &&
            handlesEnabled
          }
          showOnHover={false}
          showRotate
          chromeScale={chromeScale}
          chromeSettling={chromeSettling}
          onStartResize={(handle, e) => onStartResize(screen.id, handle, e)}
          onStartRotate={(e) => onStartRotate(screen.id, e)}
        />
      </div>

      {/* Multi-breakpoint preview row (§6.4 — Framer/Figma-Sites style).
          Rendered as a sibling row to the right of the primary frame when
          the screen has breakpointWidths set. Each frame shares the same
          srcdoc content at a different viewport width. The active breakpoint
          is highlighted and clicking a frame header sets the edit scope. */}
      {screen.breakpointWidths && screen.breakpointWidths.length > 0 ? (
        <BreakpointPreviewRow
          screen={screen}
          primaryGeometry={geometry}
          previewUrl={previewUrl}
          srcdocWithHitTest={srcdocWithHitTest}
          activeBreakpointWidth={screen.activeBreakpointWidth}
          penActive={penActive}
          creationToolActive={creationToolActive}
          chromeScale={chromeScale}
          onActiveBreakpointChange={onActiveBreakpointChange}
          onAddBreakpoint={onAddBreakpoint}
        />
      ) : null}
    </div>
  );
}, areScreenPropsEqual);

function areScreenPropsEqual(prev: ScreenProps, next: ScreenProps) {
  return (
    prev.screen === next.screen &&
    prev.screenContent === next.screenContent &&
    sameResolvedMetadata(prev.metadata, next.metadata) &&
    sameFrameGeometry(prev.geometry, next.geometry) &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.showFullView === next.showFullView &&
    prev.isDirectlyHovered === next.isDirectlyHovered &&
    prev.hasHoveredChild === next.hasHoveredChild &&
    prev.groupSelected === next.groupSelected &&
    prev.handlesEnabled === next.handlesEnabled &&
    prev.penActive === next.penActive &&
    prev.creationToolActive === next.creationToolActive &&
    prev.canvasGestureActive === next.canvasGestureActive &&
    prev.chromeScale === next.chromeScale &&
    prev.chromeSettling === next.chromeSettling &&
    prev.onPick === next.onPick &&
    prev.onEdit === next.onEdit &&
    prev.onStartFrameDrag === next.onStartFrameDrag &&
    prev.onStartResize === next.onStartResize &&
    prev.onStartRotate === next.onStartRotate &&
    prev.onStartDuplicateGesture === next.onStartDuplicateGesture
  );
}

// ── Breakpoint preview row (§6.4) ────────────────────────────────────────────

/** Gap between adjacent breakpoint frames in canvas pixels. */
const BREAKPOINT_FRAME_GAP = 24;

function BreakpointPreviewRow({
  screen,
  primaryGeometry,
  previewUrl,
  srcdocWithHitTest,
  activeBreakpointWidth,
  penActive,
  creationToolActive,
  chromeScale,
  onActiveBreakpointChange,
  onAddBreakpoint,
}: {
  screen: ScreenFile;
  primaryGeometry: FrameGeometry;
  previewUrl: string | undefined;
  /**
   * The primary screen's srcdoc with the lightweight hit-test responder already
   * injected (memoised in the parent Screen component).  Passed down so
   * breakpoint sub-iframes carry the same responder and can be found via
   * [data-screen-iframe-id] by the cross-screen drop-into-container handler.
   */
  srcdocWithHitTest: string;
  activeBreakpointWidth: number | undefined;
  penActive: boolean;
  creationToolActive: boolean;
  chromeScale: number;
  onActiveBreakpointChange?: (widthPx: number | undefined) => void;
  onAddBreakpoint?: (widthPx: number) => void;
}) {
  const breakpointWidths = screen.breakpointWidths ?? [];
  // Scale factor used to shrink additional frames to match the primary frame height
  const scaleY = primaryGeometry.height / (primaryGeometry.width || 1);
  // Place additional frames to the right of the primary, starting after the gap
  let offsetX = primaryGeometry.width + BREAKPOINT_FRAME_GAP;

  const nextWidth = nextBreakpointWidth(breakpointWidths);

  return (
    <>
      {breakpointWidths.map((widthPx) => {
        // Scale the additional frame proportionally (same height as primary)
        const frameWidth = Math.round(widthPx * scaleY);
        const frameHeight = primaryGeometry.height;
        const isActive = activeBreakpointWidth === widthPx;
        const currentOffsetX = offsetX;
        offsetX += frameWidth + BREAKPOINT_FRAME_GAP;

        return (
          <div
            key={widthPx}
            data-frame-shell
            data-breakpoint-frame
            className="pointer-events-auto absolute"
            // Positioned relative to the parent Screen wrapper, which is already
            // absolute at left: SURFACE_PADDING + geometry.x / top:
            // SURFACE_PADDING + geometry.y - FRAME_LABEL_HEIGHT. Re-adding those
            // surface/primary terms here would double-offset every breakpoint
            // frame (~240px+ down-right), so we offset only within the wrapper.
            style={{
              left: currentOffsetX,
              top: -FRAME_LABEL_HEIGHT,
              width: frameWidth,
              zIndex: primaryGeometry.z,
            }}
          >
            {/* Frame label row */}
            <div
              className={cn(
                "flex h-7 w-full items-center justify-between gap-1 px-1 cursor-pointer select-none",
              )}
              onClick={(e) => {
                e.stopPropagation();
                onActiveBreakpointChange?.(isActive ? undefined : widthPx);
              }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    isActive
                      ? "bg-[var(--design-editor-accent-color)]"
                      : "bg-muted-foreground/40",
                  )}
                />
                <span
                  className={cn(
                    "truncate text-[11px] font-medium",
                    isActive
                      ? "text-[var(--design-editor-accent-color)]"
                      : "text-muted-foreground",
                  )}
                >
                  {breakpointLabel(widthPx)}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                  {widthPx}px
                </span>
              </div>
            </div>
            {/* Frame card */}
            <div
              className={cn(
                "relative block overflow-hidden rounded-lg border bg-white shadow-lg transition-colors",
                isActive
                  ? "border-[var(--design-editor-accent-color)]"
                  : "border-border",
              )}
              style={{ width: frameWidth, height: frameHeight }}
            >
              <iframe
                data-screen-iframe-id={screen.id}
                src={previewUrl}
                srcDoc={previewUrl ? undefined : srcdocWithHitTest}
                sandbox="allow-scripts"
                loading="lazy"
                className="pointer-events-none border-0"
                style={{
                  width: widthPx,
                  height: Math.round(
                    widthPx * (primaryGeometry.height / primaryGeometry.width),
                  ),
                  transform: `scale(${frameWidth / widthPx}, ${frameHeight / Math.round(widthPx * (primaryGeometry.height / primaryGeometry.width))})`,
                  transformOrigin: "top left",
                }}
                title={`${screen.filename} — ${breakpointLabel(widthPx)}`}
              />
              {creationToolActive || penActive ? (
                <span className="absolute inset-0 z-20 cursor-crosshair" />
              ) : null}
              <span className="pointer-events-none absolute inset-0 rounded-[7px] border border-black/5" />
            </div>
          </div>
        );
      })}

      {/* + affordance: add the next standard breakpoint */}
      {onAddBreakpoint && nextWidth !== undefined ? (
        <div
          className="pointer-events-auto absolute flex items-center"
          // Same wrapper-relative coordinate space as the breakpoint frames
          // above — no SURFACE_PADDING / primaryGeometry.x/y terms or it would
          // double-offset.
          style={{
            left: offsetX,
            top: -FRAME_LABEL_HEIGHT + primaryGeometry.height / 2,
            zIndex: primaryGeometry.z,
          }}
        >
          <button
            type="button"
            className={cn(
              "flex size-7 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm transition-colors",
              "hover:border-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
            )}
            style={{
              transform: `scale(${chromeScale})`,
              transformOrigin: "center",
            }}
            title={`Add ${breakpointLabel(nextWidth)} breakpoint (${nextWidth}px)`}
            onClick={(e) => {
              e.stopPropagation();
              onAddBreakpoint(nextWidth);
            }}
          >
            <IconPlus className="size-3.5" />
          </button>
        </div>
      ) : null}
    </>
  );
}

function GroupSelectionBox({
  bounds,
  chromeScale,
  chromeSettling,
  onStartResize,
}: {
  bounds: NonNullable<ReturnType<typeof getFrameGroupBounds>>;
  chromeScale: number;
  chromeSettling: boolean;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
}) {
  return (
    <SelectionBox
      geometry={{
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
      chromeScale={chromeScale}
      chromeSettling={chromeSettling}
      showRotate={false}
      onStartResize={onStartResize}
      onStartRotate={() => {}}
    />
  );
}

function SelectionBox({
  geometry,
  chromeScale,
  chromeSettling,
  showRotate = true,
  onStartResize,
  onStartRotate,
}: {
  geometry: FrameGeometry;
  chromeScale: number;
  chromeSettling: boolean;
  showRotate?: boolean;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      data-frame-selection-box
      data-frame-shell
      className="pointer-events-none absolute border border-[var(--design-editor-accent-color)]"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
        borderRadius: 13 * chromeScale,
        borderWidth: 1.5 * chromeScale,
        transition: getSelectionBoxTransition(chromeSettling),
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${geometry.height / 2}px`,
        zIndex: 1_000_000,
      }}
    >
      <ResizeHandles
        active
        enabled
        showRotate={showRotate}
        chromeScale={chromeScale}
        chromeSettling={chromeSettling}
        onStartResize={onStartResize}
        onStartRotate={onStartRotate}
      />
    </div>
  );
}

function ResizeHandles({
  active,
  enabled,
  showOnHover = true,
  showRotate = true,
  chromeScale = 1,
  chromeSettling = false,
  onStartResize,
  onStartRotate,
}: {
  active: boolean;
  enabled: boolean;
  showOnHover?: boolean;
  showRotate?: boolean;
  chromeScale?: number;
  chromeSettling?: boolean;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate: (e: React.MouseEvent) => void;
}) {
  if (!enabled) return null;

  const visibleHandleClass = cn(
    "pointer-events-auto absolute z-20 rounded-[2px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)] shadow transition-opacity",
    active
      ? "opacity-100"
      : cn(
          "opacity-0",
          showOnHover &&
            "group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100",
        ),
  );
  const edgeHandleClass =
    "pointer-events-auto absolute z-10 bg-transparent opacity-0";

  return (
    <>
      {EDGE_RESIZE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-resize-handle={config.handle}
          className={edgeHandleClass}
          style={edgeHandleStyle(
            config.handle,
            config.cursor,
            chromeScale,
            chromeSettling,
          )}
          onMouseDown={(e) => onStartResize(config.handle, e)}
        />
      ))}
      {CORNER_RESIZE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-resize-handle={config.handle}
          className={visibleHandleClass}
          style={cornerHandleStyle(
            config.handle,
            config.cursor,
            chromeScale,
            chromeSettling,
          )}
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
                  : cn(
                      "opacity-0",
                      showOnHover &&
                        "group-hover/artboard:opacity-100 group-focus-visible/artboard:opacity-100",
                    ),
              )}
              style={rotateHandleStyle(
                config.corner,
                chromeScale,
                chromeSettling,
              )}
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
  chromeSettling: boolean,
): CSSProperties {
  const size = 14 * chromeScale;
  const offset = -size / 2;
  if (handle === "n" || handle === "s") {
    return {
      cursor,
      transition: getChromeHandleTransition(chromeSettling),
      left: 0,
      right: 0,
      height: size,
      [handle === "n" ? "top" : "bottom"]: offset,
    };
  }
  return {
    cursor,
    transition: getChromeHandleTransition(chromeSettling),
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
  chromeSettling: boolean,
): CSSProperties {
  const size = 10 * chromeScale;
  const offset = -size / 2;
  return {
    cursor,
    transition: getChromeHandleTransition(chromeSettling),
    width: size,
    height: size,
    borderWidth: Math.max(1, 1.25 * chromeScale),
    ...(handle.includes("n") ? { top: offset } : { bottom: offset }),
    ...(handle.includes("w") ? { left: offset } : { right: offset }),
  };
}

function rotateHandleStyle(
  corner: string,
  chromeScale: number,
  chromeSettling: boolean,
): CSSProperties {
  const size = 28 * chromeScale;
  const offset = -34 * chromeScale;
  return {
    cursor: "grab",
    transition: getChromeHandleTransition(chromeSettling),
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

interface ScreenViewportSize {
  width: number;
  height: number;
}

function getInitialFrameGeometry(
  index: number,
  metadata?: ScreenViewportSize,
): FrameGeometry {
  // Seed default frames with the actual screen dimensions and the 3-column grid
  // the overview centering math (which uses SCREEN_WIDTH/SCREEN_GAP) expects, so
  // a design without persisted geometry opens centered. (The larger
  // assigned-region grid is only for the agent's generation planning, not the
  // editor's default placement.)
  const column = index % 3;
  const row = Math.floor(index / 3);
  const height = getOverviewFrameHeight(SCREEN_WIDTH, metadata);
  return {
    x: column * (SCREEN_WIDTH + SCREEN_GAP),
    y: row * (height + FRAME_LABEL_HEIGHT + SCREEN_GAP),
    width: SCREEN_WIDTH,
    height,
  };
}

function getOverviewFrameHeight(width: number, metadata?: ScreenViewportSize) {
  const sourceWidth =
    metadata?.width && metadata.width > 0 ? metadata.width : 1280;
  const sourceHeight =
    metadata?.height && metadata.height > 0 ? metadata.height : 2560;
  return Math.max(80, Math.round((width * sourceHeight) / sourceWidth));
}

export function getPreviewDeviceFrameGeometry({
  currentGeometry,
  metadata,
  previewDeviceFrame,
}: {
  currentGeometry: FrameGeometry;
  metadata?: { width: number; height: number };
  previewDeviceFrame: DeviceFrameType;
}): FrameGeometry {
  if (previewDeviceFrame === "none") {
    return {
      ...currentGeometry,
      height: getOverviewFrameHeight(currentGeometry.width, metadata),
    };
  }

  const viewport = DEVICE_FRAME_VIEWPORTS[previewDeviceFrame];
  return {
    ...currentGeometry,
    width: Math.max(1, Math.round(metadata?.width ?? viewport.width)),
    height: Math.max(1, Math.round(metadata?.height ?? viewport.height)),
  };
}

function getScreenPreviewViewport(
  metadata: ScreenViewportSize,
  geometry: ScreenViewportSize,
) {
  const metadataWidth = Math.max(1, Math.round(metadata.width));
  const metadataHeight = Math.max(1, Math.round(metadata.height));
  const geometryWidth = Math.max(1, Math.round(geometry.width));
  const geometryHeight = Math.max(1, Math.round(geometry.height));
  const metadataAspect = metadataWidth / metadataHeight;
  const geometryAspect = geometryWidth / geometryHeight;
  const aspectMatches = Math.abs(metadataAspect - geometryAspect) < 0.005;

  if (aspectMatches) {
    return {
      viewportWidth: metadataWidth,
      viewportHeight: metadataHeight,
      displayWidth: metadataWidth,
      displayHeight: metadataHeight,
      scale:
        Math.abs(metadataWidth - geometryWidth) < 0.5 &&
        Math.abs(metadataHeight - geometryHeight) < 0.5
          ? 1
          : geometryWidth / metadataWidth,
    };
  }

  return {
    viewportWidth: geometryWidth,
    viewportHeight: geometryHeight,
    displayWidth: geometryWidth,
    displayHeight: geometryHeight,
    scale: 1,
  };
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

function mutePreviewIframePointerEvents(root: HTMLElement | null) {
  if (!root) return () => {};
  const previous = new Map<HTMLIFrameElement, string>();
  root
    .querySelectorAll<HTMLIFrameElement>("[data-design-preview-iframe]")
    .forEach((iframe) => {
      previous.set(iframe, iframe.style.pointerEvents);
      iframe.style.pointerEvents = "none";
    });
  return () => {
    previous.forEach((pointerEvents, iframe) => {
      if (iframe.isConnected) iframe.style.pointerEvents = pointerEvents;
    });
  };
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

/** Rotate `point` into the local (unrotated) space of a frame whose center is
 *  `center` and whose CSS transform is `rotate(degrees deg)`. Passing the
 *  inverse rotation maps world-space coordinates into the frame's local space
 *  so unrotated bounds tests remain correct. */
function rotatePointAroundCenter(
  point: Point,
  center: Point,
  degrees: number,
): Point {
  if (!degrees) return point;
  const rad = (-degrees * Math.PI) / 180; // inverse rotation
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** Test whether a marquee rect (in canvas space) intersects an OBB described by
 *  `bounds` (unrotated AABB) that has been rotated `degrees` around `center`.
 *  We map the four marquee corners into the frame's local space and check
 *  whether any corner is inside the bounds; we also check the reverse (any
 *  frame corner inside the marquee) to handle the case where the marquee is
 *  entirely contained within the rotated frame. */
function rotatedRectIntersects(
  rect: MarqueeRect,
  bounds: BoundsRect,
  center: Point,
  degrees: number,
): boolean {
  if (!degrees) {
    return rectIntersects(rect, bounds);
  }
  // Four corners of the marquee rect in canvas space.
  const marqueeCorners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  // Test: any marquee corner inside the unrotated frame bounds?
  for (const corner of marqueeCorners) {
    const local = rotatePointAroundCenter(corner, center, degrees);
    if (rectContainsPoint(bounds, local)) return true;
  }
  // Four corners of the unrotated frame in canvas space (rotate them outward).
  const frameCorners: Point[] = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom },
  ];
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const marqueeRight = rect.x + rect.width;
  const marqueeBottom = rect.y + rect.height;
  // Test: any rotated frame corner inside the marquee rect?
  for (const fc of frameCorners) {
    const dx = fc.x - center.x;
    const dy = fc.y - center.y;
    const wx = center.x + dx * cos - dy * sin;
    const wy = center.y + dx * sin + dy * cos;
    if (
      wx >= rect.x &&
      wx <= marqueeRight &&
      wy >= rect.y &&
      wy <= marqueeBottom
    ) {
      return true;
    }
  }
  return false;
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

function sameResolvedMetadata(
  a: ResolvedScreenMetadata,
  b: ResolvedScreenMetadata,
) {
  return (
    a.source === b.source &&
    a.previewState === b.previewState &&
    a.title === b.title &&
    a.width === b.width &&
    a.height === b.height &&
    a.previewUrl === b.previewUrl
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

export function getDraftPreviewGeometryForTool(
  tool: DraftCreationTool,
  start: Point,
  end: Point,
  hasMoved: boolean,
): FrameGeometry {
  if (tool === "pen" || tool === "line" || tool === "arrow") {
    return getDraftGeometryForTool(tool, start, end);
  }

  if (!hasMoved) {
    return { x: start.x, y: start.y, width: 0, height: 0 };
  }

  return getDraftGeometryForTool(tool, start, end);
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

function getWheelDeltaFromValues(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
) {
  const multiplier = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
  return {
    x: deltaX * multiplier,
    y: deltaY * multiplier,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveScreenMetadata(
  screen: ScreenFile,
  keyedMetadata?: ScreenMetadata,
  getterMetadata?: ScreenMetadata,
  previewDeviceFrame: DeviceFrameType = "none",
): ResolvedScreenMetadata {
  // Normalize content to a string up front: a screen whose content has not yet
  // loaded (or is otherwise not a plain string) must not crash the overview
  // render via the content.trim()/slice() helpers below.
  const safeScreen: ScreenFile =
    typeof screen.content === "string" ? screen : { ...screen, content: "" };
  const metadata = { ...safeScreen, ...keyedMetadata, ...getterMetadata };
  const previewUrl =
    metadata.url ??
    metadata.previewUrl ??
    safeScreen.previewUrl ??
    getPreviewUrl(safeScreen.content);
  const deviceViewport =
    previewDeviceFrame === "none"
      ? undefined
      : DEVICE_FRAME_VIEWPORTS[previewDeviceFrame];
  const width =
    deviceViewport?.width ??
    (metadata.width && metadata.width > 0 ? metadata.width : 1280);
  const height =
    deviceViewport?.height ??
    (metadata.height && metadata.height > 0 ? metadata.height : 2560);
  return {
    source:
      normalizeSource(metadata.sourceType ?? metadata.source) ??
      deriveSource(safeScreen, previewUrl),
    previewState:
      normalizePreviewState(
        metadata.lod ?? metadata.previewState ?? metadata.status,
      ) ?? derivePreviewState(safeScreen, previewUrl),
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
  // Tolerate non-string content (e.g. a screen whose content has not loaded):
  // a missing URL is correct here, a crash is not.
  return getUrl(
    typeof content === "string" ? content.trim() : undefined,
  )?.toString();
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Primitive-into-primitive drop target detection
// ---------------------------------------------------------------------------

/** A committed container primitive that can accept a dropped primitive. */
export interface PrimitiveDropTarget {
  /** The node's data-agent-native-node-id value. */
  nodeId: string;
  /** The screen frame id (ScreenFile.id) that owns this primitive. */
  screenId: string;
  /** The primitive's bounding rect in board/canvas space. */
  boardRect: FrameGeometry;
}

/**
 * Parsed representation of a committed primitive found in a screen's HTML.
 * Geometry is in screen-local CSS pixels (as written by appendCanvasPrimitiveToHtml).
 */
export interface ParsedScreenPrimitive {
  nodeId: string;
  screenId: string;
  /** Position relative to screen body (CSS px). */
  localLeft: number;
  localTop: number;
  localWidth: number;
  localHeight: number;
  isContainer: boolean;
}

/** Fast djb2-variant hash of a string. Runs in O(n) but is inlined for the
 *  JIT — no allocations, no imports.  Produces a 32-bit unsigned integer as a
 *  hex string.  Used only for cache-key disambiguation, not cryptography. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // h = h * 33 ^ charCode  (djb2 xor variant)
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep as unsigned 32-bit
  }
  return h.toString(16);
}

/** Simple LRU-style cache to avoid re-parsing the same screen HTML on every
 *  mousemove frame.  Keyed by `screenId:contentLength:hash` so that ANY edit
 *  (including changes deep in the middle of a large HTML document) invalidates
 *  the entry.  A length:hash pair eliminates the collision zone that existed
 *  when only prefix48+suffix48 were used — edits in `content[48..len-49]` would
 *  produce the same key even though the content differed. */
export const primitiveParseCache = new Map<string, ParsedScreenPrimitive[]>();
const PRIMITIVE_PARSE_CACHE_MAX = 64;

export function parsePrimitivesFromScreen(
  screen: ScreenFile,
): ParsedScreenPrimitive[] {
  const cacheKey = `${screen.id}:${screen.content.length}:${hashString(screen.content)}`;
  const cached = primitiveParseCache.get(cacheKey);
  if (cached) return cached;

  const result: ParsedScreenPrimitive[] = [];
  if (typeof DOMParser === "undefined" || !screen.content) {
    return result;
  }

  try {
    const doc = new DOMParser().parseFromString(screen.content, "text/html");
    const nodes = doc.querySelectorAll("[data-agent-native-node-id]");
    nodes.forEach((el) => {
      const nodeId = el.getAttribute("data-agent-native-node-id");
      if (!nodeId) return;

      const htmlEl = el as HTMLElement;
      const style = htmlEl.style;
      const tag = el.tagName.toLowerCase();

      // Only block elements with explicit absolute positioning are considered
      // positioned primitives drawn by appendCanvasPrimitiveToHtml.
      if (style.position !== "absolute") return;

      const left = parseFloat(style.left) || 0;
      const top = parseFloat(style.top) || 0;
      const width = parseFloat(style.width) || 0;
      const height = parseFloat(style.height) || 0;

      // Validity: must have non-zero size
      if (width <= 0 || height <= 0) return;

      // Container check:
      //   - Must be a div (not svg/path/circle/polygon/etc.)
      //   - Must NOT be an ellipse (border-radius:50%)
      //   - NOT a text primitive (but text divs could be containers in principle;
      //     we exclude them by checking for display:inline-block autoSize pattern)
      const isDiv = tag === "div";
      const isEllipse =
        style.borderRadius === "50%" ||
        style.borderRadius === "50% 50% 50% 50%";
      const isTextAutoSize = style.display === "inline-block";
      const isContainer = isDiv && !isEllipse && !isTextAutoSize;

      result.push({
        nodeId,
        screenId: screen.id,
        localLeft: left,
        localTop: top,
        localWidth: width,
        localHeight: height,
        isContainer,
      });
    });
  } catch {
    // Silently ignore parse errors
  }

  if (primitiveParseCache.size >= PRIMITIVE_PARSE_CACHE_MAX) {
    // Evict the oldest entry
    const firstKey = primitiveParseCache.keys().next().value;
    if (firstKey !== undefined) primitiveParseCache.delete(firstKey);
  }
  primitiveParseCache.set(cacheKey, result);
  return result;
}

/**
 * Convert a screen-local primitive rect to board/canvas coordinates.
 *
 * appendCanvasPrimitiveToHtml stores positions in screen-local CSS pixels
 * scaled from the board draft geometry:
 *   localX = (boardX - frame.x) * (metadata.width / frame.width)
 * Inverting:
 *   boardX = frame.x + localX * (frame.width / metadata.width)
 */
export function primitiveLocalToBoardRect(
  localLeft: number,
  localTop: number,
  localWidth: number,
  localHeight: number,
  frameGeometry: FrameGeometry,
  metadata: { width: number; height: number },
): FrameGeometry {
  const scaleX = frameGeometry.width / Math.max(1, metadata.width);
  const scaleY = frameGeometry.height / Math.max(1, metadata.height);
  return {
    x: frameGeometry.x + localLeft * scaleX,
    y: frameGeometry.y + localTop * scaleY,
    width: Math.max(1, localWidth * scaleX),
    height: Math.max(1, localHeight * scaleY),
  };
}

/**
 * Find the topmost committed container primitive at `point` (canvas coords),
 * excluding `draggedNodeId` and any of its descendants.
 *
 * Descendants are detected geometrically: a primitive whose board rect is
 * fully enclosed by the dragged node's board rect is treated as a descendant
 * and excluded. This avoids a circular parent-child relationship on drop.
 *
 * Returns null if no valid target found.
 */
export function getPrimitiveDropTargetForPoint(
  point: Point,
  draggedNodeId: string | null,
  screens: ScreenFile[],
  frameGeometryById: FrameGeometryById,
  getMetadata: (screen: ScreenFile) => { width: number; height: number },
): PrimitiveDropTarget | null {
  // Pre-compute the dragged node's board rect so we can exclude its descendants.
  let draggedBoardRect: FrameGeometry | null = null;
  if (draggedNodeId) {
    outer: for (const screen of screens) {
      const frameGeometry = frameGeometryById[screen.id];
      if (!frameGeometry) continue;
      const metadata = getMetadata(screen);
      const primitives = parsePrimitivesFromScreen(screen);
      for (const prim of primitives) {
        if (prim.nodeId === draggedNodeId) {
          draggedBoardRect = primitiveLocalToBoardRect(
            prim.localLeft,
            prim.localTop,
            prim.localWidth,
            prim.localHeight,
            frameGeometry,
            metadata,
          );
          break outer;
        }
      }
    }
  }

  let best: PrimitiveDropTarget | null = null;

  for (const screen of screens) {
    const frameGeometry = frameGeometryById[screen.id];
    if (!frameGeometry) continue;

    const frameBounds = {
      left: frameGeometry.x,
      top: frameGeometry.y,
      right: frameGeometry.x + frameGeometry.width,
      bottom: frameGeometry.y + frameGeometry.height,
    };
    if (!rectContainsPoint(frameBounds, point)) {
      continue;
    }

    const metadata = getMetadata(screen);
    const primitives = parsePrimitivesFromScreen(screen);

    for (const prim of primitives) {
      if (!prim.isContainer) continue;
      if (draggedNodeId && prim.nodeId === draggedNodeId) continue;

      const boardRect = primitiveLocalToBoardRect(
        prim.localLeft,
        prim.localTop,
        prim.localWidth,
        prim.localHeight,
        frameGeometry,
        metadata,
      );

      // Exclude geometric descendants: a primitive whose board rect is fully
      // contained within the dragged node's board rect is a child/descendant
      // and cannot be a valid reparent target (would create a cycle).
      if (
        draggedBoardRect &&
        boardRect.x >= draggedBoardRect.x &&
        boardRect.y >= draggedBoardRect.y &&
        boardRect.x + boardRect.width <=
          draggedBoardRect.x + draggedBoardRect.width &&
        boardRect.y + boardRect.height <=
          draggedBoardRect.y + draggedBoardRect.height
      ) {
        continue;
      }

      if (
        point.x >= boardRect.x &&
        point.x <= boardRect.x + boardRect.width &&
        point.y >= boardRect.y &&
        point.y <= boardRect.y + boardRect.height
      ) {
        // Later in the DOM = higher paint order = topmost visually.
        // We take the last match within each screen (DOM order).
        best = { nodeId: prim.nodeId, screenId: screen.id, boardRect };
      }
    }
  }

  return best;
}

/**
 * Resolve which screen (ScreenFile.id) owns a committed primitive nodeId by
 * scanning all screen HTML for the given data-agent-native-node-id value.
 */
export function resolveNodeScreenId(
  nodeId: string,
  screens: ScreenFile[],
): string | null {
  for (const screen of screens) {
    const primitives = parsePrimitivesFromScreen(screen);
    if (primitives.some((p) => p.nodeId === nodeId)) {
      return screen.id;
    }
  }
  return null;
}
