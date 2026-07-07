import { useT } from "@agent-native/core/client";
import {
  DEFAULT_ASSIGNED_REGION_GAP,
  DEFAULT_ASSIGNED_REGION_HEIGHT,
  DEFAULT_ASSIGNED_REGION_MAX_COLUMNS,
  DEFAULT_ASSIGNED_REGION_WIDTH,
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
  canvasToScreenPoint,
  computeEqualGapGuides,
  computeMoveSnap,
  computeResizeSnap,
  type DistanceGuideBand,
  type EqualGapGuide,
  type FrameBounds,
  getCameraForBounds,
  getDraftGeometryFromPoints,
  getFrameGroupBounds,
  getNudgeDelta,
  getPanForZoomToCursor,
  getResizeCursorForHandle,
  getRotatedFrameAABB,
  resizeFrameGroupFromDelta,
  resizeFrameGroupToBounds,
  resizeRotatedFrameFromDelta,
  rotateFrameGroupAroundCenter,
  rotatedRectIntersects,
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
  hitTestPenAnchor,
  hitTestPenHandle,
  isPenCloseTarget,
  movePenAnchor,
  movePenHandle,
  scalePenPathToGeometry,
  serializePenPath,
  setPenNodeType,
  snapPenAnchorPoint,
  translatePenPath,
  type PenNode,
  type PenPath,
} from "@shared/pen-path";
import {
  IconCopy,
  IconDots,
  IconMaximize,
  IconPlus,
} from "@tabler/icons-react";
import {
  memo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

import { parseBreakpointWidthInput } from "./BreakpointBar";
import {
  canvasPrimitiveReactStyle,
  DEFAULT_LINE_STROKE,
  DEFAULT_LINE_STROKE_WIDTH_PX,
} from "./canvas-primitive-style";
import {
  DesignCanvas,
  LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT,
  appendHitTestResponder,
  type IframeContextMenuPayload,
  type IframeFigmaClipboardPastePayload,
  type IframeHotkeyPayload,
} from "./DesignCanvas";
import {
  gradientToCss,
  parseGradientCss,
  type GradientStopValue,
} from "./inspector/GradientEditor";
import {
  DEVICE_FRAME_VIEWPORTS,
  type DeviceFrameType,
  type ElementInfo,
  type ElementSelectionIntent,
  type PortableStyleSnapshot,
} from "./types";

// Re-export so consumers of MultiScreenCanvas can use the same script without
// importing DesignCanvas directly.
export { LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT };

import type {
  AltHoverMeasurement,
  AltHoverMeasurementLine,
  CanvasLayerMarqueeCandidate,
  CanvasLayerMarqueeSelection,
  CanvasPrimitiveInsert,
  CanvasToolProps,
  CrossScreenDragElementRect,
  CrossScreenDropAxis,
  CrossScreenDropGuide,
  CrossScreenDropMode,
  CrossScreenDropPlacement,
  CrossScreenHitTestAnchorRect,
  CrossScreenHitTestResult,
  DraftCreationPreview,
  DraftCreationTool,
  DraftCreateDragState,
  DraftGeometryModifiers,
  DraftMoveDragState,
  DraftPrimitive,
  DraftPrimitiveById,
  DraftPrimitiveInput,
  DraftPrimitiveKind,
  DraftResizeDragState,
  DragState,
  DuplicatePreview,
  DuplicateRequest,
  FrameGeometry,
  FrameGeometryById,
  GradientEditOverlayTarget,
  GradientLinePoint,
  GroupRotateDragState,
  MarqueeDragState,
  MarqueeRect,
  MoveDragState,
  MultiScreenCanvasProps,
  MultiScreenCanvasTool,
  PanDragState,
  PendingWheelGesture,
  PenNodeDragState,
  PersistedDraftPrimitive,
  Point,
  ResizeDragState,
  ResizeHandle,
  ResolvedScreenMetadata,
  RotateDragState,
  ScreenContentCacheEntry,
  ScreenFile,
  ScreenMetadata,
  ScreenPreviewState,
  ScreenSourceType,
  TransformBadge,
  VectorEditAnchorDragState,
  VectorEditHandleDragState,
  VectorEditOverlayState,
} from "./multi-screen/types";
// Re-export so external consumers of MultiScreenCanvas (tests, other
// components) can keep importing these from this module directly.
export type {
  AltHoverMeasurement,
  AltHoverMeasurementLine,
  CanvasLayerMarqueeSelection,
  CanvasPrimitiveInsert,
  CrossScreenDropAxis,
  CrossScreenDropGuide,
  CrossScreenDropMode,
  CrossScreenDropPlacement,
  CrossScreenHitTestAnchorRect,
  CrossScreenHitTestResult,
  DraftPrimitive,
  DraftPrimitiveKind,
  DuplicateRequest,
  FrameGeometry,
  GradientEditOverlayTarget,
  GradientLinePoint,
  MultiScreenCanvasTool,
  Point,
  VectorEditOverlayState,
} from "./multi-screen/types";

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
/** How close two gaps must be (in screen px, converted to canvas px at the
 *  live zoom) to count as "equal" for the smart-spacing guides (CV11). */
const EQUAL_GAP_TOLERANCE_SCREEN_PX = 2;
const FRAME_LABEL_HEIGHT = 28;
const FRAME_HEADER_BUTTON_OUTSIDE_WIDTH = 260;
const FRAME_HEADER_BUTTON_RESERVE = 116;
const TRANSFORM_BADGE_OFFSET = 12;
const TRANSFORM_BADGE_EDGE_PADDING = 8;
const TRANSFORM_BADGE_HEIGHT = 28;
const TRANSFORM_BADGE_MIN_WIDTH = 64;
const TRANSFORM_BADGE_MAX_WIDTH = 180;
// Additive zIndex boost for the current "top" screen (selected, else active,
// else the first frame — see topScreenId). Screens are keyed by screen.id in
// stable DOM order (see PF16): reordering the top screen's key to the end of
// the array to win the paint stacking order forced React to move that
// iframe's DOM node, which reloads its document (a visible white flash).
// zIndex alone can express "renders above its siblings" without touching DOM
// order, as long as the boost is large enough to beat any real geometry.z
// (frame z-order is a small per-design integer) while staying well under the
// reserved resize-handle stacking range (999_999+).
const TOP_SCREEN_Z_BOOST = 100_000;
// Shared with canvas-math.ts (DEFAULT_CANVAS_MIN_ZOOM/DEFAULT_CANVAS_MAX_ZOOM)
// so this surface's zoom clamp lives in one place instead of being
// redeclared locally and drifting from the shared constant.
const MIN_ZOOM = DEFAULT_CANVAS_MIN_ZOOM;
const MAX_ZOOM = DEFAULT_CANVAS_MAX_ZOOM;
const ZOOM_SENSITIVITY = 0.01;
const MAX_WHEEL_ZOOM_DELTA = 120;
const MAX_WHEEL_PAN_DELTA = 140;
const PIXEL_GRID_ZOOM = 800;
import {
  CHROME_SETTLE_MS,
  getChromeBorderTransition,
  getChromeHandleTransition,
  getChromeLabelTransition,
  getSelectionBoxTransition,
} from "./multi-screen/chrome-transitions";
import {
  getCornerHandleGeometry,
  getEdgeHandleHitGeometry,
} from "./multi-screen/handle-hit-zones";

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

/**
 * True when a drag event is carrying native OS files (e.g. dragged in from
 * Finder/Explorer) rather than an internal HTML5 DOM drag (element reorder,
 * the extensions-panel native-asset drag, etc). Internal drags set
 * `dataTransfer.types` to things like "text/plain" and never include
 * "Files"; a real OS file drag always includes the "Files" type — per spec
 * this is reliably present during dragenter/dragover even before drop (when
 * `dataTransfer.files` itself is empty for security reasons), so this is the
 * correct check to gate preventDefault()/highlight logic on, not
 * `files.length` (which is only populated at drop time).
 */
export function isOsFileDrag(event: {
  dataTransfer: { types: readonly string[] | DOMStringList } | null;
}): boolean {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === "Files") return true;
  }
  return false;
}

// PERF9-WHEEL: module-scoped "a wheel/pinch camera gesture is in flight"
// flag, set by markWheelGestureActive on the first applied flush and cleared
// by commitView once the gesture settles (or on canvas unmount). Lives at
// module scope (not React state) because its consumers are event handlers —
// DesignEditor's hover callbacks — that must read the CURRENT value without
// any render round-trip: flipping React state for this at gesture start
// re-rendered every Screen and measurably stalled the first wheel ticks.
//
// Single-canvas-instance assumption: this flag is process-wide, not scoped
// to a particular MultiScreenCanvas mount. The editor only ever renders one
// MultiScreenCanvas at a time, so that's fine in practice — but if a second
// instance were ever mounted concurrently (e.g. a future side-by-side or
// picture-in-picture view), both would read/write the SAME flag and could
// stomp each other's gesture state. The unmount cleanup effect below clears
// it UNCONDITIONALLY (no ownership/identity check), so an unmounting second
// instance would also incorrectly clear a still-active gesture that belongs
// to the other, still-mounted instance. Revisit this if that assumption ever
// changes.
let wheelCameraGestureActive = false;

/** True while a MultiScreenCanvas wheel/pinch camera gesture is in flight
 *  (first applied wheel flush → settled debounced commit). DesignEditor's
 *  hover handlers consult this to skip hover setState mid-gesture: muting
 *  the content layers at gesture start flips the element under the cursor,
 *  firing a hover-clear that would otherwise cost a full-tree React render
 *  exactly when the pan needs the main thread most. Hover state simply goes
 *  stale for the gesture's duration (same contract as a space-drag pan) and
 *  recomputes from the next real pointer event after settle. */
export function isWheelCameraGestureActive(): boolean {
  return wheelCameraGestureActive;
}

export function shouldBoardSurfaceCapturePointerEvents(args: {
  tool: MultiScreenCanvasTool | string;
  gestureActive?: boolean;
}) {
  if (args.gestureActive) return false;
  const tool = normalizeCanvasTool(args.tool as MultiScreenCanvasTool);
  return (
    !getDraftCreationTool(tool) &&
    tool !== "hand" &&
    tool !== "comment" &&
    tool !== "draw"
  );
}

export function shouldShowFrameFullViewButton(args: {
  emphasized: boolean;
  showFullView?: boolean;
  childHoverActive?: boolean;
}) {
  return args.emphasized || !!args.showFullView || !!args.childHoverActive;
}

/** How long an armed duplicate-commit suppression stays valid while the
 *  created file(s) round-trip through the server before appearing in
 *  `screens`. Generous vs. the usual create-file latency, but short enough
 *  that an armed flag left behind by a failed mutation can't swallow a much
 *  later, unrelated screen-count recenter. */
export const LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS = 10_000;

/** Armed by a duplicate commit (alt-drag drop or Cmd+D) so the
 *  lineup-recenter effect can recognise — and skip — exactly the screen-count
 *  transition(s) that duplicate is about to produce. */
export interface LineupRecenterDuplicateArm {
  atMs: number;
  /** `screens.length` at the moment the duplicate was dispatched. */
  fromCount: number;
  /** How many duplicates were dispatched (alt-drag: 1; Cmd+D: one per
   *  selected frame — they land one server round-trip at a time). */
  addedCount: number;
}

/**
 * Whether the "center the lineup when the screen footprint changes" effect
 * must SKIP its camera move for this run. A duplicate (alt-drag drop OR
 * Cmd+D) places the clone deliberately relative to content the user is
 * already looking at — Figma keeps the camera still on that commit, but the
 * recenter effect (keyed on `screens.length`) would otherwise pan/zoom the
 * whole board the moment each new screen lands, making every untouched
 * sibling visibly shift. The duplicate commit arms `armed` with a timestamp,
 * the pre-duplicate screen count, and how many clones were dispatched; the
 * effect suppresses only transitions inside `(fromCount, fromCount +
 * addedCount]`, only while fresh, and never for device-frame-preview-driven
 * runs — so initial-load fit, explicit Zoom-to-fit (cameraCommand, a
 * different path entirely), toolbar add-screen recenters, and device-frame
 * changes all keep their behavior. Pure/exported for unit tests.
 */
export function shouldSuppressLineupRecenter(args: {
  armed: LineupRecenterDuplicateArm | null;
  nowMs: number;
  screenCount: number;
  deviceFrameChanged: boolean;
  maxAgeMs?: number;
}): boolean {
  if (!args.armed) return false;
  if (args.deviceFrameChanged) return false;
  const age = args.nowMs - args.armed.atMs;
  if (age < 0 || age > (args.maxAgeMs ?? LINEUP_RECENTER_SUPPRESS_MAX_AGE_MS)) {
    return false;
  }
  return (
    args.screenCount > args.armed.fromCount && // i18n-ignore — pure boolean expression, guard misreads the parenthesized return in this .tsx as JSX text
    args.screenCount <= args.armed.fromCount + args.armed.addedCount
  );
}

/**
 * True when this lineup-recenter run was caused purely by the screen count
 * SHRINKING (delete, or undo of a duplicate/add). Nothing new needs to
 * become reachable when screens disappear, and Figma keeps the camera still
 * on delete/undo — so the recenter effect skips these runs entirely (undo
 * after a duplicate previously yanked the camera a second time).
 * Device-frame-preview changes still recenter regardless of count direction.
 * Pure/exported for unit tests.
 */
export function isLineupShrinkOnlyChange(args: {
  previousCount: number | null;
  screenCount: number;
  deviceFrameChanged: boolean;
}): boolean {
  return (
    !args.deviceFrameChanged &&
    args.previousCount !== null &&
    args.screenCount < args.previousCount
  );
}

/**
 * Item 8b — whether an overview breakpoint frame's "…" menu affordance
 * (Change width / Remove) should render: gated by edit permission AND at
 * least one of the two callbacks being wired, then shown only for the
 * active frame or while its own menu is already open — same
 * one-visible-at-a-time rule BreakpointDeviceControl's own per-segment menu
 * uses, so idle frames stay visually clean. Pure/exported for unit tests.
 */
export function shouldShowBreakpointMenuAffordance(args: {
  canEdit: boolean;
  hasRemoveOrChangeWidth: boolean;
  isActive: boolean;
  menuOpen: boolean;
}): boolean {
  return (
    args.canEdit &&
    args.hasRemoveOrChangeWidth &&
    (args.isActive || args.menuOpen)
  );
}

export function getBoardSurfaceLayerStyle(args: {
  geometry: FrameGeometry;
  interactive: boolean;
}): CSSProperties {
  return {
    position: "absolute",
    left: SURFACE_PADDING + args.geometry.x,
    top: SURFACE_PADDING + args.geometry.y,
    width: args.geometry.width,
    height: args.geometry.height,
    overflow: "hidden",
    pointerEvents: args.interactive ? "auto" : "none",
    background: "transparent",
    zIndex: 0,
  };
}

import {
  BOARD_SURFACE_BACKGROUND,
  getBoardContentKey,
  getBoardContentLayerSignature,
  getBoardSurfaceRenderContent,
  hasBoardSurfaceContent,
  hashString,
} from "./multi-screen/board-surface-html";

const DRAFT_FRAME_WIDTH = 320;
const DRAFT_FRAME_HEIGHT = 640;
// Figma parity: a plain click (no drag) with the rectangle or ellipse tool
// places a 100x100 shape. Both tools share this default via the "else"
// branch of getDraftGeometryForTool below — drag-to-size behavior is
// unaffected since getDraftGeometryFromPoints only falls back to these when
// the pointer hasn't moved.
const DRAFT_RECT_WIDTH = 100;
const DRAFT_RECT_HEIGHT = 100;
const DRAFT_TEXT_WIDTH = 180;
const DRAFT_TEXT_HEIGHT = 48;
const DRAFT_LINE_WIDTH = 160;
const DRAFT_PATH_MIN_SIZE = 12;
const PEN_CLOSE_HIT_RADIUS_SCREEN_PX = 10;
/** Screen-space hit radius for vector-edit anchor/handle pointer targets,
 *  independent of PEN_CLOSE_HIT_RADIUS_SCREEN_PX (that one gates the pen
 *  tool's close-path affordance while drawing, not editing an existing
 *  path). Converted to canvas px via `screenPxToCanvasPx` before being
 *  passed to hitTestPenAnchor/hitTestPenHandle, which operate in canvas
 *  space. */
const VECTOR_EDIT_HIT_RADIUS_SCREEN_PX = 8;

import {
  alignmentGuidesEqual,
  altHoverMeasurementEqual,
  altHoverMeasurementLineEqual,
  computeAltHoverMeasurement,
  distanceGuideBandEqual,
  equalGapGuidesEqual,
} from "./multi-screen/alt-hover-measurement";
import {
  getCrossScreenDropGuideForHitTest,
  getCrossScreenDropGuideStyle,
  isCrossScreenDropAxis,
  isCrossScreenDropMode,
  isCrossScreenDropPlacement,
  isCrossScreenHitTestAnchorRect,
  isFinitePoint,
  isPortableStyleSnapshot,
} from "./multi-screen/cross-screen-drop";
import {
  clampFrameGeometryToViewport,
  computeScreenCullTier,
  getOverscannedViewportCanvasBounds,
  isFrameWithinOverscannedViewport,
  OVERVIEW_CULLING_ENABLED,
  OVERVIEW_CULLING_OVERSCAN_FACTOR,
  type OverscannedViewportBounds,
  type ScreenCullTier,
} from "./multi-screen/culling";
import {
  angleFromDraggedEndpoint,
  gradientLineEndpoints,
  gradientStopPoints,
  screenPxToCanvasPx,
  stopPercentFromDraggedPoint,
} from "./multi-screen/gradient-overlay-geometry";
import type { AlignmentGuide, CanvasFrameEntry } from "./multi-screen/types";
import {
  vectorEditCanvasToLocalPoint,
  vectorEditLocalToCanvasPoint,
} from "./multi-screen/vector-edit-geometry";

// Re-export so external consumers of MultiScreenCanvas (tests, other
// components) can keep importing these from this module directly.
export {
  alignmentGuidesEqual,
  altHoverMeasurementEqual,
  altHoverMeasurementLineEqual,
  angleFromDraggedEndpoint,
  clampFrameGeometryToViewport,
  computeAltHoverMeasurement,
  computeScreenCullTier,
  distanceGuideBandEqual,
  equalGapGuidesEqual,
  getBoardContentKey,
  getBoardContentLayerSignature,
  getBoardSurfaceRenderContent,
  getChromeBorderTransition,
  getCrossScreenDropGuideForHitTest,
  getCrossScreenDropGuideStyle,
  getOverscannedViewportCanvasBounds,
  getSelectionBoxTransition,
  hasBoardSurfaceContent,
  gradientLineEndpoints,
  gradientStopPoints,
  isFrameWithinOverscannedViewport,
  OVERVIEW_CULLING_ENABLED,
  OVERVIEW_CULLING_OVERSCAN_FACTOR,
  screenPxToCanvasPx,
  stopPercentFromDraggedPoint,
  vectorEditCanvasToLocalPoint,
  vectorEditLocalToCanvasPoint,
};
export type { OverscannedViewportBounds, ScreenCullTier };

export const MultiScreenCanvas = memo(function MultiScreenCanvas({
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
  onRemoveBreakpoint,
  onChangeBreakpointWidth,
  onEditBreakpoint,
  onSelectionChange,
  onLayerMarqueeSelectionChange,
  selectedLayerSelectorGroupsByScreen = {},
  onCrossScreenElementDrop,
  boardFileId,
  boardFileContent,
  boardFrameGeometry,
  onBoardDrawPrimitive,
  boardEditMode = false,
  boardIsActive = false,
  onBoardElementSelect,
  onBoardElementMarqueeSelect,
  onBoardElementHover,
  onBoardElementClear,
  onBoardElementDblClickText,
  onBoardIframeHotkey,
  onBoardFigmaClipboardPaste,
  onBoardIframeContextMenu,
  onBoardTextEditingStateChange,
  boardClearSelectionRequest,
  boardSelectedSelector,
  boardSelectedSelectorCandidates,
  boardHoveredSelector,
  boardHoveredSelectorCandidates,
  boardLockedSelectors,
  boardHiddenSelectors,
  onBoardVisualStructureChange,
  onBoardVisualStyleChange,
  onBoardVisualDuplicateChange,
  onBoardTextContentChange,
  vectorEdit,
  gradientEditTarget,
  onDropFiles,
  cameraCommand,
}: MultiScreenCanvasProps) {
  const t = useT();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const [canvasZoom, setCanvasZoom] = useState(zoom);
  const zoomRef = useRef(zoom);
  // Overview viewport culling (PF22): the surface's own on-screen size,
  // tracked via ResizeObserver below. Combined with the *committed* pan/
  // canvasZoom state (never the imperative per-gesture zoomRef/panRef — see
  // the culling helpers' module doc) to compute an overscanned world-space
  // viewport rect each render. Starts at {0,0} (unknown) so nothing is culled
  // before the first layout measurement.
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
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
  // Last raw client point the pen ghost/close-hover preview was computed
  // from (P18). A wheel pan/zoom gesture mutates pan/zoom every animation
  // frame via applyViewToDom without the mouse itself moving, so the
  // screen->canvas mapping used for the ghost segment goes stale unless we
  // re-derive it from this remembered client point after each such change.
  const lastPenClientPointRef = useRef<{
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  } | null>(null);
  const [localActiveTool, setLocalActiveTool] =
    useState<MultiScreenCanvasTool>("move");
  // K-scale tool parity: beginDraftResize/beginResize are defined (via
  // useCallback) earlier in this component's body than `effectiveTool` is
  // computed further down during render, so a ref mirroring it is the only
  // way for their long-lived mousemove closures to read the CURRENT tool
  // (a plain render-scoped `const` declared later in the function can't be
  // referenced by a callback defined earlier — that's a JS declaration-order
  // error, not just a stale-closure risk). Kept in sync by the effect right
  // below the other prop/state-mirroring refs (see onGeometryChangeRef etc.).
  const effectiveToolRef = useRef<MultiScreenCanvasTool>("move");
  const [selectedIds, setSelectedIds] = useState<string[]>(
    selectedScreenIds ?? [],
  );
  const selectedIdsRef = useRef(selectedIds);
  const dragState = useRef<DragState | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const duplicateCleanup = useRef<(() => void) | null>(null);
  // Armed by a duplicate commit (alt-drag drop or Cmd+D) so the
  // lineup-recenter effect keeps the camera still when the
  // deliberately-placed clone(s) land in `screens` — see
  // shouldSuppressLineupRecenter.
  const lineupRecenterSuppressRef = useRef<LineupRecenterDuplicateArm | null>(
    null,
  );
  const lineupRecenterDeviceFrameRef = useRef(previewDeviceFrame);
  const lineupRecenterPrevCountRef = useRef<number | null>(null);
  const handledSelectAllRequestRef = useRef(selectAllRequest);
  const handledClearSelectionRequestRef = useRef(clearSelectionRequest);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // PERF9-WHEEL: an in-flight wheel/pinch gesture imperatively mutes pointer
  // events on every live preview iframe (screens + board surface), restoring
  // each element's prior inline value once the gesture settles (commitView).
  // Without this, every wheel-pan tick moves live iframes under a stationary
  // cursor, the browser re-hit-tests into them, and their hover/hit-test
  // bridges post pointermove/element-hover messages (thousands per 240-tick
  // pan) that can setState in DesignEditor — ~20ms full-tree React renders
  // mid-gesture, which is what capped wheel-pan well under 60fps while drags
  // ran at ~98fps on the same board. Done with direct style writes on cached
  // nodes (NOT React state): flipping a canvasGestureActive-style flag at
  // gesture start re-rendered every Screen + mounted interaction shields,
  // costing a measured ~75ms first-tick stall — the exact class of jank
  // PERF9 exists to avoid. Same "imperative now, reconcile once at settle"
  // contract as applyViewToDom/scheduleViewCommit.
  const wheelGestureActiveRef = useRef(false);
  const wheelGestureMutedElementsRef = useRef<Map<HTMLElement, string> | null>(
    null,
  );
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const marqueeRef = useRef<MarqueeRect | null>(marquee);
  const [alignmentGuides, setAlignmentGuidesRaw] = useState<AlignmentGuide[]>(
    [],
  );
  const [equalGapGuides, setEqualGapGuidesRaw] = useState<EqualGapGuide[]>([]);
  // Guides are recomputed into a brand-new array on every rAF-coalesced
  // mousemove during a drag; without a value-equality bail, React commits a
  // state update (and a re-render) every frame even when the guides drawn on
  // screen haven't actually changed (PF15). Bail before calling setState.
  const setAlignmentGuides = useCallback((next: AlignmentGuide[]) => {
    setAlignmentGuidesRaw((current) =>
      alignmentGuidesEqual(current, next) ? current : next,
    );
  }, []);
  const setEqualGapGuides = useCallback((next: EqualGapGuide[]) => {
    setEqualGapGuidesRaw((current) =>
      equalGapGuidesEqual(current, next) ? current : next,
    );
  }, []);
  // Figma-parity alt-hover measurement (pure hover, no drag): while a
  // selection exists, holding Alt and hovering another frame/draft shows red
  // edge-to-edge distance lines + px labels between the selection's bounds
  // and the hovered object's bounds. Tracked as a single nullable value
  // (rather than per-frame) since only one hover target is ever measured at
  // a time; the equality bail keeps this from re-rendering every raw
  // mousemove when the computed measurement hasn't actually changed.
  const [altHoverMeasurement, setAltHoverMeasurementRaw] =
    useState<AltHoverMeasurement | null>(null);
  const setAltHoverMeasurement = useCallback(
    (next: AltHoverMeasurement | null) => {
      setAltHoverMeasurementRaw((current) =>
        altHoverMeasurementEqual(current, next) ? current : next,
      );
    },
    [],
  );
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
  // Mirrors the `vectorEdit` prop so long-lived mousemove/mouseup closures
  // created at drag-start (beginVectorAnchorDrag/beginVectorHandleDrag) always
  // read the current path/onChange even if the prop identity changes mid-drag
  // (e.g. a re-render from the preview onChange itself), rather than closing
  // over a snapshot from the moment the drag began.
  const vectorEditRef = useRef(vectorEdit);

  // Cross-screen element drag state — driven by postMessage from the source iframe.
  interface CrossScreenDragGhost {
    /** Board-space point where the ghost is shown (follows the cursor). */
    boardX: number;
    boardY: number;
    width?: number;
    height?: number;
    dimmed?: boolean;
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
  // OS file drag-over highlight (Figma parity §1): id of the screen frame
  // currently under a native OS file drag, or "" for "over the board/empty
  // canvas" (no frame). null means no drag is in progress. rAF-throttled in
  // the dragover handler below so a fast-moving drag never re-renders faster
  // than a frame, matching the wheel/pinch "never re-render mid-gesture"
  // discipline used elsewhere in this component (though a dragover highlight
  // is comparatively cheap — it's a single id, not a full view commit).
  const [fileDragOverFrameId, setFileDragOverFrameId] = useState<string | null>(
    null,
  );
  const fileDragOverFrameRef = useRef<string | null>(null);
  const fileDragDepthRef = useRef(0);
  const fileDragRafRef = useRef<number | null>(null);
  const pendingFileDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const [crossScreenDropGuide, setCrossScreenDropGuide] =
    useState<CrossScreenDropGuide | null>(null);
  const [crossScreenSourceIsBoard, setCrossScreenSourceIsBoard] =
    useState(false);
  /** Ref kept in sync with state so the message handler can read without closures. */
  const crossScreenTargetRef = useRef<CrossScreenDragTarget | null>(null);
  const crossScreenHitTestSeqRef = useRef(0);
  const crossScreenPreviewTargetIdRef = useRef<string | null>(null);
  /** The most-recent drag message payload — kept for use in the "end" handler. */
  const crossScreenDragMsgRef = useRef<{
    selector: string;
    sourceId?: string;
    sourcePointerOffset?: Point;
    sourceElementSize?: { width: number; height: number };
    styleSnapshot?: PortableStyleSnapshot;
  } | null>(null);
  const crossScreenParentDragCleanupRef = useRef<(() => void) | null>(null);
  /** Board-space point from the last cross-screen-drag "move" message. */
  const crossScreenLastBoardPointRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  /** rAF handle for throttling drop-guide hit-tests during the parent-window
   *  mousemove fallback drag (see activateParentDrag) — a hit-test is a
   *  postMessage round-trip to the target iframe, so firing one per raw
   *  mousemove event (which can be dozens per frame) floods the message
   *  channel for no visual benefit beyond one update per animation frame. */
  const crossScreenMoveRafRef = useRef<number | null>(null);
  const crossScreenPendingMoveRef = useRef<{
    boardPoint: Point;
    sourceScreenId: string;
  } | null>(null);
  /** Last successful hit-test result per target screen id, so a timed-out
   *  request (bridge script briefly busy, iframe still loading, etc.) can
   *  fall back to the previous guide instead of resolving empty and making
   *  the drop guide flicker away every time a single hit-test is slow. */
  const crossScreenLastHitResultRef = useRef<
    Map<string, CrossScreenHitTestResult>
  >(new Map());
  const onCrossScreenElementDropRef = useRef(onCrossScreenElementDrop);
  const onBoardDrawPrimitiveRef = useRef(onBoardDrawPrimitive);
  // Ref wrapper for finishDrag so callbacks declared before finishDrag can
  // reference it via the ref without hitting the const TDZ.
  const finishDragRef = useRef<() => void>(() => {});
  // Ref wrappers for applyViewToDom/scheduleViewCommit (defined later, near
  // the wheel/pinch gesture path) so beginPan — declared earlier — can reuse
  // the same imperative-transform-during-gesture pattern without a TDZ error.
  const applyViewToDomRef = useRef<() => void>(() => {});
  const scheduleViewCommitRef = useRef<
    (options?: { settleChrome?: boolean }) => void
  >(() => {});
  // Ref wrapper for recomputePenPointerForViewChange (P18, defined later
  // near updatePenPointer) so the external `zoom` prop sync effect —
  // declared earlier — can resync the pen ghost preview after an
  // externally-driven (toolbar/keyboard) zoom change without a TDZ error.
  const recomputePenPointerForViewChangeRef = useRef<() => void>(() => {});
  const suppressNextPick = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const pendingWheelGestureRef = useRef<PendingWheelGesture | null>(null);
  const wheelGestureFrameRef = useRef<number | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const pixelGridRef = useRef<HTMLDivElement>(null);
  const marqueeOverlayRef = useRef<HTMLSpanElement>(null);
  const viewCommitTimerRef = useRef<number | null>(null);
  // Tracks the last-applied cameraCommand.nonce so repeated renders (or a
  // caller re-passing the same command object) never re-run the fit — only a
  // genuine nonce change should move the camera.
  const lastCameraCommandNonceRef = useRef<number | null>(null);
  const pendingChromeSettleRef = useRef(false);
  const chromeSettleTimerRef = useRef<number | null>(null);
  const [chromeSettling, setChromeSettling] = useState(false);
  const previousPreviewDeviceFrameRef = useRef(previewDeviceFrame);
  // Overview viewport culling (PF22): every screen id that has ever
  // intersected the overscanned viewport this session. Once a screen id is
  // added it is never removed — a screen that becomes visible mounts real
  // content and stays mounted (as a hidden-but-live iframe when later culled
  // again), never regressing to the lightweight placeholder. A plain mutable
  // Set (not state) is intentional: membership is read-and-written together
  // with the rest of the per-render visibility computation below (see
  // screenCullTierById), not something that should itself trigger a
  // re-render — the geometry/pan/zoom changes that make a screen newly
  // visible already do that.
  const hasBeenVisibleScreenIdsRef = useRef<Set<string>>(new Set());

  // Track the pannable surface's own on-screen size for culling's viewport
  // bounds (getOverscannedViewportCanvasBounds). Only the surface's *size*
  // matters here (not scroll/position), since world-space bounds are derived
  // from pan/zoom separately — a plain ResizeObserver on the fixed-position
  // surface element is sufficient and avoids reading getBoundingClientRect on
  // every render.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const updateSize = (width: number, height: number) => {
      setSurfaceSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    const rect = surface.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      if (box) {
        updateSize(box.inlineSize, box.blockSize);
      } else {
        const contentRect = entry.contentRect;
        updateSize(contentRect.width, contentRect.height);
      }
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const claimKeyboardFocus = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== surface &&
      !surface.contains(active) &&
      isEditableHotkeyTarget(active)
    ) {
      active.blur();
    }
    surface.focus({ preventScroll: true });
  }, []);

  // Per-screen memoization of resolveScreenMetadata (PF20). resolveScreenMetadata
  // string-scans up to 4000 chars of content (deriveSource/derivePreviewState)
  // plus URL parsing on every call. getResolvedMetadata is invoked once per
  // screen on every canvasFrames/screenContentById rebuild, which previously
  // meant every screen on the board re-paid that scan on every rAF tick of an
  // unrelated screen's drag/resize. Cache the resolved result per screen id,
  // keyed on the actual inputs resolveScreenMetadata reads (screen identity/
  // content, the two metadata sources, and previewDeviceFrame) so an unchanged
  // screen is O(1) even while a sibling screen's geometry churns every frame.
  const resolvedMetadataCacheRef = useRef<
    Map<string, ResolvedMetadataCacheEntry>
  >(new Map());
  const getResolvedMetadata = useCallback(
    (screen: ScreenFile) =>
      resolveScreenMetadataCached(
        resolvedMetadataCacheRef.current,
        screen,
        metadataById?.[screen.id],
        getScreenMetadata?.(screen),
        previewDeviceFrame,
      ),
    [getScreenMetadata, metadataById, previewDeviceFrame],
  );

  // Per-screen entry-object reuse for canvasFrames (PF21) and per-screen
  // content-node cache for screenContentById (PF21). See the definitions of
  // canvasFrames/screenContentById below for the full invalidation-key
  // rationale; these refs hold the previous computation's per-screen state so
  // an unrelated screen's drag/resize tick can reuse both the frame entry
  // object and the rendered content ReactNode for every screen except the one
  // actually being manipulated.
  const canvasFrameEntryCacheRef = useRef<Map<string, CanvasFrameEntry>>(
    new Map(),
  );
  const screenContentCacheRef = useRef<Map<string, ScreenContentCacheEntry>>(
    new Map(),
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
    vectorEditRef.current = vectorEdit;
  }, [vectorEdit]);

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
      // Compute the next value from the ref (kept in sync below and by the
      // frameGeometry-mirroring effect) and call the onGeometryChange side
      // effect *after* setFrameGeometry, not inside the updater passed to
      // it. React (especially StrictMode, which double-invokes state
      // updaters to surface impure updates) may call an updater function
      // more than once per commit — doing the ref write + external callback
      // inside it would double-fire onGeometryChange for a single logical
      // geometry change.
      const next = updater(frameGeometryRef.current);
      frameGeometryRef.current = next;
      setFrameGeometry(next);
      onGeometryChangeRef.current?.(next);
    },
    [],
  );

  // PERF9: ref-only geometry write used by beginFrameDrag's live mousemove
  // tick. Mirrors the pan/zoom gesture's applyViewToDom/scheduleViewCommit
  // split — mutate the source of truth other reads depend on
  // (frameGeometryRef, so snap-against-stationary-entries and the
  // allCommitted/dropTarget checks keep seeing live positions) WITHOUT
  // setFrameGeometry, so a drag doesn't force a MultiScreenCanvas re-render
  // (and the canvasFrames/screenContentById/etc. useMemos it would
  // recompute) on every single rAF tick. React state is reconciled with one
  // real updateFrameGeometry call at gesture end (see beginFrameDrag's
  // handleMouseUp) — same "commit once" contract as the wheel/pinch path.
  const updateFrameGeometryRefOnly = useCallback(
    (updater: (current: FrameGeometryById) => FrameGeometryById) => {
      frameGeometryRef.current = updater(frameGeometryRef.current);
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

  // PERF9: ref-only counterpart to updateDraftPrimitives, used by
  // beginDraftDrag's live mousemove tick — see updateFrameGeometryRefOnly's
  // comment for the full rationale (same "mutate the ref/DOM now, commit
  // React state once at gesture end" discipline as the pan/zoom path).
  const updateDraftPrimitivesRefOnly = useCallback(
    (updater: (current: DraftPrimitive[]) => DraftPrimitive[]) => {
      draftPrimitivesRef.current = updater(draftPrimitivesRef.current);
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
    marqueeRef.current = marquee;
  }, [marquee]);

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

  // Selection is dual-controlled: it is synced FROM the `selectedScreenIds`
  // prop (see the prop-sync effect below) and CHANGES are reported back to the
  // parent. Reporting a selection that merely mirrors the prop would round-trip
  // through the parent (which re-derives/filters the ids) and, when two screens
  // are created back-to-back, ping-pong the selection between them forever
  // ("Maximum update depth exceeded" → the editor appears to refresh). Track
  // the last prop-driven selection and only report genuine, local (user-driven)
  // divergences from it.
  const propSyncedSelectionRef = useRef<string[] | null>(null);
  const isEchoOfPropSelection = useCallback(
    (ids: string[]) =>
      propSyncedSelectionRef.current !== null &&
      sameIds(ids, propSyncedSelectionRef.current),
    [],
  );

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    if (isEchoOfPropSelection(selectedIds)) return;
    onSelectionChangeRef.current?.(selectedIds);
  }, [isEchoOfPropSelection, selectedIds]);

  useEffect(() => {
    if (isEchoOfPropSelection(selectedIds)) return;
    onScreenSelectionChange?.(selectedIds);
  }, [isEchoOfPropSelection, onScreenSelectionChange, selectedIds]);

  useEffect(() => {
    draftPrimitivesRef.current = draftPrimitives;
  }, [draftPrimitives]);

  useEffect(() => {
    selectedDraftIdsRef.current = selectedDraftIds;
  }, [selectedDraftIds]);

  useEffect(() => {
    // zoomRef.current is the canvas's own last-known zoom, kept in sync
    // synchronously by every internal zoom path (wheel/pinch commitView,
    // fit-to-screen) *before* those paths call onZoomChange. So if it
    // already matches the incoming prop, this change originated from our own
    // gesture round-tripping back through a controlled `zoom` prop — that
    // path already applied its own (cursor-anchored) pan compensation, and
    // redoing it here with a surface-center anchor would double-shift pan.
    // Only compensate when this is a genuinely external change (toolbar
    // buttons, keyboard shortcuts) that never touched zoomRef/panRef.
    const previousZoom = zoomRef.current;
    if (zoom === previousZoom) return;
    // External zoom changes otherwise anchor at world origin (0,0) since
    // only canvasZoom is updated here — content visibly jumps diagonally
    // instead of zooming in place. Mirror the wheel/pinch cursor-anchored
    // compensation using the surface's own center as the anchor, since
    // there's no cursor position for a toolbar/keyboard-driven zoom change.
    //
    // Exception: DesignEditor derives its overview "default zoom" from the
    // *reference* screen's own canvas width (getOverviewZoomScale — the
    // active file if one is open, else the first selected screen, else the
    // first screen on the board), so the `zoom` prop can also jump purely
    // because a differently-sized frame became the reference — not from any
    // user zoom gesture. Anchoring that kind of jump at the surface center
    // flings that frame off-screen: a small hand-drawn frame paired with a
    // large zoom-scale correction can produce a multi-hundred-percent zoom
    // delta, and re-centering on a point that has nothing to do with the
    // frame amplifies that into hundreds of world pixels of pan error.
    // `activeId` alone isn't enough here: it mirrors DesignEditor's
    // `activeFileId`, which is only set once a screen is opened for
    // *editing* — immediately after drawing a new frame with the frame tool
    // in overview mode, the new screen is *selected* (selectedIds) but not
    // "active" yet, and DesignEditor's own zoom-scale reference falls back
    // to the first selected/first-on-board screen in that case. Mirror the
    // same fallback chain so the anchor matches whichever frame actually
    // drove the zoom-scale recompute.
    const referenceId = activeId ?? selectedIds[0] ?? screens[0]?.id;
    const rect = surfaceRef.current?.getBoundingClientRect();
    // Prefer the `geometryById` prop over `frameGeometryRef` here: a screen
    // just created by the frame tool has its geometry committed straight
    // into the parent's persisted map (DesignEditor's
    // writeFrameGeometrySnapshot) in the same commit that flips `activeId`/
    // bumps `zoom` — but frameGeometryRef only gets that same geometry
    // written by a separate effect declared *after* this one (see the
    // `screens`/`geometryById` sync effect below), so it can still be one
    // commit stale for a screen that only just appeared. `geometryById` is a
    // plain prop with no such lag. Only trust it when it already carries a
    // full width/height (it's typed as Partial since a caller could pass a
    // partial override) — otherwise fall back to the ref, which is complete
    // for every screen that has rendered at least once.
    const persistedGeometry = referenceId
      ? geometryById?.[referenceId]
      : undefined;
    const activeGeometry: FrameGeometry | undefined =
      persistedGeometry &&
      typeof persistedGeometry.x === "number" &&
      typeof persistedGeometry.y === "number" &&
      typeof persistedGeometry.width === "number" &&
      typeof persistedGeometry.height === "number"
        ? (persistedGeometry as FrameGeometry)
        : referenceId
          ? frameGeometryRef.current[referenceId]
          : undefined;
    const cursor = activeGeometry
      ? canvasToScreenPoint(
          {
            x: activeGeometry.x + activeGeometry.width / 2,
            y: activeGeometry.y + activeGeometry.height / 2,
          },
          { x: panRef.current.x, y: panRef.current.y, zoom: previousZoom },
          { x: 0, y: 0 },
          SURFACE_PADDING,
        )
      : rect
        ? { x: rect.width / 2, y: rect.height / 2 }
        : { x: 0, y: 0 };
    const nextPan = getPanForZoomToCursor({
      pan: panRef.current,
      cursor,
      oldZoom: previousZoom,
      nextZoom: zoom,
    });
    panRef.current = nextPan;
    setPan(nextPan);
    setCanvasZoom(zoom);
    zoomRef.current = zoom;
    // P18: an externally-driven zoom change (toolbar/keyboard) also moves
    // the canvas-space mapping the pen ghost preview was computed from.
    recomputePenPointerForViewChangeRef.current();
  }, [zoom, activeId]);

  useEffect(() => {
    const currentIds = new Set(screens.map((screen) => screen.id));
    // B5-9: see resolveFrameGeometrySync's doc comment — this used to notify
    // the parent (onGeometryChange -> queueFrameGeometrySave) with a brand
    // new screen's disposable getInitialFrameGeometry() fallback before its
    // real persisted geometry round-tripped back, clobbering an in-flight
    // caller save (e.g. DesignEditor's handleDuplicateScreen) that shares
    // the same debounce timer.
    const { next, changed, shouldNotifyParent } = resolveFrameGeometrySync({
      screens: screens.map((screen) => ({
        id: screen.id,
        metadata: getResolvedMetadata(screen),
      })),
      currentGeometryById: frameGeometryRef.current,
      persistedGeometryById: geometryById,
    });

    if (changed) {
      if (shouldNotifyParent) {
        updateFrameGeometry(() => next);
      } else {
        updateFrameGeometryRefOnly(() => next);
        setFrameGeometry(next);
      }
    }
    updateSelectedIds((current) => {
      const next = current.filter((id) => currentIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [
    geometryById,
    getResolvedMetadata,
    screens,
    updateFrameGeometry,
    updateFrameGeometryRefOnly,
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
    // Remember the selection we're pushing in from the parent so the report
    // effects above can recognise (and not echo back) the resulting change.
    propSyncedSelectionRef.current = selectedScreenIds;
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

  // Center the lineup when the screen footprint changes so new frames stay reachable.
  useEffect(() => {
    const deviceFrameChanged =
      lineupRecenterDeviceFrameRef.current !== previewDeviceFrame;
    lineupRecenterDeviceFrameRef.current = previewDeviceFrame;
    const previousCount = lineupRecenterPrevCountRef.current;
    lineupRecenterPrevCountRef.current = screens.length;
    // Screen-count decreases (delete, undo of a duplicate) never recenter —
    // see isLineupShrinkOnlyChange.
    if (
      isLineupShrinkOnlyChange({
        previousCount,
        screenCount: screens.length,
        deviceFrameChanged,
      })
    ) {
      return;
    }
    // A duplicate (alt-drag drop or Cmd+D) placed the new screen(s)
    // deliberately: keep the camera still for exactly those screen-count
    // transitions (see shouldSuppressLineupRecenter's doc for what this must
    // NOT affect).
    const armed = lineupRecenterSuppressRef.current;
    if (
      shouldSuppressLineupRecenter({
        armed,
        nowMs: Date.now(),
        screenCount: screens.length,
        deviceFrameChanged,
      })
    ) {
      // Disarm only once every dispatched clone has landed — a multi-frame
      // Cmd+D's duplicates arrive one create-file round-trip at a time.
      if (armed && screens.length >= armed.fromCount + armed.addedCount) {
        lineupRecenterSuppressRef.current = null;
      }
      return;
    }
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
    // The lineup's own world-space origin — NOT necessarily (0, 0). A frame
    // drawn with the frame tool can land anywhere in world space (including
    // negative x/y, e.g. dragged near wherever the camera happened to be
    // panned), so the pan below must shift by this origin too, not just
    // center a lineup-sized box as if it always started at the world
    // origin. Omitting this previously caused the "solid black overview
    // canvas" bug: this effect would compute a scale/pan pair that assumed
    // the new frame sat at (0, 0), landing the pan hundreds of world px away
    // from where the frame actually was whenever its real x/y was nonzero.
    const boundsLeft = bounds?.left ?? 0;
    const boundsTop = bounds?.top ?? 0;
    // Leave a Figma-like board gutter beside the last frame for quick drops/draws,
    // and fit tall single frames so lower canvas interactions remain reachable.
    const widthFitScale =
      screens.length > 1 && totalWidth > 0
        ? Math.max(0.1, (rect.width - 180) / totalWidth)
        : scale;
    const heightFitScale =
      totalHeight > 0 ? Math.max(0.1, (rect.height - 96) / totalHeight) : scale;
    const nextScale = Math.min(scale, widthFitScale, heightFitScale);
    if (nextScale < scale) {
      const nextZoom = nextScale * 100;
      zoomRef.current = nextZoom;
      setCanvasZoom(nextZoom);
      onZoomChange?.(nextZoom);
    }
    const visualLeft = Math.max(24, (rect.width - totalWidth * nextScale) / 2);
    const visualTop = Math.max(24, (rect.height - totalHeight * nextScale) / 2);
    const nextPan = {
      x: visualLeft - (SURFACE_PADDING + boundsLeft) * nextScale,
      y: visualTop - (SURFACE_PADDING + boundsTop) * nextScale,
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
      // PERF9-WHEEL: unmounting mid-gesture means the settled commitView
      // never runs — don't leave the module-scoped gesture flag stuck (the
      // muted elements unmount with the canvas, so no style restore needed).
      // Clears unconditionally (single-canvas-instance assumption — see the
      // module-scope doc comment on wheelCameraGestureActive above).
      wheelGestureActiveRef.current = false;
      wheelCameraGestureActive = false;
      wheelGestureMutedElementsRef.current = null;
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
    (point: Point) => findTopFrameEntryAtPoint(getCurrentFrameEntries(), point),
    [getCurrentFrameEntries],
  );

  // Mirrors getFrameEntryAtPoint above, but hit-tests draft primitives
  // instead of committed screens/frames — used by the alt-hover measurement
  // (Figma parity) so hovering an uncommitted draft while a selection exists
  // still shows distance lines.
  const getDraftEntryAtPoint = useCallback(
    (point: Point) =>
      getCurrentDraftEntries()
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
    [getCurrentDraftEntries],
  );

  // ── OS file drag-and-drop (Figma parity §1) ───────────────────────────────
  // Dragging image files from the OS onto the canvas places them at the
  // cursor; over a screen frame they should be inserted INTO that frame at
  // local coords. This component only resolves WHERE the drop landed
  // (canvas point + optional frame id) and reports it via onDropFiles — file
  // reading/upload/insert is the caller's job (DesignEditor's paste-image
  // pipeline), matching how onCreatePrimitive/onBoardDrawPrimitive already
  // separate "what happened on the canvas" from "how the app persists it".
  const applyFileDragHighlight = useCallback((frameId: string | null) => {
    if (fileDragOverFrameRef.current === frameId) return;
    fileDragOverFrameRef.current = frameId;
    setFileDragOverFrameId(frameId);
  }, []);

  const clearFileDragState = useCallback(() => {
    fileDragDepthRef.current = 0;
    pendingFileDragPointRef.current = null;
    if (fileDragRafRef.current !== null) {
      window.cancelAnimationFrame(fileDragRafRef.current);
      fileDragRafRef.current = null;
    }
    applyFileDragHighlight(null);
  }, [applyFileDragHighlight]);

  const flushFileDragHighlight = useCallback(() => {
    fileDragRafRef.current = null;
    const point = pendingFileDragPointRef.current;
    if (!point) return;
    const canvasPoint = getCanvasPoint(point.x, point.y);
    const frame = getFrameEntryAtPoint(canvasPoint);
    applyFileDragHighlight(frame ? frame.id : "");
  }, [applyFileDragHighlight, getCanvasPoint, getFrameEntryAtPoint]);

  const handleCanvasDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDrag(e)) return;
      e.preventDefault();
      fileDragDepthRef.current += 1;
    },
    [],
  );

  const handleCanvasDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      // rAF-throttle: dragover fires continuously (often faster than one per
      // frame) while the pointer moves. Only the hit-test + potential
      // setState should be throttled — preventDefault/dropEffect above must
      // run on every event or the browser shows the "no-drop" cursor.
      pendingFileDragPointRef.current = { x: e.clientX, y: e.clientY };
      if (fileDragRafRef.current === null) {
        fileDragRafRef.current = window.requestAnimationFrame(
          flushFileDragHighlight,
        );
      }
    },
    [flushFileDragHighlight],
  );

  const handleCanvasDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDrag(e)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) clearFileDragState();
    },
    [clearFileDragState],
  );

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isOsFileDrag(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files ?? []);
      clearFileDragState();
      if (files.length === 0 || !onDropFiles) return;
      const canvasPoint = getCanvasPoint(e.clientX, e.clientY);
      const frame = getFrameEntryAtPoint(canvasPoint);
      onDropFiles(files, {
        canvasPoint,
        frameId: frame?.id,
      });
    },
    [clearFileDragState, getCanvasPoint, getFrameEntryAtPoint, onDropFiles],
  );

  useEffect(() => clearFileDragState, [clearFileDragState]);

  // ── Cross-screen element drag receiver ────────────────────────────────────
  // The source iframe (the active interactive screen) posts
  // { type: "agent-native:cross-screen-drag", phase, selector, sourceId,
  //   iframeX, iframeY, viewportW, viewportH }
  // during element drags that the bridge wants the host to handle.
  useEffect(() => {
    if (!onCrossScreenElementDrop) return;

    const clearCrossScreenDropGuide = () => {
      crossScreenHitTestSeqRef.current += 1;
      setCrossScreenDropGuide(null);
    };

    const postHitTestPreviewClear = (targetId: string | null | undefined) => {
      if (!targetId) return;
      const targetScreen = screensRef.current.find((s) => s.id === targetId);
      const iframeId = targetScreen
        ? getActiveScreenIframeId(targetScreen)
        : targetId;
      const targetIframe = surfaceRef.current?.querySelector<HTMLIFrameElement>(
        `[data-screen-iframe-id="${CSS.escape(iframeId)}"]`,
      );
      targetIframe?.contentWindow?.postMessage(
        { type: "agent-native:hit-test-preview-clear" },
        "*",
      );
    };

    const clearCrossScreenPreviewGuide = (
      targetId?: string | null | undefined,
    ) => {
      const id = targetId ?? crossScreenPreviewTargetIdRef.current;
      postHitTestPreviewClear(id);
      if (!targetId || targetId === crossScreenPreviewTargetIdRef.current) {
        crossScreenPreviewTargetIdRef.current = null;
      }
    };

    const stopParentCrossScreenDrag = () => {
      crossScreenParentDragCleanupRef.current?.();
      crossScreenParentDragCleanupRef.current = null;
    };

    const clearCrossScreenDrag = () => {
      stopParentCrossScreenDrag();
      clearCrossScreenPreviewGuide();
      setCrossScreenGhost(null);
      setCrossScreenTarget(null);
      setCrossScreenSourceIsBoard(false);
      clearCrossScreenDropGuide();
      crossScreenTargetRef.current = null;
      crossScreenDragMsgRef.current = null;
      // Drop the timeout-fallback cache so a future, unrelated drag session
      // never shows a guide left over from this one.
      crossScreenLastHitResultRef.current.clear();
    };

    // Single source of truth for a target screen's "viewport" dimensions used
    // to scale board<->iframe coordinates. MUST prefer the iframe's live
    // clientWidth/clientHeight over resolveScreenMetadata's DEFAULTED
    // 1280x2560 fallback (used for screens — e.g. duplicated screens — with
    // no screenMetadata entry in designs.data). runHitTest and
    // getTargetLocalPoint already did this correctly; requestCrossScreenDropGuide
    // previously called getResolvedMetadata directly with no iframe fallback,
    // so the drawn guide used different (often wrong-by-4x) geometry than the
    // hit-test that produced it — guides rendered squashed/mispositioned for
    // any screen missing metadata. Centralizing here keeps all three call
    // sites in sync going forward.
    const getTargetViewportMetadata = (
      targetScreen: (typeof screensRef.current)[number],
      targetIframe: HTMLIFrameElement | null | undefined,
    ): { width: number; height: number } => ({
      width:
        targetIframe?.clientWidth || getResolvedMetadata(targetScreen).width,
      height:
        targetIframe?.clientHeight || getResolvedMetadata(targetScreen).height,
    });

    const runHitTest = (
      candidate: CrossScreenDragTarget,
      boardPoint: Point,
      options: { preview?: boolean } = {},
    ): Promise<CrossScreenHitTestResult> => {
      const targetScreen = screensRef.current.find(
        (s) => s.id === candidate.id,
      );
      if (!targetScreen) return Promise.resolve({});
      const targetGeometry = candidate.geometry;
      const targetIframeId = CSS.escape(getActiveScreenIframeId(targetScreen));
      const targetIframe = surfaceRef.current?.querySelector<HTMLIFrameElement>(
        `[data-screen-iframe-id="${targetIframeId}"]`,
      );
      const targetContentWindow = targetIframe?.contentWindow;
      if (!targetContentWindow) return Promise.resolve({});
      const { width: targetViewportWidth, height: targetViewportHeight } =
        getTargetViewportMetadata(targetScreen, targetIframe);
      const scaleX = targetViewportWidth / Math.max(1, targetGeometry.width);
      const scaleY = targetViewportHeight / Math.max(1, targetGeometry.height);
      const localX = (boardPoint.x - targetGeometry.x) * scaleX;
      const localY = (boardPoint.y - targetGeometry.y) * scaleY;

      const correlationId = `hit-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", hitListener);
          // Fall back to the last successful result for this target instead
          // of resolving empty — a single slow reply (bridge script briefly
          // busy, iframe mid-navigation, etc.) shouldn't make the drop guide
          // flicker away and immediately reappear on the next hit-test.
          resolve(crossScreenLastHitResultRef.current.get(candidate.id) ?? {});
        }, 250);

        const hitListener = (ev: MessageEvent) => {
          if (
            !ev.data ||
            ev.data.type !== "agent-native:hit-test-result" ||
            ev.data.correlationId !== correlationId ||
            // Require the reply to actually come from the iframe we asked,
            // not just any window that happens to observe/guess the
            // correlationId and reply with a matching payload shape.
            ev.source !== targetContentWindow
          ) {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener("message", hitListener);
          const result: CrossScreenHitTestResult = {
            anchorNodeId:
              typeof ev.data.anchorNodeId === "string"
                ? ev.data.anchorNodeId
                : undefined,
            // Id-on-demand handshake passthrough (see the fields' doc
            // comments on CrossScreenHitTestResult): without these, drops
            // into id-less AI-generated screens can never flow-insert.
            pendingNodeId:
              typeof ev.data.pendingNodeId === "string" && ev.data.pendingNodeId
                ? ev.data.pendingNodeId
                : undefined,
            anchorSelector:
              typeof ev.data.anchorSelector === "string" &&
              ev.data.anchorSelector
                ? ev.data.anchorSelector
                : undefined,
            placement: isCrossScreenDropPlacement(ev.data.placement)
              ? ev.data.placement
              : undefined,
            axis: isCrossScreenDropAxis(ev.data.axis)
              ? ev.data.axis
              : undefined,
            dropMode: isCrossScreenDropMode(ev.data.dropMode)
              ? ev.data.dropMode
              : undefined,
            anchorRect: isCrossScreenHitTestAnchorRect(ev.data.anchorRect)
              ? ev.data.anchorRect
              : undefined,
          };
          crossScreenLastHitResultRef.current.set(candidate.id, result);
          resolve(result);
        };
        window.addEventListener("message", hitListener);

        targetContentWindow.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId,
            x: localX,
            y: localY,
            preview: options.preview === true,
          },
          "*",
        );
        if (options.preview) {
          crossScreenPreviewTargetIdRef.current = candidate.id;
        }
      });
    };

    const getTargetLocalPoint = (
      candidate: CrossScreenDragTarget,
      boardPoint: Point,
    ): Point | null => {
      if (candidate.id === boardFileId) return boardPoint;
      const targetScreen = screensRef.current.find(
        (s) => s.id === candidate.id,
      );
      if (!targetScreen) return null;
      const targetIframeId = CSS.escape(getActiveScreenIframeId(targetScreen));
      const targetIframe = surfaceRef.current?.querySelector<HTMLIFrameElement>(
        `[data-screen-iframe-id="${targetIframeId}"]`,
      );
      const { width: targetViewportWidth, height: targetViewportHeight } =
        getTargetViewportMetadata(targetScreen, targetIframe);
      const scaleX =
        targetViewportWidth / Math.max(1, candidate.geometry.width);
      const scaleY =
        targetViewportHeight / Math.max(1, candidate.geometry.height);
      return {
        x: (boardPoint.x - candidate.geometry.x) * scaleX,
        y: (boardPoint.y - candidate.geometry.y) * scaleY,
      };
    };

    const requestCrossScreenDropGuide = (
      candidate: CrossScreenDragTarget,
      boardPoint: Point,
    ) => {
      const requestSeq = ++crossScreenHitTestSeqRef.current;
      void runHitTest(candidate, boardPoint).then((hit) => {
        if (crossScreenHitTestSeqRef.current !== requestSeq) return;
        if (crossScreenTargetRef.current?.id !== candidate.id) return;
        const targetScreen = screensRef.current.find(
          (s) => s.id === candidate.id,
        );
        const targetIframeId = targetScreen
          ? CSS.escape(getActiveScreenIframeId(targetScreen))
          : null;
        const targetIframe = targetIframeId
          ? surfaceRef.current?.querySelector<HTMLIFrameElement>(
              `[data-screen-iframe-id="${targetIframeId}"]`,
            )
          : null;
        const guide = targetScreen
          ? getCrossScreenDropGuideForHitTest({
              hit,
              targetGeometry: candidate.geometry,
              targetMetadata: getTargetViewportMetadata(
                targetScreen,
                targetIframe,
              ),
            })
          : null;
        setCrossScreenDropGuide(guide);
      });
    };

    const updateCrossScreenTargetFromBoardPoint = (
      boardPoint: Point,
      sourceScreenId: string,
    ) => {
      crossScreenLastBoardPointRef.current = boardPoint;
      const sourceIsBoard = sourceScreenId === boardFileId;
      setCrossScreenSourceIsBoard(sourceIsBoard);
      const target = getFrameEntryAtPoint(boardPoint);
      if (target && target.id !== sourceScreenId) {
        const nextTarget = { id: target.id, geometry: target.geometry };
        if (crossScreenTargetRef.current?.id !== nextTarget.id) {
          clearCrossScreenPreviewGuide();
        }
        crossScreenTargetRef.current = nextTarget;
        setCrossScreenTarget(nextTarget);
        const dragPayload = crossScreenDragMsgRef.current;
        const sourceElementSize = dragPayload?.sourceElementSize;
        const sourcePointerOffset = dragPayload?.sourcePointerOffset;
        setCrossScreenGhost(
          sourceIsBoard && sourceElementSize && sourcePointerOffset
            ? {
                boardX: boardPoint.x - sourcePointerOffset.x,
                boardY: boardPoint.y - sourcePointerOffset.y,
                width: sourceElementSize.width,
                height: sourceElementSize.height,
                dimmed: true,
              }
            : sourceIsBoard
              ? null
              : { boardX: boardPoint.x, boardY: boardPoint.y },
        );
        requestCrossScreenDropGuide(nextTarget, boardPoint);
      } else {
        clearCrossScreenPreviewGuide();
        crossScreenTargetRef.current = null;
        setCrossScreenTarget(null);
        setCrossScreenGhost(
          sourceIsBoard ? null : { boardX: boardPoint.x, boardY: boardPoint.y },
        );
        clearCrossScreenDropGuide();
      }
    };

    const finalizeCrossScreenDrop = (
      sourceScreenId: string,
      candidate: CrossScreenDragTarget | null,
      payload: {
        selector: string;
        sourceId?: string;
        sourcePointerOffset?: Point;
        styleSnapshot?: PortableStyleSnapshot;
      },
      lastBoardPoint: Point | null,
    ) => {
      clearCrossScreenDrag();
      crossScreenLastBoardPointRef.current = null;
      const hasIdentifier = !!(payload.selector || payload.sourceId);
      if (!hasIdentifier || !sourceScreenId) return;
      if (!lastBoardPoint) return;
      const targetCandidate =
        candidate ??
        (boardFileId && sourceScreenId !== boardFileId && boardFrameGeometry
          ? { id: boardFileId, geometry: boardFrameGeometry }
          : null);
      if (!targetCandidate) return;

      if (targetCandidate.id === boardFileId) {
        onCrossScreenElementDropRef.current?.({
          sourceSelector: payload.selector,
          sourceNodeId: payload.sourceId,
          sourceScreenId,
          targetScreenId: targetCandidate.id,
          targetCanvasPoint: lastBoardPoint,
          targetLocalPoint: lastBoardPoint,
          sourcePointerOffset: payload.sourcePointerOffset,
          styleSnapshot: payload.styleSnapshot,
        });
        return;
      }

      void runHitTest(targetCandidate, lastBoardPoint).then(
        ({
          anchorNodeId,
          pendingNodeId,
          anchorSelector,
          placement,
          dropMode,
          anchorRect,
        }) => {
          const targetAnchorPlacement = isCrossScreenDropPlacement(placement)
            ? placement
            : undefined;
          const targetLocalPoint = getTargetLocalPoint(
            targetCandidate,
            lastBoardPoint,
          );
          onCrossScreenElementDropRef.current?.({
            sourceSelector: payload.selector,
            sourceNodeId: payload.sourceId,
            sourceScreenId,
            targetScreenId: targetCandidate.id,
            targetAnchorNodeId: anchorNodeId,
            // Id-on-demand handshake (CrossScreenHitTestResult doc): lets
            // the drop handler persist the minted pending id into the
            // stored dest document and flow-insert instead of silently
            // degrading to absolute placement on id-less screens.
            targetAnchorPendingNodeId: pendingNodeId,
            targetAnchorSelector: anchorSelector,
            targetAnchorPlacement,
            targetDropMode: dropMode,
            targetAnchorRect: anchorRect,
            targetCanvasPoint: lastBoardPoint,
            targetLocalPoint: targetLocalPoint ?? undefined,
            sourcePointerOffset: payload.sourcePointerOffset,
            styleSnapshot: payload.styleSnapshot,
          });
        },
      );
    };

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "agent-native:cross-screen-drag") {
        return;
      }
      // Resolve which of our own embedded design-preview iframes actually
      // posted this message — postMessage's origin/source aren't otherwise
      // checked here, so without this any window (including a spoofed one)
      // could claim to be a screen. Same pattern as
      // handleEmbeddedWheelMessage below. Bind to the matched iframe element
      // itself rather than trusting the payload: a compromised/owned preview
      // iframe can put any `screenId` it wants in the message body, so the
      // sender's true screen identity must come from the DOM, not the data.
      const surfaceForSourceCheck = surfaceRef.current;
      const sourcePreviewIframe = surfaceForSourceCheck
        ? Array.from(
            surfaceForSourceCheck.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            ),
          ).find((iframe) => iframe.contentWindow === event.source)
        : undefined;
      if (!sourcePreviewIframe) return;
      // The board's DesignCanvas renders with `boardSurface` set, which
      // deliberately omits `data-screen-iframe-id` (see DesignCanvas.tsx), so
      // an unset attribute here means the message came from the board
      // surface iframe rather than a per-screen one.
      const domScreenId =
        sourcePreviewIframe.getAttribute("data-screen-iframe-id") ??
        boardFileId ??
        undefined;
      const msg = event.data as {
        type: string;
        phase: "start" | "move" | "end" | "cancel";
        screenId?: string;
        selector?: string;
        sourceId?: string;
        iframeX?: number;
        iframeY?: number;
        viewportW?: number;
        viewportH?: number;
        elementRect?: CrossScreenDragElementRect;
        pointerOffset?: Point;
        styleSnapshot?: unknown;
      };
      const sourcePointerOffset = isFinitePoint(msg.pointerOffset)
        ? msg.pointerOffset
        : undefined;
      const sourceElementSize =
        msg.elementRect &&
        Number.isFinite(msg.elementRect.width) &&
        Number.isFinite(msg.elementRect.height) &&
        msg.elementRect.width > 0 &&
        msg.elementRect.height > 0
          ? { width: msg.elementRect.width, height: msg.elementRect.height }
          : undefined;
      const styleSnapshot = isPortableStyleSnapshot(msg.styleSnapshot)
        ? msg.styleSnapshot
        : undefined;

      if (msg.phase === "cancel") {
        clearCrossScreenDrag();
        return;
      }

      // Attribute the drag to the DOM-verified source iframe's own screen id,
      // never the payload's claimed `msg.screenId` — the message body is
      // authored by the (sandboxed but same-origin-capable) preview iframe
      // content and must not be trusted to identify itself. Fall back to
      // activeId only when the matched iframe unexpectedly has no resolvable
      // screen id (e.g. a stale/unknown screen), matching prior behavior for
      // that edge case.
      const sourceScreenId =
        domScreenId &&
        (domScreenId === boardFileId || frameGeometryRef.current[domScreenId])
          ? domScreenId
          : activeId;
      if (!sourceScreenId) {
        // Always clear visual state (ghost + highlight) when we have no active
        // screen to attribute the drag to — regardless of the phase. Without
        // this, a "move" message arriving after activeId became null would leave
        // stale ghost/target state visible on the canvas.
        clearCrossScreenDrag();
        return;
      }

      if (msg.phase === "start") {
        setCrossScreenSourceIsBoard(sourceScreenId === boardFileId);
        crossScreenDragMsgRef.current = {
          selector: msg.selector ?? "",
          sourceId: msg.sourceId,
          sourcePointerOffset,
          sourceElementSize,
          styleSnapshot,
        };
        stopParentCrossScreenDrag();
        const restorePreviewPointerEvents = mutePreviewIframePointerEvents(
          surfaceRef.current,
        );
        let didCleanup = false;
        const cancelPendingParentDrag = () => {
          if (crossScreenMoveRafRef.current !== null) {
            window.cancelAnimationFrame(crossScreenMoveRafRef.current);
            crossScreenMoveRafRef.current = null;
          }
          crossScreenPendingMoveRef.current = null;
        };
        const flushPendingParentDrag = () => {
          crossScreenMoveRafRef.current = null;
          const pending = crossScreenPendingMoveRef.current;
          crossScreenPendingMoveRef.current = null;
          if (!pending) return;
          updateCrossScreenTargetFromBoardPoint(
            pending.boardPoint,
            pending.sourceScreenId,
          );
        };
        const activateParentDrag = (ev: MouseEvent) => {
          ev.preventDefault();
          updateCrossScreenTargetFromBoardPoint(
            getCanvasPoint(ev.clientX, ev.clientY),
            sourceScreenId,
          );
        };
        const handleParentMouseMove = (ev: MouseEvent) => {
          ev.preventDefault();
          // Each drop-guide update is a postMessage round-trip to the target
          // iframe (see requestCrossScreenDropGuide/runHitTest). Coalesce
          // rapid mousemove events down to one hit-test per animation frame
          // instead of firing one per raw event.
          crossScreenPendingMoveRef.current = {
            boardPoint: getCanvasPoint(ev.clientX, ev.clientY),
            sourceScreenId,
          };
          if (crossScreenMoveRafRef.current === null) {
            crossScreenMoveRafRef.current = window.requestAnimationFrame(
              flushPendingParentDrag,
            );
          }
        };
        const handleParentMouseUp = (ev: MouseEvent) => {
          // Flush synchronously with the true final pointer position on
          // release — don't wait for a throttled rAF that may not run
          // before finalizeCrossScreenDrop reads crossScreenTargetRef.
          cancelPendingParentDrag();
          activateParentDrag(ev);
          const candidate = crossScreenTargetRef.current;
          const payload = crossScreenDragMsgRef.current ?? {
            selector: msg.selector ?? "",
            sourceId: msg.sourceId,
            sourcePointerOffset,
            sourceElementSize,
            styleSnapshot,
          };
          const lastBoardPoint = crossScreenLastBoardPointRef.current;
          finalizeCrossScreenDrop(
            sourceScreenId,
            candidate,
            payload,
            lastBoardPoint,
          );
        };
        const handleParentWindowBlur = () => {
          cancelPendingParentDrag();
          clearCrossScreenDrag();
        };
        const cleanup = () => {
          if (didCleanup) return;
          didCleanup = true;
          cancelPendingParentDrag();
          window.removeEventListener("mousemove", handleParentMouseMove, true);
          window.removeEventListener("mouseup", handleParentMouseUp, true);
          window.removeEventListener("blur", handleParentWindowBlur, true);
          restorePreviewPointerEvents();
          if (crossScreenParentDragCleanupRef.current === cleanup) {
            crossScreenParentDragCleanupRef.current = null;
          }
        };
        crossScreenParentDragCleanupRef.current = cleanup;
        window.addEventListener("mousemove", handleParentMouseMove, true);
        window.addEventListener("mouseup", handleParentMouseUp, true);
        window.addEventListener("blur", handleParentWindowBlur, true);
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
        //
        // Pointer-offset pin fix: the bridge recomputes `pointerOffset` on
        // EVERY "move" post from the dragged element's CURRENT
        // getBoundingClientRect — which keeps changing while a flow-reorder
        // drag live-reorders the source element under the still-in-bounds
        // pointer. Letting a later move's offset win (the previous `??`
        // fallback here never actually engaged, since the bridge always
        // supplies a value) made the eventual screen->canvas drop land at
        // `boardPoint - (whatever slot the element occupied at the LAST
        // in-source tick)` instead of the true press-time grab offset,
        // drifting the landing position by up to the element's own size.
        // Figma keeps the grab point pixel-pinned under the cursor for the
        // whole gesture — so once "start" has captured a pointer offset,
        // never let a "move" message's (re-derived, drifting) offset
        // override it; only fall back to a move-supplied offset on the rare
        // path where "start" itself didn't have one yet.
        crossScreenDragMsgRef.current = {
          selector: selector ?? "",
          sourceId,
          sourcePointerOffset:
            crossScreenDragMsgRef.current?.sourcePointerOffset ??
            sourcePointerOffset,
          sourceElementSize:
            sourceElementSize ??
            crossScreenDragMsgRef.current?.sourceElementSize,
          styleSnapshot:
            styleSnapshot ?? crossScreenDragMsgRef.current?.styleSnapshot,
        };

        const pointerInsideSourceIframe =
          iframeX >= 0 &&
          iframeY >= 0 &&
          iframeX <= viewportW &&
          iframeY <= viewportH;
        const sourceIsBoard = sourceScreenId === boardFileId;
        // Regular screen iframes are finite artboards, so an in-bounds pointer
        // means the source bridge should keep handling the drag. The board
        // iframe is different: it spans the whole overview canvas, including
        // every screen frame, so board-origin drags must still be checked
        // against screen drop targets while technically "inside" the source.
        if (pointerInsideSourceIframe && !sourceIsBoard) {
          clearCrossScreenPreviewGuide();
          setCrossScreenGhost(null);
          setCrossScreenTarget(null);
          setCrossScreenSourceIsBoard(false);
          crossScreenTargetRef.current = null;
          crossScreenLastBoardPointRef.current = null;
          clearCrossScreenDropGuide();
          return;
        }

        // Translate iframe coords → board coords using the live embedded
        // viewport from the bridge. In overview, the iframe viewport may be the
        // frame geometry rather than the screen metadata width.

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
          const scaleX = sourceGeometry.width / Math.max(1, viewportW);
          const scaleY = sourceGeometry.height / Math.max(1, viewportH);
          boardX = sourceGeometry.x + iframeX * scaleX;
          boardY = sourceGeometry.y + iframeY * scaleY;
        }
        const boardPoint = { x: boardX, y: boardY };
        updateCrossScreenTargetFromBoardPoint(boardPoint, sourceScreenId);
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
          sourcePointerOffset,
          sourceElementSize,
          styleSnapshot,
        };
        const lastBoardPoint = crossScreenLastBoardPointRef.current;
        finalizeCrossScreenDrop(
          sourceScreenId,
          candidate,
          payload,
          lastBoardPoint,
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      stopParentCrossScreenDrag();
      window.removeEventListener("message", handleMessage);
    };
  }, [
    activeId,
    boardFileId,
    boardFrameGeometry,
    getFrameEntryAtPoint,
    getCanvasPoint,
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
      // rAF-coalesce raw mousemove: a drag/pan/marquee gesture can fire many
      // mousemove events per frame, but the handler recomputes snap/geometry
      // and commits React state — doing that per-event (rather than per
      // frame) is the dominant cost during a drag (see PF15 in perf report).
      // We keep only the latest event and flush it once per animation frame
      // (latest-wins). Flushing is forced synchronously before mouseup/blur
      // so the gesture always ends on the true final pointer position.
      let pendingMoveFrame: number | null = null;
      const flushPendingMove = () => {
        if (pendingMoveFrame !== null) {
          window.cancelAnimationFrame(pendingMoveFrame);
          pendingMoveFrame = null;
        }
        if (lastMouseEvent) {
          handleMouseMove(lastMouseEvent);
        }
      };
      const move = (ev: MouseEvent) => {
        lastMouseEvent = ev;
        ev.preventDefault();
        if (pendingMoveFrame !== null) return;
        pendingMoveFrame = window.requestAnimationFrame(() => {
          pendingMoveFrame = null;
          if (lastMouseEvent) handleMouseMove(lastMouseEvent);
        });
      };
      const up = (ev: MouseEvent) => {
        lastMouseEvent = ev;
        ev.preventDefault();
        // Flush any coalesced move first so the final drop position reflects
        // this exact event, then run the up handler with it.
        flushPendingMove();
        handleMouseUp(ev);
      };
      const cleanupOnBlur = () => {
        if (handleCancel) {
          if (pendingMoveFrame !== null) {
            window.cancelAnimationFrame(pendingMoveFrame);
            pendingMoveFrame = null;
          }
          handleCancel();
          return;
        }
        flushPendingMove();
        handleMouseUp(lastMouseEvent ?? new MouseEvent("mouseup"));
      };
      dragCleanup.current = () => {
        if (pendingMoveFrame !== null) {
          window.cancelAnimationFrame(pendingMoveFrame);
          pendingMoveFrame = null;
        }
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

  const requestSelectableElementInfos = useCallback(
    (screenId: string): Promise<ElementInfo[]> => {
      const targetScreen = screensRef.current.find((s) => s.id === screenId);
      const iframeId = targetScreen
        ? getActiveScreenIframeId(targetScreen)
        : screenId;
      const targetIframe = surfaceRef.current?.querySelector<HTMLIFrameElement>(
        `[data-screen-iframe-id="${CSS.escape(iframeId)}"]`,
      );
      const targetContentWindow = targetIframe?.contentWindow;
      if (!targetContentWindow) return Promise.resolve([]);
      const correlationId = `rects-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", listener);
          resolve([]);
        }, 80);
        const listener = (event: MessageEvent) => {
          if (
            !event.data ||
            event.data.type !== "agent-native:selectable-rects-result" ||
            event.data.correlationId !== correlationId ||
            // Require the reply to actually come from the iframe we asked,
            // not just any window that happens to observe/guess the
            // correlationId and reply with a matching payload shape.
            event.source !== targetContentWindow
          ) {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener("message", listener);
          const payload: unknown[] = Array.isArray(event.data.payload)
            ? event.data.payload
            : [];
          resolve(
            payload.filter((item): item is ElementInfo => {
              if (!item || typeof item !== "object") return false;
              const candidate = item as Partial<ElementInfo>;
              return (
                typeof candidate.tagName === "string" &&
                !!candidate.boundingRect &&
                typeof candidate.boundingRect.width === "number" &&
                typeof candidate.boundingRect.height === "number"
              );
            }),
          );
        };
        window.addEventListener("message", listener);
        targetContentWindow.postMessage(
          { type: "agent-native:collect-selectable-rects", correlationId },
          "*",
        );
      });
    },
    [],
  );

  /** Collects marquee-selectable layer candidates. Each screen requires an
   *  async postMessage round-trip into its iframe (requestSelectableElementInfos),
   *  so collecting for every screen on the board unconditionally at marquee
   *  mousedown (PF20) is expensive for boards with many screens — most of
   *  which the marquee rect will never touch. `screenIds`, when given, scopes
   *  collection to just those frame entries (plus the board, which spans the
   *  whole surface so it's included whenever explicitly requested); omit it
   *  to collect every screen. */
  const collectLayerMarqueeCandidates = useCallback(
    async (screenIds?: Set<string>) => {
      const frameEntries = getCurrentFrameEntries().filter(
        (entry) => !screenIds || screenIds.has(entry.id),
      );
      const frameCandidates = await Promise.all(
        frameEntries.map(async (entry) => {
          const screen = screensRef.current.find(
            (item) => item.id === entry.id,
          );
          if (!screen) return [] as CanvasLayerMarqueeCandidate[];
          const iframe = surfaceRef.current?.querySelector<HTMLIFrameElement>(
            `[data-screen-iframe-id="${CSS.escape(getActiveScreenIframeId(screen))}"]`,
          );
          const metadata = getResolvedMetadata(screen);
          const viewportWidth = iframe?.clientWidth || metadata.width;
          const viewportHeight = iframe?.clientHeight || metadata.height;
          const scaleX = entry.geometry.width / Math.max(1, viewportWidth);
          const scaleY = entry.geometry.height / Math.max(1, viewportHeight);
          const infos = await requestSelectableElementInfos(entry.id);
          return infos.map((info) => ({
            screenId: entry.id,
            info,
            geometry: {
              x: entry.geometry.x + info.boundingRect.x * scaleX,
              y: entry.geometry.y + info.boundingRect.y * scaleY,
              width: info.boundingRect.width * scaleX,
              height: info.boundingRect.height * scaleY,
            },
            frameGeometry: entry.geometry,
          }));
        }),
      );
      const boardCandidates =
        boardFileId &&
        boardFrameGeometry &&
        (!screenIds || screenIds.has(boardFileId))
          ? await (async () => {
              const infos = await requestSelectableElementInfos(boardFileId);
              return infos.map((info) => ({
                screenId: boardFileId,
                info,
                geometry: {
                  x: boardFrameGeometry.x + info.boundingRect.x,
                  y: boardFrameGeometry.y + info.boundingRect.y,
                  width: info.boundingRect.width,
                  height: info.boundingRect.height,
                },
                frameGeometry: boardFrameGeometry,
              }));
            })()
          : [];
      return [...frameCandidates.flat(), ...boardCandidates];
    },
    [
      boardFileId,
      boardFrameGeometry,
      getCurrentFrameEntries,
      getResolvedMetadata,
      requestSelectableElementInfos,
    ],
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
      const nextX = clampNumber(preferredX, TRANSFORM_BADGE_EDGE_PADDING, maxX);
      const nextY = clampNumber(preferredY, TRANSFORM_BADGE_EDGE_PADDING, maxY);
      // Equality-bail: called from the rAF-coalesced mousemove handler, so
      // this runs at most once per frame already, but a steady drag (e.g.
      // pinned against a snap axis) can still repeat the identical badge
      // text/position — skip the setState in that case (PF15).
      setTransformBadge((current) =>
        current &&
        current.text === text &&
        current.x === nextX &&
        current.y === nextY
          ? current
          : { text, x: nextX, y: nextY },
      );
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
      const screensForPrimitiveHitTest =
        boardFileId && boardFileContent !== undefined && boardFrameGeometry
          ? [
              ...screensRef.current,
              {
                id: boardFileId,
                filename: "__board__.html",
                content: boardFileContent,
              },
            ]
          : screensRef.current;
      const frameGeometryForPrimitiveHitTest =
        boardFileId && boardFrameGeometry
          ? {
              ...frameGeometryRef.current,
              [boardFileId]: boardFrameGeometry,
            }
          : frameGeometryRef.current;
      return getPrimitiveDropTargetForPoint(
        point,
        draggedNodeId,
        screensForPrimitiveHitTest,
        frameGeometryForPrimitiveHitTest,
        (screen) =>
          screen.id === boardFileId && boardFrameGeometry
            ? {
                width: Math.max(1, boardFrameGeometry.width),
                height: Math.max(1, boardFrameGeometry.height),
              }
            : getResolvedMetadata(screen),
        {
          identityCoordinateScreenIds: boardFileId
            ? new Set([boardFileId])
            : undefined,
        },
      );
    },
    [boardFileContent, boardFileId, boardFrameGeometry, getResolvedMetadata],
  );

  const resolvePrimitiveScreenId = useCallback(
    (nodeId: string): string | null => {
      const screensForPrimitiveLookup =
        boardFileId && boardFileContent !== undefined
          ? [
              ...screensRef.current,
              {
                id: boardFileId,
                filename: "__board__.html",
                content: boardFileContent,
              },
            ]
          : screensRef.current;
      return resolveNodeScreenId(nodeId, screensForPrimitiveLookup);
    },
    [boardFileContent, boardFileId],
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
    setEqualGapGuides([]);
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
      if (
        state.type === "move" ||
        state.type === "resize" ||
        state.type === "group-rotate"
      ) {
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
        const restoredPath = state.pathBefore
          ? clonePenPath(state.pathBefore)
          : null;
        activePenPathRef.current = restoredPath;
        setActivePenPath(restoredPath);
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
      } else if (
        state.type === "vector-anchor" ||
        state.type === "vector-handle"
      ) {
        // vectorEdit's path is parent-owned (unlike activePenPath above),
        // so reverting on cancel means reporting the pre-drag snapshot back
        // as a commit rather than mutating any local state here.
        vectorEdit?.onChange(clonePenPath(state.pathBefore), "commit");
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
    vectorEdit,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (cancelActiveDrag()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      // No in-flight drag to cancel: Escape while in vector edit mode exits
      // the mode entirely (matches Figma), rather than being a no-op.
      if (vectorEdit) {
        vectorEdit.onExit();
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [cancelActiveDrag, vectorEdit]);

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
        // Mirror the wheel/pinch path (applyViewToDom): mutate the transform
        // directly during the gesture and only reconcile React state once the
        // gesture settles, so a mouse-pan produces zero re-renders per move.
        applyViewToDomRef.current();
        scheduleViewCommitRef.current();
      };

      const handlePanEnd = () => {
        // Ensure React state reflects the true final pan immediately on
        // release rather than waiting for the debounced commit timer.
        setPan(panRef.current);
        // P18: a middle-mouse-button pan while a pen path is active also
        // moves the canvas-space mapping the ghost preview was computed
        // from — resync it now that pan has settled.
        recomputePenPointerForViewChangeRef.current();
        finishDrag();
      };

      installDragListeners(handleMouseMove, handlePanEnd);
    },
    [finishDrag, installDragListeners],
  );

  const beginMarquee = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const originCanvas = getCanvasPoint(e.clientX, e.clientY);
      let latestRect = normalizeRectFromPoints(originCanvas, originCanvas);
      let layerCandidates: CanvasLayerMarqueeCandidate[] = [];
      // PF20: collecting selectable layer info for every screen on the board
      // requires one async postMessage round-trip per iframe. Doing that
      // eagerly for the whole board on marquee mousedown is wasted work for
      // any screen the marquee rect never reaches. Instead, lazily collect
      // only screens the rect currently intersects, growing the collected
      // set incrementally as the drag expands the rect. `collectingScreenIds`
      // guards against re-requesting a screen whose collection is already
      // in flight or done.
      const collectedScreenIds = new Set<string>();
      const collectingScreenIds = new Set<string>();
      const reportLayerSelection = (rect: MarqueeRect) => {
        const state = dragState.current;
        if (!state || state.type !== "marquee") return;
        const chromeScale = chromeScaleFromZoom(zoomRef.current);
        const selection = layerCandidates
          .filter((candidate) =>
            rotatedRectIntersects(
              rect,
              getSelectableBounds(candidate.geometry, chromeScale),
              getFrameCenter(candidate.frameGeometry),
              candidate.frameGeometry.rotation ?? 0,
            ),
          )
          .map((candidate) => ({
            screenId: candidate.screenId,
            info: candidate.info,
          }));
        onLayerMarqueeSelectionChange?.(selection, {
          source: "marquee",
          additive: state.additive,
          shiftKey: state.additive,
        });
      };
      const collectForIntersectedScreens = (hitIds: string[]) => {
        const newIds = hitIds.filter(
          (id) => !collectedScreenIds.has(id) && !collectingScreenIds.has(id),
        );
        // The board spans the whole surface, so include it once anything
        // intersects (or immediately, for the initial zero-size rect) rather
        // than trying to hit-test its own — usually oversized — geometry.
        if (
          boardFileId &&
          boardFrameGeometry &&
          !collectedScreenIds.has(boardFileId) &&
          !collectingScreenIds.has(boardFileId)
        ) {
          newIds.push(boardFileId);
        }
        if (newIds.length === 0) return;
        const requestIds = new Set(newIds);
        newIds.forEach((id) => collectingScreenIds.add(id));
        void collectLayerMarqueeCandidates(requestIds).then((candidates) => {
          newIds.forEach((id) => {
            collectingScreenIds.delete(id);
            collectedScreenIds.add(id);
          });
          if (dragState.current?.type !== "marquee") return;
          layerCandidates = [...layerCandidates, ...candidates];
          reportLayerSelection(latestRect);
        });
      };
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
        onLayerMarqueeSelectionChange?.([], {
          source: "marquee",
          additive: false,
          shiftKey: false,
        });
      }
      setIsDragging(true);
      // Seed collection with whatever the zero-size origin rect already
      // touches (typically just the board, if present) so a click-without-
      // drag still reports a correct (likely empty) selection on mouseup.
      collectForIntersectedScreens([]);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "marquee") return;
        const nextPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const rect = normalizeRectFromPoints(state.originCanvas, nextPoint);
        latestRect = rect;
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

        const chromeScale = chromeScaleFromZoom(zoomRef.current);
        const hitIds = getCurrentFrameEntries()
          .filter((entry) =>
            rotatedRectIntersects(
              rect,
              getSelectableBounds(entry.geometry, chromeScale),
              getFrameCenter(entry.geometry),
              entry.geometry.rotation ?? 0,
            ),
          )
          .map((entry) => entry.id);
        const hitDraftIds = getCurrentDraftEntries()
          .filter((entry) =>
            rotatedRectIntersects(
              rect,
              getSelectableBounds(entry.geometry, chromeScale),
              getFrameCenter(entry.geometry),
              entry.geometry.rotation ?? 0,
            ),
          )
          .map((entry) => entry.id);

        collectForIntersectedScreens(hitIds);

        updateSelectedIds(() =>
          state.additive
            ? xorMarqueeSelection(state.baseSelectedIds, hitIds)
            : hitIds,
        );
        updateSelectedDraftIds(() =>
          state.additive
            ? xorMarqueeSelection(state.baseSelectedDraftIds, hitDraftIds)
            : hitDraftIds,
        );
        reportLayerSelection(rect);
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (
          state?.type === "marquee" &&
          shouldClearSelectionOnEmptyCanvasClick(state)
        ) {
          updateSelectedIds(() => []);
          updateSelectedDraftIds(() => []);
          onLayerMarqueeSelectionChange?.([], {
            source: "marquee",
            additive: false,
            shiftKey: false,
          });
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      boardFileId,
      boardFrameGeometry,
      collectLayerMarqueeCandidates,
      finishDrag,
      getCanvasPoint,
      getCurrentDraftEntries,
      getCurrentFrameEntries,
      installDragListeners,
      onLayerMarqueeSelectionChange,
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

      return getOutsideFrameDraftFallback(entries, {
        hasBoardDrawHandler: Boolean(onBoardDrawPrimitiveRef.current),
      });
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
          // Return the board file id so the caller can run the same selection
          // and text-edit activation path used by regular screen primitives.
          return {
            frameId: boardFileId ?? "__board__",
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
      boardFileId,
      getScreenMetadata,
      getTargetFrameForDraft,
      metadataById,
      onCreatePrimitive,
      screens,
    ],
  );

  const commitDraftPrimitive = useCallback(
    (
      nextDraft: DraftPrimitive,
      preferredFrameId?: string,
      options?: { nextTool?: "move" | "pen" },
    ) => {
      const persisted = persistDraftPrimitive(nextDraft, preferredFrameId);
      if (persisted) {
        updateDraftPrimitives((current) =>
          current.filter((draft) => draft.id !== nextDraft.id),
        );
        updateSelectedDraftIds(() => []);
        updateSelectedIds(() => []);
        onPrimitiveCreated?.(persisted.frameId, persisted.nodeId, {
          nextTool: options?.nextTool,
        });
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
    activePenPathRef.current = null;
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
        undefined,
        { nextTool: "pen" },
      );
      clearActivePenPath();
    },
    [clearActivePenPath, commitDraftPrimitive, onActiveToolChange, toolProps],
  );

  const undoActivePenPathSegment = useCallback(() => {
    const path = activePenPathRef.current;
    if (!path) return false;

    const remainingNodes = path.nodes.slice(0, -1);
    if (remainingNodes.length === 0) {
      clearActivePenPath();
      return true;
    }

    const nextPath: PenPath = { nodes: remainingNodes, closed: false };
    activePenPathRef.current = nextPath;
    setActivePenPath(nextPath);
    setPenGesturePreview(null);
    setPenPointer(null);
    setPenCloseHover(false);
    return true;
  }, [clearActivePenPath]);

  const getPenAnchorPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      shiftKey: boolean,
      path: PenPath | null,
    ) => {
      const rawPoint = getCanvasPoint(clientX, clientY);
      const lastAnchor = path?.nodes[path.nodes.length - 1]?.point;
      const constrainedPoint =
        shiftKey && lastAnchor
          ? constrainPointTo45Degrees(lastAnchor, rawPoint)
          : rawPoint;
      // Light anchor snapping (P15): snap onto an existing anchor of the
      // path being drawn (so you can precisely re-hit a prior point), else
      // round to integer canvas px once zoomed to 100% or more.
      return snapPenAnchorPoint(constrainedPoint, path, {
        hitRadius: PEN_CLOSE_HIT_RADIUS_SCREEN_PX / (zoomRef.current / 100),
        zoom: zoomRef.current,
      });
    },
    [getCanvasPoint],
  );

  const updatePenPointer = useCallback(
    (clientX: number, clientY: number, shiftKey: boolean) => {
      lastPenClientPointRef.current = { clientX, clientY, shiftKey };
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

  // P18: a wheel pan/zoom gesture moves pan/zoom every animation frame
  // (applyViewToDom, mutated imperatively — see its comment) without any
  // mousemove event firing, so the pen ghost/ close-hover preview — derived
  // from screen->canvas conversion of the last known client point — goes
  // stale and visibly detaches from the cursor mid-gesture. Recompute it
  // from the remembered client point whenever pan/zoom changes.
  const recomputePenPointerForViewChange = useCallback(() => {
    const last = lastPenClientPointRef.current;
    if (!last || !activePenPathRef.current) return;
    updatePenPointer(last.clientX, last.clientY, last.shiftKey);
  }, [updatePenPointer]);
  recomputePenPointerForViewChangeRef.current =
    recomputePenPointerForViewChange;

  const beginPenNodeCreation = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // Double (or further) click ends the path instead of adding another
      // duplicate coincident anchor at the same point (P7).
      if (e.detail > 1) {
        finishPenPath();
        return;
      }
      suppressNextPick.current = true;

      const pathBefore = activePenPathRef.current?.closed
        ? null
        : activePenPathRef.current;
      const rawPoint = getCanvasPoint(e.clientX, e.clientY);
      const closing = Boolean(
        pathBefore &&
        isPenCloseTarget(
          pathBefore,
          rawPoint,
          PEN_CLOSE_HIT_RADIUS_SCREEN_PX / (zoomRef.current / 100),
        ),
      );

      // Figma defers the close commit to mouseup rather than closing
      // instantly on mousedown, so a drag on the closing click can shape
      // the closing segment's curve. Anchor the drag at the path's first
      // point (rather than the raw cursor position) so a click-only close
      // (no drag) still closes exactly on the start anchor.
      const anchor = closing
        ? pathBefore!.nodes[0].point
        : getPenAnchorPoint(e.clientX, e.clientY, e.shiftKey, pathBefore);
      const pathSnapshot = pathBefore ? clonePenPath(pathBefore) : null;
      dragState.current = {
        type: "pen-node",
        originClient: { x: e.clientX, y: e.clientY },
        anchor,
        pathBefore: pathSnapshot,
        hasMoved: false,
        closing,
      };
      const initialPath = closing
        ? (pathSnapshot as PenPath)
        : appendPenNode(pathSnapshot, createCornerNode(anchor));
      activePenPathRef.current = initialPath;
      setActivePenPath(initialPath);
      setPenGesturePreview(
        closing ? closePenPath(pathSnapshot as PenPath) : initialPath,
      );
      setPenPointer(null);
      setPenCloseHover(closing);
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
        const handleOut = ev.shiftKey
          ? constrainPointTo45Degrees(state.anchor, handlePoint)
          : handlePoint;

        if (state.closing) {
          // Shape the closing segment: drag the first anchor's handleIn
          // (mirrored across the anchor from the drag point, matching how
          // every other smooth anchor's handles work) without appending a
          // new node — the path is still just previewed as closed.
          const closedPreviewPath = shapeClosingHandles(
            state.pathBefore as PenPath,
            state.hasMoved ? handleOut : null,
          );
          setPenGesturePreview(closedPreviewPath);
          return;
        }

        const node = state.hasMoved
          ? createSmoothNode(state.anchor, handleOut, {
              // Alt/Option while dragging a new anchor's handle breaks
              // symmetry into a cusp (P8): read the live event's altKey on
              // every move so toggling Alt mid-drag updates immediately,
              // rather than latching whatever it was when the drag started.
              breakSymmetry: ev.altKey,
            })
          : createCornerNode(state.anchor);
        const nextPath = appendPenNode(state.pathBefore, node);
        activePenPathRef.current = nextPath;
        setActivePenPath(nextPath);
        setPenGesturePreview(nextPath);
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "pen-node") {
          finishDrag();
          return;
        }

        const handlePoint = getCanvasPoint(ev.clientX, ev.clientY);
        const handleOut = ev.shiftKey
          ? constrainPointTo45Degrees(state.anchor, handlePoint)
          : handlePoint;

        if (state.closing) {
          const closedPath = shapeClosingHandles(
            state.pathBefore as PenPath,
            state.hasMoved ? handleOut : null,
          );
          setPenGesturePreview(null);
          setPenPointer(null);
          setPenCloseHover(false);
          finishPenPath(closedPath);
          finishDrag();
          return;
        }

        const node: PenNode = state.hasMoved
          ? createSmoothNode(state.anchor, handleOut, {
              breakSymmetry: ev.altKey,
            })
          : createCornerNode(state.anchor);
        const nextPath = appendPenNode(state.pathBefore, node);
        activePenPathRef.current = nextPath;
        setActivePenPath(nextPath);
        setPenGesturePreview(null);
        setPenPointer(null);
        setPenCloseHover(false);
        onActiveToolChange?.("pen");
        finishDrag();
      };

      const cancelPenGesture = () => {
        const state = dragState.current;
        if (state?.type === "pen-node") {
          activePenPathRef.current = state.pathBefore;
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

  // ── Vector edit mode (P-VE1): drag an existing path's anchors/handles ────
  // (see VectorEditOverlayState / VectorEditOverlay). The overlay itself
  // resolves hit-tests and starts these; both gestures follow the same
  // installDragListeners/dragState pattern as every other drag above, with
  // the parent-owned `vectorEdit.path` (not local React state) as the
  // source of truth: every move reports an updated path via
  // `vectorEdit.onChange(next, "preview" | "commit")` instead of setting
  // local state.
  const beginVectorAnchorDrag = useCallback(
    (nodeIndex: number, e: React.MouseEvent) => {
      if (!vectorEdit || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      claimKeyboardFocus();

      const pathBefore = clonePenPath(vectorEdit.path);
      dragState.current = {
        type: "vector-anchor",
        originClient: { x: e.clientX, y: e.clientY },
        nodeIndex,
        pathBefore,
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor("move");

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "vector-anchor") return;
        const active = vectorEditRef.current;
        if (!active) return;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          active.originCanvas,
        );
        const nextPath = movePenAnchor(
          state.pathBefore,
          state.nodeIndex,
          localPoint,
        );
        active.onChange(nextPath, "preview");
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "vector-anchor") {
          finishDrag();
          return;
        }
        const active = vectorEditRef.current;
        if (!active) {
          finishDrag();
          return;
        }
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          active.originCanvas,
        );
        const nextPath = state.hasMoved
          ? movePenAnchor(state.pathBefore, state.nodeIndex, localPoint)
          : state.pathBefore;
        active.onChange(nextPath, "commit");
        finishDrag();
      };

      const cancelGesture = () => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (state?.type === "vector-anchor" && active) {
          active.onChange(clonePenPath(state.pathBefore), "commit");
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp, cancelGesture);
    },
    [
      claimKeyboardFocus,
      finishDrag,
      getCanvasPoint,
      installDragListeners,
      vectorEdit,
    ],
  );

  const beginVectorHandleDrag = useCallback(
    (nodeIndex: number, which: "in" | "out", e: React.MouseEvent) => {
      if (!vectorEdit || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      claimKeyboardFocus();

      const pathBefore = clonePenPath(vectorEdit.path);
      dragState.current = {
        type: "vector-handle",
        originClient: { x: e.clientX, y: e.clientY },
        nodeIndex,
        which,
        pathBefore,
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor("crosshair");

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "vector-handle") return;
        const active = vectorEditRef.current;
        if (!active) return;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          active.originCanvas,
        );
        // Alt/Option held mid-drag breaks handle symmetry into a cusp,
        // matching the pen tool's own alt behavior (read live on every move
        // so toggling Alt mid-drag updates immediately).
        const nextPath = movePenHandle(
          state.pathBefore,
          state.nodeIndex,
          state.which,
          localPoint,
          { breakSymmetry: ev.altKey },
        );
        active.onChange(nextPath, "preview");
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "vector-handle") {
          finishDrag();
          return;
        }
        const active = vectorEditRef.current;
        if (!active) {
          finishDrag();
          return;
        }
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          active.originCanvas,
        );
        const nextPath = state.hasMoved
          ? movePenHandle(
              state.pathBefore,
              state.nodeIndex,
              state.which,
              localPoint,
              { breakSymmetry: ev.altKey },
            )
          : state.pathBefore;
        active.onChange(nextPath, "commit");
        finishDrag();
      };

      const cancelGesture = () => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (state?.type === "vector-handle" && active) {
          active.onChange(clonePenPath(state.pathBefore), "commit");
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp, cancelGesture);
    },
    [
      claimKeyboardFocus,
      finishDrag,
      getCanvasPoint,
      installDragListeners,
      vectorEdit,
    ],
  );

  /** Toggle corner<->smooth on double-click of an anchor (P-VE1). Always
   *  commits immediately (no preview phase — there's no drag to preview). */
  const toggleVectorNodeType = useCallback(
    (nodeIndex: number) => {
      if (!vectorEdit) return;
      const node = vectorEdit.path.nodes[nodeIndex];
      if (!node) return;
      const isCorner = !node.handleIn && !node.handleOut;
      const nextPath = setPenNodeType(
        vectorEdit.path,
        nodeIndex,
        isCorner ? "smooth" : "corner",
      );
      vectorEdit.onChange(nextPath, "commit");
    },
    [vectorEdit],
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
        tool === "line" || tool === "arrow"
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
      setDragCursor("crosshair");

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

        const modifiers: DraftGeometryModifiers = {
          shiftKey: ev.shiftKey,
          altKey: ev.altKey,
        };
        const isLineTool = state.tool === "line" || state.tool === "arrow";
        const previewEnd =
          isLineTool && ev.shiftKey
            ? constrainPointTo45Degrees(state.originCanvas, nextCanvas)
            : nextCanvas;
        setCreationPreview({
          tool,
          geometry: getDraftPreviewGeometryForTool(
            tool,
            state.originCanvas,
            nextCanvas,
            state.hasMoved,
            modifiers,
          ),
          points: isLineTool ? [state.originCanvas, previewEnd] : undefined,
        });
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "draft-create") {
          finishDrag();
          return;
        }

        const endCanvas = getCanvasPoint(ev.clientX, ev.clientY);
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
        const modifiers: DraftGeometryModifiers = {
          shiftKey: ev.shiftKey,
          altKey: ev.altKey,
        };
        // Figma parity: the frame tool (F/A) creates a new top-level frame —
        // here, a screen — only when the gesture STARTS on empty canvas. A
        // frame gesture that starts inside an existing screen nests instead
        // (Figma nests a child frame): it falls through to the shared draft-
        // primitive commit below, inserting a plain container <div> into the
        // originating screen.
        if (
          state.tool === "frame" &&
          !state.originFrameId &&
          onCreateScreenFrame
        ) {
          const draftGeometry = getDraftGeometryForTool(
            state.tool,
            state.originCanvas,
            endCanvas,
            modifiers,
          );
          // Item 4 — guard against a degenerate/corrupted camera (extreme
          // pan+near-zero zoom) sending getCanvasPoint's world-space
          // conversion to infinity: clamp the new screen to the current
          // viewport's exact visible world-rect (overscanFactor 0) rather
          // than trusting the raw drag-computed geometry outright.
          const surfaceRect = surfaceRef.current?.getBoundingClientRect();
          const viewportBounds = surfaceRect
            ? getOverscannedViewportCanvasBounds(
                { width: surfaceRect.width, height: surfaceRect.height },
                panRef.current,
                zoomRef.current,
                0,
              )
            : null;
          onCreateScreenFrame(
            clampFrameGeometryToViewport(draftGeometry, viewportBounds),
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
          moved: releaseMoved,
          toolProps,
          modifiers,
        });
        // Figma parity: a frame-tool CLICK nested inside a screen places
        // Figma's default 100x100 frame. The frame tool's 320x640 click
        // default (DRAFT_FRAME_WIDTH/HEIGHT) only fits the top-level
        // screen-creation path handled above — nesting a screen-sized div
        // from a single click would blanket the whole screen.
        const committedDraft =
          state.tool === "frame" && !releaseMoved
            ? {
                ...nextDraft,
                geometry: { ...nextDraft.geometry, width: 100, height: 100 },
              }
            : nextDraft;
        commitDraftPrimitive(committedDraft, state.originFrameId);
        if (activeTool === undefined) {
          setLocalActiveTool("move");
        }
        onActiveToolChange?.("move");
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
      // Figma parity: object drags keep the default arrow cursor, never a
      // grabbing hand — grab/grabbing is reserved for the hand tool and
      // space-pan gestures (see the isPanning/hand-tool branches in
      // surfaceCursor below). Do not setDragCursor here.

      // PERF9: cache each dragged draft's DOM node (and the selection-box
      // overlay tracking it) once, up front — see beginFrameDrag's matching
      // comment for the full rationale.
      const draggedDraftEls = new Map<string, HTMLElement>();
      targetIds.forEach((targetId) => {
        const el = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-draft-id="${CSS.escape(targetId)}"]`,
        );
        if (el) draggedDraftEls.set(targetId, el);
      });
      const selectionBoxEl = surfaceRef.current?.querySelector<HTMLElement>(
        "[data-frame-selection-box]",
      );

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "draft-move") return;
        const scale = zoomRef.current / 100;
        let dx = (ev.clientX - state.originClient.x) / scale;
        let dy = (ev.clientY - state.originClient.y) / scale;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }

        // Shift held mid-move (not at mousedown — that path is shift-click
        // multi-select and never reaches here, see the guard in
        // beginDraftDrag above) locks movement to a single axis, matching
        // Figma and mirroring the identical lock in beginFrameDrag. Zero the
        // smaller-magnitude axis before snapping so snap candidates on the
        // locked axis can't reintroduce drift on it.
        if (ev.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            dy = 0;
          } else {
            dx = 0;
          }
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

        // PERF9: ref-only geometry write (no setDraftPrimitives) + direct DOM
        // mutation, same "imperative now, commit once" discipline as
        // beginFrameDrag above — this is the other half of the laggy
        // overview-drag fix (a freshly drawn/moved rectangle is a draft
        // primitive, not yet a committed screen).
        updateDraftPrimitivesRefOnly((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            if (!origin) return draft;
            return moveDraftPrimitive(origin, dx + snap.dx, dy + snap.dy);
          }),
        );
        state.targetIds.forEach((targetId) => {
          const draft = draftPrimitivesRef.current.find(
            (candidate) => candidate.id === targetId,
          );
          const el = draggedDraftEls.get(targetId);
          if (!draft || !el) return;
          const { left, top } = frameStyleLeftTop(draft.geometry);
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
        });
        if (selectionBoxEl) {
          const targetGeometries = state.targetIds
            .map(
              (targetId) =>
                draftPrimitivesRef.current.find(
                  (candidate) => candidate.id === targetId,
                )?.geometry,
            )
            .filter((geometry): geometry is FrameGeometry => Boolean(geometry));
          const bounds =
            targetGeometries.length === 1
              ? targetGeometries[0]
              : (() => {
                  const groupBounds = getFrameGroupBounds(
                    targetGeometries.map((geometry) => ({ id: "", geometry })),
                  );
                  return groupBounds
                    ? {
                        x: groupBounds.left,
                        y: groupBounds.top,
                        width: groupBounds.width,
                        height: groupBounds.height,
                      }
                    : null;
                })();
          if (bounds) {
            const { left, top } = frameStyleLeftTop(bounds);
            selectionBoxEl.style.left = `${left}px`;
            selectionBoxEl.style.top = `${top}px`;
          }
        }
        setAlignmentGuides(snap.guides);

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
          // PERF9: the live drag above only wrote draftPrimitivesRef (no
          // setDraftPrimitives per tick), so reconcile React state with the
          // ref's final positions here — once, matching beginFrameDrag's
          // same end-of-gesture commit. The persist calls below already read
          // fresh data straight from draftPrimitivesRef (so what gets
          // persisted is always correct either way), but the subsequent
          // updateDraftPrimitives(current => current.filter(...)) calls
          // filter React's OWN state array — without this sync that array
          // (and any draft NOT persisted this drop, e.g. a partial
          // multi-select persist) would still hold stale pre-drag positions.
          updateDraftPrimitives(() => draftPrimitivesRef.current);
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
      updateDraftPrimitives,
      updateDraftPrimitivesRefOnly,
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
        // K-scale (Figma "Scale" tool) parity: when the K tool drives this
        // resize, applyDraftGeometry also multiplies strokeWidth by the
        // uniform scale factor. Read from the ref (not the render-scoped
        // `effectiveTool` const) since this closure was created once at
        // drag-start and must see whichever tool is active on THIS tick.
        const scaleK = effectiveToolRef.current === "scale";

        updateDraftPrimitives((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            const geometry = resizedById[draft.id];
            if (!origin || !geometry) return draft;
            return applyDraftGeometry(origin, geometry, scaleK);
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
      // Figma parity: object drags keep the default arrow cursor, never a
      // grabbing hand — see the matching comment in beginDraftDrag above.

      // PERF9: cache each dragged screen's DOM node (and the selection-box
      // overlay tracking it) once, up front, instead of querying the DOM on
      // every rAF tick. onStartFrameDrag only ever fires with screen.id
      // (Screen's own mousedown handlers below), never a primitive nodeId —
      // see frameStyleLeftTop's doc comment — so every target here has a
      // real `[data-frame-id]` node with a label row.
      const frameLabelHeight =
        FRAME_LABEL_HEIGHT * chromeScaleFromZoom(zoomRef.current);
      const draggedFrameEls = new Map<string, HTMLElement>();
      targetIds.forEach((targetId) => {
        const el = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-frame-id="${CSS.escape(targetId)}"]`,
        );
        if (el) draggedFrameEls.set(targetId, el);
      });
      const selectionBoxEl = surfaceRef.current?.querySelector<HTMLElement>(
        "[data-frame-selection-box]",
      );

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "move") return;
        const scale = zoomRef.current / 100;
        let dx = (ev.clientX - state.originClient.x) / scale;
        let dy = (ev.clientY - state.originClient.y) / scale;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }

        // Never commit a live transform before the drag threshold is crossed:
        // otherwise 1-2px of click jitter nudges the frame, that nudge is
        // never reverted (mouseup below only restores origin when the whole
        // gesture never moved past threshold — see below), and the next drag
        // reads its origin from the already-nudged geometry.
        if (!state.hasMoved) return;

        // Shift held mid-move (not at mousedown — that path is shift-click
        // multi-select and never reaches here, see the guard above) locks
        // movement to a single axis, matching Figma. Zero the smaller-
        // magnitude axis before snapping so snap candidates on the locked
        // axis can't reintroduce drift on it.
        if (ev.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            dy = 0;
          } else {
            dx = 0;
          }
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

        // PERF9: mutate the dragged frame(s)' DOM position directly (ref-only
        // geometry write, no setFrameGeometry) instead of committing React
        // state every rAF tick — mirrors applyViewToDom's "imperative now,
        // commit once" discipline for the pan/zoom gesture. This is the fix
        // for the laggy overview object-drag: setFrameGeometry forced a full
        // MultiScreenCanvas re-render (canvasFrames/screenContentById/etc.
        // useMemos) on every tick even though only the dragged screen's own
        // position actually changed. React state is reconciled with ONE real
        // updateFrameGeometry call at gesture end (see handleMouseUp below).
        let nextGeometryById: FrameGeometryById | null = null;
        updateFrameGeometryRefOnly((current) => {
          const next = { ...current };
          state.targetIds.forEach((targetId) => {
            const origin = state.originFrames[targetId];
            next[targetId] = {
              ...origin,
              x: origin.x + dx + snap.dx,
              y: origin.y + dy + snap.dy,
            };
          });
          nextGeometryById = next;
          return next;
        });
        const settledGeometryById: FrameGeometryById | null = nextGeometryById;
        if (settledGeometryById) {
          state.targetIds.forEach((targetId) => {
            const geometry = settledGeometryById[targetId];
            const el = draggedFrameEls.get(targetId);
            if (!geometry || !el) return;
            const { left, top } = frameStyleLeftTop(geometry, frameLabelHeight);
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
          });
          // Keep the selection outline + resize/rotate handles glued to the
          // dragged frame — SelectionBox's own `geometry` prop only updates
          // on the next real React render, which this tick intentionally
          // skips (see above), so without this it would visually detach and
          // trail behind during the drag.
          if (selectionBoxEl) {
            const targetGeometries = state.targetIds.map(
              (targetId) => settledGeometryById[targetId],
            );
            const bounds =
              targetGeometries.length === 1
                ? targetGeometries[0]
                : (() => {
                    const groupBounds = getFrameGroupBounds(
                      targetGeometries.map((geometry) => ({
                        id: "",
                        geometry,
                      })),
                    );
                    return groupBounds
                      ? {
                          x: groupBounds.left,
                          y: groupBounds.top,
                          width: groupBounds.width,
                          height: groupBounds.height,
                        }
                      : null;
                  })();
            if (bounds) {
              const { left, top } = frameStyleLeftTop(bounds);
              selectionBoxEl.style.left = `${left}px`;
              selectionBoxEl.style.top = `${top}px`;
            }
          }
        }
        setAlignmentGuides(snap.guides);

        // Smart-spacing guides (CV11) — only meaningful for a single moving
        // frame (matches Figma, which only shows equal-gap guides while
        // dragging one object, not a multi-select group).
        if (state.targetIds.length === 1) {
          const primaryId = state.targetIds[0];
          const movedGeometry = movingEntries.find(
            (entry) => entry.id === primaryId,
          )?.geometry;
          if (movedGeometry) {
            // Same screen-px-to-canvas-px conversion computeMoveSnap uses
            // for its own threshold, so the equal-gap tolerance also stays
            // a constant few screen pixels regardless of zoom level.
            const tolerance =
              EQUAL_GAP_TOLERANCE_SCREEN_PX /
              Math.max(0.01, zoomRef.current / 100);
            setEqualGapGuides(
              computeEqualGapGuides(
                {
                  ...movedGeometry,
                  x: movedGeometry.x + snap.dx,
                  y: movedGeometry.y + snap.dy,
                },
                stationaryEntries,
                { toleranceCanvasPx: tolerance },
              ),
            );
          }
        } else {
          setEqualGapGuides([]);
        }

        // Resize shows a W x H badge and rotate shows a degrees badge — move
        // was the one transform with no live feedback at all. Show the
        // primary frame's new (rounded) position, matching resize/rotate's
        // convention of displaying the current absolute value rather than a
        // delta.
        const primaryOrigin = state.originFrames[state.primaryId];
        if (primaryOrigin) {
          showTransformFeedback(
            `${Math.round(primaryOrigin.x + dx + snap.dx)}, ${Math.round(primaryOrigin.y + dy + snap.dy)}`,
            ev.clientX,
            ev.clientY,
          );
        }

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
        if (state?.type === "move" && !state.hasMoved) {
          // Belt-and-braces: the live transform above already skips committing
          // until hasMoved, but restore origin here too in case any geometry
          // slipped through (e.g. a future code path that writes frameGeometry
          // directly) so a below-threshold click never leaves a phantom nudge.
          updateFrameGeometry((current) =>
            frameGeometryWithOverrides(current, state.originFrames),
          );
        }
        if (state?.type === "move" && state.hasMoved) {
          // If all dragged ids are committed primitive nodeIds (not screen
          // frames), attempt a primitive reparent on drop.
          const currentFrameIds = Object.keys(frameGeometryRef.current);
          const allCommitted = state.targetIds.every(
            (targetId) => !currentFrameIds.includes(targetId),
          );
          if (allCommitted && dropTarget) {
            const sourceScreenId = resolvePrimitiveScreenId(state.primaryId);
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

          // Normal screen-frame geometry commit. PERF9: the live drag above
          // only wrote frameGeometryRef (no setFrameGeometry per tick), so
          // React state must be reconciled with the ref's final values here
          // — exactly once, matching scheduleViewCommit's "one commit at
          // gesture end" contract for the pan/zoom path. Without this, the
          // next render (e.g. from setIsDragging(false) below) would paint
          // the frame back at its stale pre-drag React position for one
          // frame before the ref value re-synced.
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          setFrameGeometry(after);
          onGeometryChangeRef.current?.(after);
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
      resolvePrimitiveScreenId,
      showTransformFeedback,
      updateFrameGeometry,
      updateFrameGeometryRefOnly,
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
      // Rotation-aware cursor: a static per-handle cursor is only correct
      // when the frame isn't rotated. For a single selected (possibly
      // rotated) frame, quantize the handle's rotated visual angle to the
      // nearest 45deg to pick the matching cursor; group resizes keep the
      // unrotated cursor, matching the group's own unrotated resize math.
      setDragCursor(
        originEntries.length === 1
          ? getResizeCursorForHandle(
              handle,
              originEntries[0].geometry.rotation ?? 0,
            )
          : getResizeCursor(handle),
      );

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

        // Skip committing any transform until the drag threshold is crossed —
        // see the matching comment in beginFrameDrag's move handler.
        if (!state.hasMoved) return;

        const originEntries = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: state.originFrames[targetId],
        }));

        // K-scale (Figma "Scale" tool) parity for screen frames: a screen's
        // rendered content already scales proportionally (instead of
        // reflowing) whenever its resized box keeps the SAME aspect ratio as
        // its natural metadata size — see getScreenPreviewViewport's
        // aspectMatches branch, and getInitialFrameGeometry, which seeds
        // every screen's frame at exactly that aspect ratio already. So
        // forcing aspect-ratio-locked resize (exactly like holding Shift)
        // whenever the K tool drives this drag is sufficient on its own to
        // get Figma-consistent "scale contents, don't reflow" behavior for
        // screens — no metadata/DesignEditor changes needed. A normal resize
        // (tool !== "scale") is completely unaffected.
        const scaleK = effectiveToolRef.current === "scale";
        const lockAspectRatio = ev.shiftKey || scaleK;

        // A single rotated frame needs rotation-aware resize math: the handle
        // follows the frame's own rotated axes (matching how the handles
        // render, rotated with the frame) and the opposite anchor edge/corner
        // stays fixed in WORLD space, not just in the unrotated local frame.
        // Multi-select group resize with rotated members keeps the prior
        // (unrotated-bounds) behavior — extending this to groups would need
        // per-member rotation handling around a shared group anchor, which is
        // a larger change than this fix covers.
        const singleRotatedFrame =
          originEntries.length === 1 &&
          (originEntries[0].geometry.rotation ?? 0)
            ? originEntries[0]
            : null;

        if (singleRotatedFrame) {
          const resizedGeometry = resizeRotatedFrameFromDelta(
            singleRotatedFrame.geometry,
            state.handle,
            dx,
            dy,
            {
              preserveAspectRatio: lockAspectRatio,
              resizeFromCenter: ev.altKey,
              minWidth: 1,
              minHeight: 1,
            },
          );
          updateFrameGeometry((current) => ({
            ...current,
            [singleRotatedFrame.id]: {
              ...state.originFrames[singleRotatedFrame.id],
              ...resizedGeometry,
            },
          }));
          setAlignmentGuides([]);
          showTransformFeedback(
            `${Math.round(resizedGeometry.width)} x ${Math.round(resizedGeometry.height)}`,
            ev.clientX,
            ev.clientY,
          );
          return;
        }

        const resized = resizeFrameGroupFromDelta(
          originEntries,
          state.originBounds,
          state.handle,
          dx,
          dy,
          {
            preserveAspectRatio: lockAspectRatio,
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
            // Snapping x and y independently can each pull toward a
            // different sibling edge, which would distort a shift-held or
            // K-scale (aspect-locked) resize away from its ratio — see
            // computeAspectPreservingResizeSnap in canvas-math.ts.
            preserveAspectRatio: lockAspectRatio,
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
        if (state?.type === "resize" && !state.hasMoved) {
          // Belt-and-braces restore, matching the move handler.
          updateFrameGeometry((current) =>
            frameGeometryWithOverrides(current, state.originFrames),
          );
        }
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
      const originPointerAngle = angleBetween(center, pointer);
      dragState.current = {
        type: "rotate",
        originClient: { x: e.clientX, y: e.clientY },
        originFrame,
        frameId: id,
        originPointerAngle,
        originRotation: originFrame.rotation ?? 0,
        hasMoved: false,
      };
      setIsDragging(true);
      // Figma parity: show the curved rotate cursor (oriented toward the
      // grabbed corner) instead of a plain grabbing hand, and keep it
      // oriented to the live pointer angle as the drag proceeds below.
      setDragCursor(
        rotateCursorDataUri(quantizeAngleTo8Buckets(originPointerAngle)),
      );

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
        // Skip committing any transform until the drag threshold is crossed —
        // see the matching comment in beginFrameDrag's move handler.
        if (!state.hasMoved) return;

        const pointer = getCanvasPoint(ev.clientX, ev.clientY);
        const center = getFrameCenter(state.originFrame);
        const pointerAngle = angleBetween(center, pointer);
        const raw =
          state.originRotation + pointerAngle - state.originPointerAngle;
        const rotation = ev.shiftKey ? Math.round(raw / 15) * 15 : raw;
        updateFrameGeometry((current) => ({
          ...current,
          [state.frameId]: {
            ...state.originFrame,
            rotation: Math.round(rotation * 10) / 10,
          },
        }));
        setDragCursor(
          rotateCursorDataUri(quantizeAngleTo8Buckets(pointerAngle)),
        );
        showTransformFeedback(
          `${Math.round(rotation)}deg`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "rotate" && !state.hasMoved) {
          // Belt-and-braces restore, matching the move handler.
          updateFrameGeometry((current) => ({
            ...current,
            [state.frameId]: { ...state.originFrame },
          }));
        }
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

  // Multi-selection rotate (CV14): rotates every currently-selected frame
  // together around the group's own center. Kept entirely separate from
  // beginRotate above — single-frame rotate is unaffected.
  const beginGroupRotate = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextPick.current = true;

      const targetIds = selectedIdsRef.current;
      if (targetIds.length < 2) return;
      const originEntries = getCurrentFrameEntries().filter((entry) =>
        targetIds.includes(entry.id),
      );
      if (originEntries.length < 2) return;
      const groupBounds = getFrameGroupBounds(originEntries);
      if (!groupBounds) return;
      const groupCenter = { x: groupBounds.centerX, y: groupBounds.centerY };

      const pointer = getCanvasPoint(e.clientX, e.clientY);
      const originPointerAngle = angleBetween(groupCenter, pointer);
      dragState.current = {
        type: "group-rotate",
        originClient: { x: e.clientX, y: e.clientY },
        originFrames: Object.fromEntries(
          originEntries.map((entry) => [entry.id, entry.geometry]),
        ) as FrameGeometryById,
        targetIds: originEntries.map((entry) => entry.id),
        groupCenter,
        originPointerAngle,
        hasMoved: false,
      };
      setIsDragging(true);
      // Figma parity: curved rotate cursor instead of a grabbing hand — see
      // the matching comment in beginRotate above.
      setDragCursor(
        rotateCursorDataUri(quantizeAngleTo8Buckets(originPointerAngle)),
      );

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "group-rotate") return;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }
        // Skip committing any transform until the drag threshold is crossed —
        // see the matching comment in beginFrameDrag's move handler.
        if (!state.hasMoved) return;

        const pointer = getCanvasPoint(ev.clientX, ev.clientY);
        const currentAngle = angleBetween(state.groupCenter, pointer);
        const rawDelta = currentAngle - state.originPointerAngle;
        const delta = ev.shiftKey ? Math.round(rawDelta / 15) * 15 : rawDelta;
        setDragCursor(
          rotateCursorDataUri(quantizeAngleTo8Buckets(currentAngle)),
        );

        const originEntriesForRotate = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: state.originFrames[targetId],
        }));
        const rotated = rotateFrameGroupAroundCenter(
          originEntriesForRotate,
          state.groupCenter,
          delta,
        );
        updateFrameGeometry((current) => {
          const next = { ...current };
          rotated.forEach((entry) => {
            next[entry.id] = {
              ...state.originFrames[entry.id],
              ...entry.geometry,
            };
          });
          return next;
        });
        showTransformFeedback(
          `${Math.round(delta)}deg`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "group-rotate" && !state.hasMoved) {
          // Belt-and-braces restore, matching the move handler.
          updateFrameGeometry((current) =>
            frameGeometryWithOverrides(current, state.originFrames),
          );
        }
        if (state?.type === "group-rotate" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          onGeometryCommitRef.current?.(
            frameGeometryWithOverrides(after, state.originFrames),
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
      // Mount the interaction shield and mute preview-iframe pointer events for
      // the duration of the gesture, same as every other drag — otherwise the
      // pointer freezes crossing a live embedded iframe and a release over a
      // screen never reaches handleMouseUp.
      setIsDragging(true);
      // Figma parity: show a copy-affordance cursor while the alt-drag
      // duplicate gesture is armed. Tracked live in handleMouseMove below
      // (same live e.altKey tracking that already drives canDuplicate), so
      // releasing alt mid-drag falls back to the default arrow instead of
      // staying on the copy cursor for a gesture that will no longer
      // duplicate on mouseup.
      setDragCursor(e.altKey ? "copy" : null);

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
          // Live alt state, not just capability: if the user releases alt
          // mid-drag the preview should visibly fall back to its "not armed"
          // dashed/preview styling, matching that mouseup will then cancel
          // the duplicate instead of creating one (see handleMouseUp below).
          canDuplicate: !!onDuplicate && ev.altKey,
          moved,
        });
        setDragCursor(ev.altKey ? "copy" : null);
      };

      const cleanupDuplicateGesture = () => {
        setDuplicatePreview(null);
        duplicateCleanup.current = null;
        // finishDrag clears isDragging, unmounts the shield, and — critically —
        // runs dragCleanup.current() to detach the window listeners installed
        // by installDragListeners and restore preview-iframe pointer events.
        // dragState.current was never set for this gesture, so finishDrag's
        // other resets (marquee/creation-preview/etc.) are no-ops here.
        finishDrag();
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const moved =
          Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) >=
          DUPLICATE_DRAG_THRESHOLD;
        const mode = moved ? "alt-drag" : "alt-click";
        // Figma semantics: a plain alt-click (no drag) never duplicates —
        // only an actual alt-drag does. And alt is evaluated live: releasing
        // it before mouseup cancels the pending duplicate rather than
        // creating one anyway (this gesture never moves the original frame
        // during the drag — it only shows a floating ghost preview — so
        // "cancel" here means no-op, not handing off to a live move).
        const shouldDuplicate = moved && ev.altKey;

        if (onDuplicate && shouldDuplicate) {
          const dropCanvasPosition = canvasPointFromClient(
            ev.clientX,
            ev.clientY,
          );
          // shouldDuplicate implies moved, so the drop position is always
          // relative to the pointer's offset into the source frame (the
          // "snap next to source" placement only applied to the old
          // zero-move alt-click case, which no longer duplicates at all).
          const canvasPosition = {
            x: dropCanvasPosition.x - pointerOffset.x,
            y: dropCanvasPosition.y - pointerOffset.y,
          };
          // The user placed this clone deliberately — suppress the
          // lineup-recenter camera move when the created screen lands in
          // `screens` (Figma keeps the camera still on alt-drag duplicate).
          lineupRecenterSuppressRef.current = {
            atMs: Date.now(),
            fromCount: screensRef.current.length,
            addedCount: 1,
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
      installDragListeners(
        handleMouseMove,
        handleMouseUp,
        cleanupDuplicateGesture,
      );
    },
    [
      canvasPointFromClient,
      finishDrag,
      getCurrentFrameEntries,
      installDragListeners,
      onDuplicate,
      onPick,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      claimKeyboardFocus();
      // Clear any stale pick-suppression left over from a prior resize/rotate/move
      // gesture that never received its trailing frame click — otherwise it would
      // silently swallow this unrelated interaction.
      suppressNextPick.current = false;
      // This fires on the capture phase before any frame/draft card's own
      // mousedown handler (even though those stopPropagation before bubbling
      // back up), so it's the single choke point for "a drag started" —
      // clear the alt-hover measurement immediately rather than letting it
      // linger frozen for the duration of the drag.
      setAltHoverMeasurement(null);
      const target = e.target as HTMLElement;
      const onFrame = !!target.closest("[data-frame-shell]");
      const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
      if (vectorEdit) {
        if (e.button !== 0) return;
        e.preventDefault();
        // Hit-test the click directly against the path's anchors/handles
        // (rather than relying on per-element DOM handlers), reusing the
        // same pure hitTestPenAnchor/hitTestPenHandle helpers pen-path.ts
        // exports. A screen-space radius keeps the hit target a constant
        // physical size regardless of zoom, matching PEN_CLOSE_HIT_RADIUS
        // above. Handles take priority over anchors when both are in range
        // (checked first, below).
        const canvasPoint = getCanvasPoint(e.clientX, e.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          vectorEdit.originCanvas,
        );
        const hitRadius = screenPxToCanvasPx(
          VECTOR_EDIT_HIT_RADIUS_SCREEN_PX,
          zoomRef.current,
        );
        const handleHit = hitTestPenHandle(
          vectorEdit.path,
          localPoint,
          hitRadius,
        );
        if (handleHit) {
          beginVectorHandleDrag(handleHit.nodeIndex, handleHit.which, e);
          return;
        }
        const anchorHit = hitTestPenAnchor(
          vectorEdit.path,
          localPoint,
          hitRadius,
        );
        if (anchorHit) {
          if (e.detail > 1) {
            toggleVectorNodeType(anchorHit.nodeIndex);
            return;
          }
          beginVectorAnchorDrag(anchorHit.nodeIndex, e);
          return;
        }
        // Missed everything: an empty-canvas click while in vector edit mode
        // exits the mode, matching Figma.
        vectorEdit.onExit();
        return;
      }
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
      beginVectorAnchorDrag,
      beginVectorHandleDrag,
      claimKeyboardFocus,
      getCanvasPoint,
      localActiveTool,
      setAltHoverMeasurement,
      toggleVectorNodeType,
      vectorEdit,
    ],
  );

  // Figma-parity alt-hover measurement: with a selection and no active drag,
  // holding Alt while hovering another frame/draft computes edge-to-edge
  // gaps between the selection's bounds and the hovered object's bounds.
  // Cheap by construction — only runs the hit-tests/bounds math on a raw
  // mousemove when altKey is actually down, and bails to a single
  // setAltHoverMeasurement(null) otherwise (which itself no-ops via the
  // value-equality check once already cleared).
  const updateAltHoverMeasurement = useCallback(
    (e: { clientX: number; clientY: number; altKey: boolean }) => {
      if (!e.altKey || dragState.current) {
        setAltHoverMeasurement(null);
        return;
      }
      const selectedFrames = getCurrentFrameEntries().filter((entry) =>
        selectedIdsRef.current.includes(entry.id),
      );
      const selectedDrafts = getCurrentDraftEntries().filter((entry) =>
        selectedDraftIdsRef.current.includes(entry.id),
      );
      const selectionEntries = [...selectedFrames, ...selectedDrafts];
      const selectionBounds = getFrameGroupBounds(selectionEntries);
      if (!selectionBounds) {
        setAltHoverMeasurement(null);
        return;
      }

      const canvasPoint = getCanvasPoint(e.clientX, e.clientY);
      const selectedFrameIds = new Set(selectedFrames.map((f) => f.id));
      const selectedDraftIdsSet = new Set(selectedDrafts.map((d) => d.id));
      const hoveredFrame = getFrameEntryAtPoint(canvasPoint);
      const hoveredDraft = getDraftEntryAtPoint(canvasPoint);
      // Prefer whichever hit is on top (higher z), matching how the two hit
      // tests each already resolve overlaps within their own kind. Skip a
      // hit that's actually part of the current selection — measuring a
      // selected object against itself isn't meaningful.
      const hoveredCandidates = [
        hoveredFrame && !selectedFrameIds.has(hoveredFrame.id)
          ? hoveredFrame
          : null,
        hoveredDraft && !selectedDraftIdsSet.has(hoveredDraft.id)
          ? hoveredDraft
          : null,
      ].filter((entry): entry is NonNullable<typeof entry> => !!entry);
      const hovered = hoveredCandidates.sort(
        (a, b) => (b.geometry.z ?? 0) - (a.geometry.z ?? 0),
      )[0];

      if (!hovered) {
        setAltHoverMeasurement(null);
        return;
      }
      const hoveredBounds = getFrameGroupBounds([hovered]);
      if (!hoveredBounds) {
        setAltHoverMeasurement(null);
        return;
      }
      setAltHoverMeasurement(
        computeAltHoverMeasurement(selectionBounds, hoveredBounds),
      );
    },
    [
      getCanvasPoint,
      getCurrentDraftEntries,
      getCurrentFrameEntries,
      getDraftEntryAtPoint,
      getFrameEntryAtPoint,
      setAltHoverMeasurement,
    ],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      updateAltHoverMeasurement(e);
      const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
      if (tool !== "pen" || dragState.current?.type === "pen-node") return;
      updatePenPointer(e.clientX, e.clientY, e.shiftKey);
    },
    [activeTool, localActiveTool, updateAltHoverMeasurement, updatePenPointer],
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
    // A marquee-select drag can run concurrently with a wheel/trackpad pan
    // gesture (e.g. two-finger scroll while left-mouse-dragging a marquee).
    // Without this, the marquee overlay's position/size — computed from
    // React `pan`/`scale` in its inline style — would only catch up once the
    // gesture settles and scheduleViewCommit() re-renders, visibly lagging
    // behind the frames it's supposed to be selecting against.
    const marqueeOverlay = marqueeOverlayRef.current;
    const activeMarquee = marqueeRef.current;
    if (marqueeOverlay && activeMarquee) {
      marqueeOverlay.style.left = `${p.x + (SURFACE_PADDING + activeMarquee.x) * nextScale}px`;
      marqueeOverlay.style.top = `${p.y + (SURFACE_PADDING + activeMarquee.y) * nextScale}px`;
      marqueeOverlay.style.width = `${Math.max(1, activeMarquee.width * nextScale)}px`;
      marqueeOverlay.style.height = `${Math.max(1, activeMarquee.height * nextScale)}px`;
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
    // PERF9-WHEEL: the gesture has settled — restore every muted content
    // layer's own prior inline pointer-events value (imperative, mirroring
    // how markWheelGestureActive muted them; restoring the recorded value,
    // not "", keeps React's inline-style bookkeeping consistent since React
    // only rewrites style properties it believes changed).
    if (wheelGestureActiveRef.current) {
      wheelGestureActiveRef.current = false;
      wheelCameraGestureActive = false;
      const muted = wheelGestureMutedElementsRef.current;
      wheelGestureMutedElementsRef.current = null;
      if (muted) {
        muted.forEach((previousPointerEvents, element) => {
          if (element.isConnected) {
            element.style.pointerEvents = previousPointerEvents;
          }
        });
      }
    }
    setCanvasZoom(zoomRef.current);
    setPan(panRef.current);
    onZoomChange?.(zoomRef.current);
    // P18: the wheel/pinch gesture just settled (pan/zoom state is
    // reconciled into React here) — resync the pen ghost preview from the
    // last known cursor position now that the canvas-space mapping changed.
    recomputePenPointerForViewChange();
  }, [onZoomChange, recomputePenPointerForViewChange, startChromeSettle]);

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
  applyViewToDomRef.current = applyViewToDom;
  scheduleViewCommitRef.current = scheduleViewCommit;

  // Imperative camera command (Figma's Shift+1/Shift+2 zoom-to-fit /
  // zoom-to-selection). MultiScreenCanvas owns pan internally, so this is the
  // one external control path for pan+zoom together: the caller passes
  // world-space bounds to fit and a nonce; whenever the nonce changes we
  // resolve the fit camera against OUR OWN current viewport size (the caller
  // may not know it) via the same shared `getCameraForBounds` math
  // `computeFitCameraForFrames`-style callers already use, then push it
  // through the exact same imperative-transform + debounced-commit path a
  // settled wheel/pinch gesture uses — one `applyViewToDom` + one
  // `scheduleViewCommit`, not a fresh render-per-frame loop.
  useEffect(() => {
    if (!cameraCommand) return;
    if (lastCameraCommandNonceRef.current === cameraCommand.nonce) return;
    lastCameraCommandNonceRef.current = cameraCommand.nonce;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const camera = getCameraForBounds(
      cameraCommand.fitBounds,
      { width: rect.width, height: rect.height },
      {
        paddingScreenPx: cameraCommand.paddingScreenPx ?? 64,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        fallbackZoom: zoomRef.current,
      },
    );
    zoomRef.current = camera.zoom;
    panRef.current = { x: camera.x, y: camera.y };
    applyViewToDom();
    scheduleViewCommit();
  }, [cameraCommand, applyViewToDom, scheduleViewCommit]);

  // PERF9-WHEEL: the first flush that actually moves the camera mutes
  // pointer events on every live preview iframe with direct style writes on
  // a snapshot NodeList (ref-guarded — runs ONCE per gesture, zero React
  // commits). commitView restores the recorded per-element values once the
  // gesture has been idle for the debounce beat. A mid-gesture React render
  // from unrelated state could rewrite an iframe's style and re-enable it
  // early; that only reverts to pre-fix behavior for the gesture's tail, so
  // it's an acceptable trade for keeping gesture start/end render-free.
  const markWheelGestureActive = useCallback(() => {
    if (wheelGestureActiveRef.current) return;
    wheelGestureActiveRef.current = true;
    wheelCameraGestureActive = true;
    const surface = surfaceRef.current;
    if (!surface) return;
    // Mute the same layers a drag's canvasGestureActive gates via props:
    // every screen's content wrapper and the board-surface layer — this
    // covers the live iframes AND DesignCanvas's parent-side hover/hit-test
    // overlays beneath them.
    const muted = new Map<HTMLElement, string>();
    surface
      .querySelectorAll<HTMLElement>(
        "[data-screen-content], [data-board-surface-layer]",
      )
      .forEach((element) => {
        muted.set(element, element.style.pointerEvents);
        element.style.pointerEvents = "none";
      });
    wheelGestureMutedElementsRef.current = muted;
  }, []);

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
      markWheelGestureActive();
      applyViewToDom();
      scheduleViewCommit({ settleChrome: true });
      return;
    }

    const nextPan = {
      x: panRef.current.x - gesture.deltaX,
      y: panRef.current.y - gesture.deltaY,
    };
    panRef.current = nextPan;
    markWheelGestureActive();
    applyViewToDom();
    scheduleViewCommit();
  }, [applyViewToDom, markWheelGestureActive, scheduleViewCommit]);

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
      const delta = getWheelDeltaFromValues(
        args.deltaX,
        args.deltaY,
        args.deltaMode,
      );

      if (args.ctrlKey || args.metaKey) {
        // PERF9-WHEEL: only the zoom branch needs the surface rect (cursor
        // anchoring). Pan ticks skip the per-event getBoundingClientRect —
        // no forced style/layout read on the hot pan path.
        const rect = surfaceRef.current?.getBoundingClientRect();
        if (!rect) return;
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
      // DesignCanvas re-dispatches embedded-canvas-wheel messages as a
      // synthetic (non-isTrusted) WheelEvent on its own iframe element so its
      // own listeners can reuse one code path. That synthetic event bubbles
      // up through this surface's capture listener too, so without this guard
      // every embedded-screen wheel gesture gets processed twice: once via
      // the postMessage handler below, and again here from the re-dispatch.
      // Real user wheel input is always isTrusted, so this only filters out
      // the synthetic replay.
      if (!event.isTrusted) return;
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
      if (!path || isEditableHotkeyTarget(event.target)) {
        return;
      }

      const primaryKey = event.metaKey || event.ctrlKey;
      if (primaryKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        // While a pen-node drag is actively in progress (mouse down, still
        // dragging the handle for the anchor being placed), the path in
        // activePenPathRef already includes that in-progress node — undoing
        // here would pop it out from under the live drag, then the drag's
        // own mousemove/mouseup handlers would immediately re-add it from
        // their closed-over `state`, producing a no-op flicker. Ignore the
        // shortcut until the drag settles (mouseup/cancel).
        if (dragState.current?.type === "pen-node") {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        undoActivePenPathSegment();
        return;
      }

      if (primaryKey) return;

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
        // Figma: Escape ends the path in progress and keeps what's drawn so
        // far (no data loss), rather than discarding the whole path.
        // finishPenPath already falls back to a discard for a path with
        // fewer than 2 nodes (P16), where there's nothing meaningful to
        // commit.
        finishPenPath(path);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        undoActivePenPathSegment();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [finishPenPath, undoActivePenPathSegment]);

  useEffect(() => {
    const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
    // Switching tools mid-path (toolbar click or a single-letter shortcut
    // reaching the editor's handlers) used to silently discard the path in
    // progress. Figma commits it instead — finishPenPath already discards
    // for a sub-2-node path (P16), so this only ever loses genuinely empty
    // in-progress state.
    if (tool !== "pen") finishPenPath();
  }, [activeTool, finishPenPath, localActiveTool]);

  // Cmd+D / Ctrl+D: duplicate every selected frame (not just the first) with
  // a visible offset so each copy doesn't land exactly on top of its
  // original (Figma-style behaviour). `onDuplicate` is fire-and-forget
  // (`(id, request) => void`) and the actual new file id is only known
  // asynchronously by the caller (DesignEditor's createFileMutation
  // onSuccess), so this component has no id to add to its own selection
  // state. Known limitation: after a multi-duplicate, selection isn't
  // reprogrammed to the new copies (the caller instead makes its own last
  // duplicate the active file) — promoting the duplicates to the new
  // selection would require `onDuplicate` to return/callback the created id.
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
      // Always suppress the browser default (bookmark dialog) — but leave
      // propagation intact until we know a frame is duplicable here, so the
      // global hotkey hook can still duplicate non-frame layer selections.
      event.preventDefault();
      // Only act on frame IDs — filter out canvas primitives (sub-elements).
      const frameIds = selectedIdsRef.current.filter(
        (id) => frameGeometryRef.current[id],
      );
      if (frameIds.length === 0) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      // Duplicate every selected frame, not just the first — each duplicate
      // is offset relative to its OWN source geometry (not chained off the
      // previous duplicate), mirroring how a multi-select alt-drag would
      // offset each frame independently.
      let dispatched = 0;
      for (const targetId of frameIds) {
        const screen = screens.find((s) => s.id === targetId);
        if (!screen) continue;
        const sourceGeometry = frameGeometryRef.current[targetId];
        if (!sourceGeometry) continue;
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
        dispatched += 1;
      }
      if (dispatched > 0) {
        // Cmd+D places each clone right beside its source — like the
        // alt-drag drop, the camera must stay still while the clones land
        // (see shouldSuppressLineupRecenter).
        lineupRecenterSuppressRef.current = {
          atMs: Date.now(),
          fromCount: screensRef.current.length,
          addedCount: dispatched,
        };
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onDuplicate, screens]);

  // Releasing Alt should clear the alt-hover measurement immediately even if
  // the mouse never moves again (e.g. the user just lifts the Alt key while
  // reading the distance label) rather than leaving it frozen on screen
  // until the next mousemove recomputes it.
  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      setAltHoverMeasurement(null);
    };
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [setAltHoverMeasurement]);

  const scale = canvasZoom / 100;
  const chromeScale = scale > 0 ? 1 / scale : 1;
  const showPixelGrid = canvasZoom >= PIXEL_GRID_ZOOM;
  const effectiveTool = normalizeCanvasTool(activeTool ?? localActiveTool);
  useEffect(() => {
    effectiveToolRef.current = effectiveTool;
  }, [effectiveTool]);
  const penActive = effectiveTool === "pen";
  const creationToolActive = Boolean(getDraftCreationTool(effectiveTool));
  // PERF9-WHEEL: an in-flight wheel pan/zoom also mutes iframe pointer
  // events, but imperatively (see markWheelGestureActive) rather than via
  // this flag — flipping React state here at gesture start re-rendered every
  // Screen and stalled the first wheel tick.
  const canvasGestureActive = isDragging || isPanning;
  const boardSurfaceInteractive = shouldBoardSurfaceCapturePointerEvents({
    tool: effectiveTool,
    gestureActive: canvasGestureActive,
  });
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
        ? // Figma parity: rubber-band marquee selection keeps the default
          // arrow cursor, not crosshair.
          "default"
        : penActive || getDraftCreationTool(effectiveTool)
          ? "crosshair"
          : effectiveTool === "hand"
            ? "grab"
            : effectiveTool === "comment"
              ? COMMENT_CURSOR
              : "default";
  // PF19/PF21: canvasFrames (and everything derived from it below) used to be
  // plain per-render recomputation over `screens`/`frameGeometry`, which are
  // large arrays/maps for boards with many screens. Memoize so a render that
  // doesn't touch screens/geometry (e.g. a hover-only or unrelated state
  // update) doesn't re-walk and re-allocate the whole frame list.
  //
  // PF21: dragging/resizing/rotating ONE screen still replaces the whole
  // `frameGeometry` object every rAF tick (see updateFrameGeometry), which
  // means this useMemo's deps always look "changed" for every tick of a
  // drag — but only ONE screen's geometry actually differs. Previously the
  // `.map` above allocated a brand-new `{screen, metadata, geometry}` object
  // for every screen on every tick, which is what screenContentById and the
  // Screen render loop below read `metadata`/`geometry` from. Reuse the prior
  // entry object when a screen's own screen/metadata/geometry are unchanged
  // by value, so mapping over canvasFrames for the N-1 screens NOT being
  // dragged doesn't allocate anything new for them on this same tick.
  const canvasFrames = useMemo(() => {
    const cache = canvasFrameEntryCacheRef.current;
    const nextIds = new Set<string>();
    const next = screens.map((screen, index) => {
      nextIds.add(screen.id);
      const metadata = getResolvedMetadata(screen);
      const geometry =
        frameGeometry[screen.id] ?? getInitialFrameGeometry(index, metadata);
      const prior = cache.get(screen.id);
      if (
        prior &&
        prior.screen === screen &&
        sameResolvedMetadata(prior.metadata, metadata) &&
        sameFrameGeometry(prior.geometry, geometry)
      ) {
        return prior;
      }
      const entry: CanvasFrameEntry = { screen, metadata, geometry };
      cache.set(screen.id, entry);
      return entry;
    });
    // Drop cache entries for screens that no longer exist so a
    // delete-then-recreate-with-the-same-id sequence (unlikely, but not
    // impossible for generated ids) can't resurrect stale state, and so the
    // cache doesn't grow unboundedly across a long editing session that
    // deletes/creates many screens.
    for (const id of cache.keys()) {
      if (!nextIds.has(id)) cache.delete(id);
    }
    return next;
  }, [frameGeometry, getResolvedMetadata, screens]);
  // Overview viewport culling (PF22): resolve each screen's cull tier from
  // canvasFrames' geometry against the overscanned viewport computed from
  // *committed* pan/canvasZoom + the measured surface size — never the
  // imperative per-gesture zoomRef/panRef (see the culling helpers' module
  // doc for why). activeId and the current selection are always "visible"
  // regardless of position (mission requirement — matches Figma never
  // culling the object you're actively editing/have selected).
  //
  // hasBeenVisibleScreenIdsRef is intentionally mutated inside this useMemo,
  // mirroring the established canvasFrameEntryCacheRef/screenContentCacheRef
  // pattern in this file: a plain ref-backed cache read-and-written together
  // with the memoized computation it backs, not React state, since "a screen
  // just became visible" shouldn't itself force an extra render beyond the
  // one already happening from the pan/zoom/selection change that made it
  // visible.
  const screenCullTierById = useMemo(() => {
    const viewport = getOverscannedViewportCanvasBounds(
      surfaceSize,
      pan,
      canvasZoom,
    );
    const hasBeenVisible = hasBeenVisibleScreenIdsRef.current;
    const next = new Map<string, ScreenCullTier>();
    canvasFrames.forEach(({ screen, geometry }) => {
      const alwaysVisible =
        screen.id === activeId || selectedIdSet.has(screen.id);
      const tier = computeScreenCullTier({
        geometry,
        viewport,
        alwaysVisible,
        hasBeenVisible: hasBeenVisible.has(screen.id),
      });
      if (tier === "visible") hasBeenVisible.add(screen.id);
      next.set(screen.id, tier);
    });
    return next;
  }, [activeId, canvasFrames, canvasZoom, pan, selectedIdSet, surfaceSize]);
  const topScreenId = useMemo(
    () =>
      selectedIds.find((id) =>
        canvasFrames.some(({ screen }) => screen.id === id),
      ) ??
      (activeId && canvasFrames.some(({ screen }) => screen.id === activeId)
        ? activeId
        : canvasFrames[0]?.screen.id),
    [activeId, canvasFrames, selectedIds],
  );
  // PF16: previously this reordered canvasFrames so the top screen's keyed
  // entry moved to the end of the array. Since screens are keyed by
  // screen.id, moving a key's position in a mapped list makes React move
  // that DOM node (iframe) to match — which reloads the iframe's document,
  // producing a visible white flash every time selection changes. zIndex
  // (boosted for the top screen in Screen's root style, see
  // TOP_SCREEN_Z_BOOST) already expresses "paint above its siblings" without
  // needing to touch DOM order, so render canvasFrames in stable order.
  // PF21: renderScreenContent produces a brand-new ReactNode (a live
  // <DesignCanvas> instance) per screen every time it's called, and this used
  // to be called once per screen on *every* canvasFrames rebuild — including
  // every rAF tick of a single screen's move/resize/rotate drag, since
  // updateFrameGeometry replaces the whole `frameGeometry` object each tick.
  // Screen is memo()'d with areScreenPropsEqual, which bails only when
  // `prev.screenContent === next.screenContent` (identity, not value) — so a
  // fresh ReactNode for every screen on every tick defeated that memo for the
  // entire board, not just the one screen actually being dragged.
  //
  // renderScreenContent's own inputs, per DesignEditor's implementation, are:
  // (1) `screen` — content/identity, (2) resolved `metadata`, and (3) the
  // *rounded* `geometry.width`/`geometry.height` (fed to a small embeddedFrame
  // cache keyed by `${width}x${height}`; DesignCanvas renders that frame at
  // 100%/100% of its container, so fractional width/height jitter and all
  // `geometry.x`/`geometry.y` changes are irrelevant to the produced node —
  // position is applied entirely by Screen's own wrapper transform/left/top).
  // renderScreenContent's *identity* is also a real input: DesignEditor hoists
  // it in a useCallback, but its dependency list includes hover/selection
  // state that legitimately changes what it renders for every screen (e.g.
  // which screen shows a hover outline), so a change in that identity must
  // invalidate every screen's cached node — it is not safe to assume "this
  // screen's own inputs are unchanged" is sufficient when the callback itself
  // changed. In practice renderScreenContent's identity does NOT change from
  // frameGeometry motion alone (DesignEditor never setStates on drag-move
  // ticks), so a pure move/resize/rotate drag keeps it stable and this cache
  // still gives every non-dragged screen a hit.
  const screenContentById = useMemo(() => {
    if (!renderScreenContent) return new Map<string, ReactNode>();
    const cache = screenContentCacheRef.current;
    const nextIds = new Set<string>();
    const next = new Map<string, ReactNode>();
    canvasFrames.forEach(({ screen, metadata, geometry }) => {
      // Overview viewport culling (PF22): a screen that has never been
      // visible this session ("placeholder" tier) skips renderScreenContent
      // entirely instead of mounting the real (DesignEditor-provided)
      // content node and hiding it — for boards with 100+ screens this is
      // the actual cost renderScreenContent exists to avoid paying (it
      // mounts a live DesignCanvas/iframe per screen). Once a screen has
      // ever been visible ("visible" or "culled" tier) it keeps getting a
      // real content node forever after, per the "never unmount a live
      // iframe" rule — see Screen's contentVisibility handling below for how
      // a "culled" tier screen's mounted iframe is cheaply hidden instead.
      const tier = screenCullTierById.get(screen.id) ?? "visible";
      if (tier === "placeholder") {
        // Also drop any stale cache entry so a screen that regresses to
        // never-rendered (shouldn't normally happen, but keeps the cache
        // honest) doesn't resurrect a stale node later.
        cache.delete(screen.id);
        return;
      }
      nextIds.add(screen.id);
      next.set(
        screen.id,
        getCachedScreenContentNode(
          cache,
          screen,
          metadata,
          geometry,
          renderScreenContent,
        ),
      );
    });
    for (const id of cache.keys()) {
      if (!nextIds.has(id)) cache.delete(id);
    }
    return next;
  }, [canvasFrames, renderScreenContent, screenCullTierById]);
  // PF19: filters/maps over canvasFrames + a getFrameGroupBounds pass — cheap
  // for a handful of screens, but this runs on every render (hover, hint
  // text, unrelated state), not just selection changes. Memoize keyed on the
  // actual selection + frame list so unrelated renders reuse the prior arrays
  // (and downstream consumers like SelectionBox/GroupSelectionBox, which take
  // these by reference, skip re-rendering too).
  const selectedFrameEntries = useMemo(
    () =>
      canvasFrames
        .filter(({ screen }) => selectedIdSet.has(screen.id))
        .map(({ screen, geometry }) => ({ id: screen.id, geometry })),
    [canvasFrames, selectedIdSet],
  );
  const selectedGroupBounds = useMemo(
    () =>
      selectedFrameEntries.length > 1
        ? getFrameGroupBounds(selectedFrameEntries)
        : null,
    [selectedFrameEntries],
  );
  const hasGroupSelection = !!selectedGroupBounds;
  const selectedDraftEntries = useMemo(
    () =>
      draftPrimitives
        .filter((draft) => selectedDraftIdSet.has(draft.id))
        .map((draft) => ({ id: draft.id, geometry: draft.geometry })),
    [draftPrimitives, selectedDraftIdSet],
  );
  const selectedDraftGroupBounds = useMemo(
    () =>
      selectedDraftEntries.length > 1
        ? getFrameGroupBounds(selectedDraftEntries)
        : null,
    [selectedDraftEntries],
  );
  const singleSelectedFrame =
    selectedFrameEntries.length === 1 && !selectedGroupBounds
      ? selectedFrameEntries[0]
      : null;
  // BP-DEEP v2 item 3 — when the single selected screen's active edit target
  // is one of its breakpoint sub-frames, that sub-frame's own accent chrome
  // is the selection; suppress the base frame's SelectionBox (corner/rotate
  // handles + outline) so only ONE frame reads as selected.
  const singleSelectedFrameScreen = singleSelectedFrame
    ? canvasFrames.find((entry) => entry.screen.id === singleSelectedFrame.id)
        ?.screen
    : undefined;
  const suppressBaseSelectionBox = Boolean(
    singleSelectedFrameScreen &&
    isBreakpointSelectionTarget(singleSelectedFrameScreen),
  );
  const singleSelectedDraft =
    selectedDraftEntries.length === 1 && !selectedDraftGroupBounds
      ? selectedDraftEntries[0]
      : null;
  const rootSelectedEntryCount =
    selectedFrameEntries.length + selectedDraftEntries.length;
  const showPassiveRootSelectionBoxes = rootSelectedEntryCount > 1;
  // Gradient-edit overlay (Figma-parity on-canvas handles): only renders for
  // the single selected screen frame or draft primitive whose id matches
  // `gradientEditTarget.frameOrDraftId` — a stale/mismatched target (e.g. the
  // caller hasn't cleared it after selection changed) simply renders nothing
  // rather than drawing chrome over the wrong element.
  const gradientOverlayGeometry =
    gradientEditTarget &&
    (singleSelectedFrame?.id === gradientEditTarget.frameOrDraftId
      ? singleSelectedFrame.geometry
      : singleSelectedDraft?.id === gradientEditTarget.frameOrDraftId
        ? singleSelectedDraft.geometry
        : null);
  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="relative h-full w-full select-none overflow-hidden outline-none"
      onMouseDownCapture={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setAltHoverMeasurement(null)}
      onDragEnter={handleCanvasDragEnter}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
      style={{
        cursor: surfaceCursor,
        overscrollBehavior: "none",
        touchAction: "none",
      }}
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
          hasBoardSurfaceContent(boardFileContent) &&
          (() => {
            const boardGeo = boardFrameGeometry ?? {
              x: 0,
              y: 0,
              width: 8192,
              height: 8192,
            };
            const boardW = boardGeo.width;
            const boardH = boardGeo.height;
            const boardContentKey = getBoardContentKey({
              boardFileId,
              boardFileContent,
              boardIsActive,
            });
            const boardLayerSignature =
              getBoardContentLayerSignature(boardFileContent);
            const boardRenderContent =
              getBoardSurfaceRenderContent(boardFileContent);
            return (
              // Overflow-hidden wrapper so the board iframe never bleeds outside
              // its declared logical surface. z-index 0 keeps it below screen
              // iframes (which have their own stacking context above this).
              <div
                className="[&_.design-canvas-iframe-wrapper]:shadow-none [&_.design-canvas-iframe-wrapper]:ring-0"
                // PERF9-WHEEL: stable hook so markWheelGestureActive can mute
                // this layer's pointer events imperatively during a wheel
                // gesture, exactly like the [data-screen-content] wrappers.
                data-board-surface-layer
                style={getBoardSurfaceLayerStyle({
                  geometry: boardGeo,
                  interactive: boardSurfaceInteractive,
                })}
              >
                <DesignCanvas
                  content={boardRenderContent}
                  contentKey={boardContentKey}
                  runtimeReplacementContent={boardRenderContent}
                  runtimeReplacementKey={`${boardFileId}:layers:${boardLayerSignature}`}
                  screenId={boardFileId}
                  zoom={100}
                  deviceFrame="none"
                  boardSurface
                  embeddedFrameBackground={BOARD_SURFACE_BACKGROUND}
                  embeddedFrame={{
                    viewportWidth: Math.max(1, Math.round(boardW)),
                    viewportHeight: Math.max(1, Math.round(boardH)),
                    displayWidth: Math.max(1, Math.round(boardW)),
                    displayHeight: Math.max(1, Math.round(boardH)),
                    fluid: true,
                    contentOffsetX: -boardGeo.x,
                    contentOffsetY: -boardGeo.y,
                  }}
                  editorChromeScaleX={canvasZoom / 100}
                  editorChromeScaleY={canvasZoom / 100}
                  editMode={boardEditMode}
                  interactMode={false}
                  scaleMode={boardIsActive && effectiveTool === "scale"}
                  clearSelectionRequest={boardClearSelectionRequest}
                  selectedSelector={
                    boardIsActive ? (boardSelectedSelector ?? null) : null
                  }
                  selectedSelectorCandidates={
                    boardIsActive ? (boardSelectedSelectorCandidates ?? []) : []
                  }
                  selectedSelectorGroups={
                    selectedLayerSelectorGroupsByScreen[boardFileId] ?? []
                  }
                  hoveredSelector={boardHoveredSelector ?? null}
                  hoveredSelectorCandidates={
                    boardHoveredSelectorCandidates ?? []
                  }
                  lockedSelectors={boardLockedSelectors ?? []}
                  hiddenSelectors={boardHiddenSelectors ?? []}
                  // Board owns the global window runtime bridge only when it is
                  // the active surface (activeFileId === boardFileId). This is
                  // the XOR counterpart to the active screen's
                  // registerRuntimeBridge={screenIsActive}: since activeFileId
                  // is exclusive, the board and any screen can never both
                  // register at once, so window.__designCanvas* in-place ops
                  // (delete removal, begin-text-edit) target the board exactly
                  // like a screen. editMode stays always-editable so a board
                  // element can still be clicked to select it before the board
                  // becomes active.
                  registerRuntimeBridge={boardIsActive}
                  onElementSelect={onBoardElementSelect ?? (() => {})}
                  onElementMarqueeSelect={onBoardElementMarqueeSelect}
                  onElementHover={onBoardElementHover ?? (() => {})}
                  onClearSelection={onBoardElementClear}
                  onIframeHotkey={onBoardIframeHotkey}
                  onFigmaClipboardPaste={onBoardFigmaClipboardPaste}
                  onIframeContextMenu={onBoardIframeContextMenu}
                  onVisualStructureChange={onBoardVisualStructureChange}
                  onVisualStyleChange={onBoardVisualStyleChange}
                  onVisualDuplicateChange={onBoardVisualDuplicateChange}
                  onTextContentChange={onBoardTextContentChange}
                  onTextEditingStateChange={onBoardTextEditingStateChange}
                  onElementDblClickText={onBoardElementDblClickText}
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
              cullTier={screenCullTierById.get(screen.id) ?? "visible"}
              isActive={screen.id === activeId}
              isTopScreen={screen.id === topScreenId}
              // BP-DEEP v2 item 3 — while a breakpoint sub-frame is the
              // active edit target, IT carries the selection chrome (accent
              // border + label); the base frame renders unselected so the
              // two never read as simultaneously selected.
              isSelected={
                selectedIdSet.has(screen.id) &&
                !isBreakpointSelectionTarget(screen)
              }
              showFullView={fullViewIdSet.has(screen.id)}
              isDirectlyHovered={screen.id === directlyHoveredScreenId}
              isFileDragOver={
                fileDragOverFrameId !== null &&
                screen.id === fileDragOverFrameId
              }
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
              // Pass the id-first callbacks straight through (PF18): Screen
              // itself binds screen.id when it calls these, so every screen
              // instance gets the exact same stable function reference here
              // instead of a fresh per-screen closure allocated on every
              // MultiScreenCanvas render, which used to defeat memo(Screen).
              onAddBreakpoint={onAddBreakpoint}
              onActiveBreakpointChange={onActiveBreakpointChange}
              onRemoveBreakpoint={onRemoveBreakpoint}
              onChangeBreakpointWidth={onChangeBreakpointWidth}
              onEditBreakpoint={onEditBreakpoint}
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

        {showPassiveRootSelectionBoxes
          ? selectedFrameEntries.map((entry) => (
              <PassiveSelectionBox
                key={`selected-frame-${entry.id}`}
                geometry={entry.geometry}
                chromeScale={chromeScale}
                chromeSettling={chromeSettling}
              />
            ))
          : null}

        {showPassiveRootSelectionBoxes
          ? selectedDraftEntries.map((entry) => (
              <PassiveSelectionBox
                key={`selected-draft-${entry.id}`}
                geometry={entry.geometry}
                chromeScale={chromeScale}
                chromeSettling={chromeSettling}
              />
            ))
          : null}

        {displayedPenPath ? (
          <PenPathOverlay
            path={displayedPenPath}
            closeHover={penCloseHover}
            chromeScale={chromeScale}
          />
        ) : null}

        {vectorEdit ? (
          <VectorEditOverlay
            vectorEdit={vectorEdit}
            chromeScale={chromeScale}
          />
        ) : null}

        {gradientEditTarget && gradientOverlayGeometry ? (
          <GradientEditOverlay
            target={gradientEditTarget}
            geometry={gradientOverlayGeometry}
            chromeScale={chromeScale}
          />
        ) : null}

        {singleSelectedFrame && !suppressBaseSelectionBox ? (
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
            onStartRotate={beginGroupRotate}
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

        {/* Smart-spacing guides (CV11): highlight both equal-sized gaps
            around the moving frame, with one label showing the shared
            distance. */}
        {equalGapGuides.map((guide, index) =>
          guide.bands.map((band, bandIndex) => (
            <span
              key={`equal-gap-${guide.orientation}-${index}-${bandIndex}`}
              className="pointer-events-none absolute z-30 bg-[var(--design-editor-accent-color)]/25"
              style={
                guide.orientation === "vertical"
                  ? {
                      left: SURFACE_PADDING + band.gapStart,
                      top: SURFACE_PADDING + band.crossStart,
                      width: Math.max(1, band.gapEnd - band.gapStart),
                      height: Math.max(1, band.crossEnd - band.crossStart),
                    }
                  : {
                      left: SURFACE_PADDING + band.crossStart,
                      top: SURFACE_PADDING + band.gapStart,
                      width: Math.max(1, band.crossEnd - band.crossStart),
                      height: Math.max(1, band.gapEnd - band.gapStart),
                    }
              }
            />
          )),
        )}

        {/* Figma-parity alt-hover measurement: red edge-to-edge distance
            lines between the current selection and whatever frame/draft is
            under the cursor while Alt is held (pure hover, no drag). */}
        {[altHoverMeasurement?.horizontal, altHoverMeasurement?.vertical]
          .filter(
            (line): line is AltHoverMeasurementLine => !!line && !line.overlaps,
          )
          .map((line) => (
            <span
              key={`alt-hover-${line.orientation}`}
              className="pointer-events-none absolute z-40 bg-destructive"
              style={
                line.orientation === "vertical"
                  ? {
                      left: SURFACE_PADDING + line.crossPosition,
                      top: SURFACE_PADDING + line.start,
                      width: 1,
                      height: Math.max(1, line.end - line.start),
                    }
                  : {
                      left: SURFACE_PADDING + line.start,
                      top: SURFACE_PADDING + line.crossPosition,
                      width: Math.max(1, line.end - line.start),
                      height: 1,
                    }
              }
            />
          ))}
      </div>

      {/* Alt-hover measurement distance labels — same render-outside-the-
          transformed-world reasoning as the equal-gap labels below. */}
      {[altHoverMeasurement?.horizontal, altHoverMeasurement?.vertical]
        .filter(
          (line): line is AltHoverMeasurementLine => !!line && !line.overlaps,
        )
        .map((line) => {
          const mid = (line.start + line.end) / 2;
          const labelCanvasPoint =
            line.orientation === "vertical"
              ? { x: line.crossPosition, y: mid }
              : { x: mid, y: line.crossPosition };
          return (
            <span
              key={`alt-hover-label-${line.orientation}`}
              className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded bg-destructive px-1 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground shadow-sm"
              style={{
                left: pan.x + (SURFACE_PADDING + labelCanvasPoint.x) * scale,
                top: pan.y + (SURFACE_PADDING + labelCanvasPoint.y) * scale,
              }}
            >
              {Math.round(line.gap)}
            </span>
          );
        })}

      {/* Equal-gap distance labels render outside the pan/scale-transformed
          world container (same reasoning as the marquee/duplicate-preview
          overlays above it) so they need the explicit
          pan + (SURFACE_PADDING + canvasCoord) * scale conversion instead of
          the raw canvas coordinates the bands above use inside that
          container. */}
      {equalGapGuides.map((guide, index) => {
        const band = guide.bands[0];
        const crossMid = (band.crossStart + band.crossEnd) / 2;
        const gapMid = (band.gapStart + band.gapEnd) / 2;
        const labelCanvasPoint =
          guide.orientation === "vertical"
            ? { x: gapMid, y: crossMid }
            : { x: crossMid, y: gapMid };
        return (
          <span
            key={`equal-gap-label-${guide.orientation}-${index}`}
            className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--design-editor-accent-color)] px-1 py-0.5 text-[10px] font-medium leading-none text-[var(--design-editor-accent-contrast-color)] shadow-sm"
            style={{
              left: pan.x + (SURFACE_PADDING + labelCanvasPoint.x) * scale,
              top: pan.y + (SURFACE_PADDING + labelCanvasPoint.y) * scale,
            }}
          >
            {Math.round(guide.gap)}
          </span>
        );
      })}

      {penActive || creationToolActive ? (
        <div
          data-canvas-creation-shield
          className="pointer-events-auto absolute inset-0 z-30 cursor-crosshair"
          aria-hidden="true"
        />
      ) : null}

      {marquee ? (
        <span
          ref={marqueeOverlayRef}
          className="pointer-events-none absolute z-40 border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)]"
          style={{
            // Convert canvas-space marquee to surface-space so this overlay
            // is never clipped or hidden by the canvas transform container.
            // Surface position = pan + (SURFACE_PADDING + canvasCoord) * scale
            // NOTE: this uses React `pan`/`scale`, which only update on the
            // debounced view-commit — during an active wheel/pinch gesture
            // (e.g. two-finger pan while marquee-dragging) applyViewToDom
            // keeps this element's position in sync imperatively via
            // marqueeOverlayRef, the same way it already does for the world
            // transform and pixel grid.
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
            <span className="max-w-[190px] truncate !text-[11px] font-medium text-foreground">
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
          className="pointer-events-none fixed z-50 rounded border border-border bg-background/95 px-1.5 py-0.5 font-mono !text-[11px] leading-5 text-foreground shadow-lg backdrop-blur"
          style={{ left: transformBadge.x, top: transformBadge.y }}
        >
          {transformBadge.text}
        </div>
      ) : null}

      {crossScreenDropGuide ? (
        <span
          data-cross-screen-drop-guide
          className="pointer-events-none absolute z-50 rounded-sm shadow-[0_0_0_1px_var(--design-editor-accent-contrast-color)]"
          style={getCrossScreenDropGuideStyle({
            guide: crossScreenDropGuide,
            pan,
            scale,
          })}
        />
      ) : null}

      {/* Cross-screen element drag: ghost follows the board-space cursor. */}
      {crossScreenGhost &&
      (crossScreenSourceIsBoard || !crossScreenDropGuide) ? (
        <span
          data-cross-screen-drag-ghost
          className="pointer-events-none absolute z-40 rounded border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]/20 shadow"
          style={{
            // Board-origin drags use the real layer size/top-left so the
            // proxy stays above screen iframes; screen-origin drags keep the
            // older compact cursor ghost.
            left:
              pan.x +
              (SURFACE_PADDING + crossScreenGhost.boardX) * scale -
              (crossScreenGhost.width ? 0 : 8),
            top:
              pan.y +
              (SURFACE_PADDING + crossScreenGhost.boardY) * scale -
              (crossScreenGhost.height ? 0 : 8),
            width: Math.max(1, (crossScreenGhost.width ?? 16) * scale),
            height: Math.max(1, (crossScreenGhost.height ?? 16) * scale),
            opacity: crossScreenGhost.dimmed ? 0.4 : 1,
          }}
        />
      ) : null}
    </div>
  );
});

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
      // PERF9: stable per-draft lookup key so beginDraftDrag can grab this
      // exact DOM node once at drag-start and mutate its style.left/top
      // directly on every rAF tick instead of committing React state
      // (setDraftPrimitives) every frame — see beginFrameDrag's matching
      // data-frame-id comment above.
      data-draft-id={draft.id}
      type="button"
      className={cn(
        "group/artboard pointer-events-auto absolute block overflow-visible text-left outline-none",
        preview || penActive ? "cursor-crosshair" : "cursor-pointer",
      )}
      style={{
        ...frameStyleLeftTop(geometry),
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
        rotationDeg={draft.geometry.rotation ?? 0}
        frameWidth={draft.geometry.width}
        frameHeight={draft.geometry.height}
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
    // Figma parity: a freshly drawn line/arrow/pen path defaults to solid
    // black at 1px (DEFAULT_LINE_STROKE / DEFAULT_LINE_STROKE_WIDTH_PX in
    // canvas-primitive-style.ts), matching the committed board-file output
    // and DesignEditor's appendCanvasPrimitiveToHtml. The arrowhead marker's
    // fill is set to this same resolved stroke color (not `currentColor`) so
    // it never disagrees with the shaft when a custom stroke is chosen.
    const resolvedStroke = draft.stroke ?? DEFAULT_LINE_STROKE;
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
              <path d="M 0 0 L 10 5 L 0 10 z" fill={resolvedStroke} />
            </marker>
          </defs>
        ) : null}
        <path
          d={pathData}
          fill="none"
          stroke={resolvedStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={draft.strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX}
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
  chromeScale,
}: {
  path: PenPath;
  closeHover: boolean;
  chromeScale: number;
}) {
  const geometry = getPenPathGeometry(path);
  const pathData = serializePenPath(path);
  // PenPathOverlay lives inside the pan/zoom-scaled world container, so raw
  // px sizes here would shrink to specks at low zoom and blow up into blobs
  // at high zoom. Scale every screen-space size (anchor/handle boxes,
  // stroke widths) by chromeScale (= 1 / zoomScale) the same way
  // SelectionBox's resize/rotate handles do, so they stay a constant size
  // on screen regardless of canvas zoom.
  const anchorSize = 8 * chromeScale;
  const handleSize = 6 * chromeScale;
  const anchorBorderWidth = Math.max(1, chromeScale);
  const handleBorderWidth = Math.max(1, chromeScale);
  const outlineStrokeWidth = 5 * chromeScale;
  const strokeWidth = 2 * chromeScale;
  const handleLineStrokeWidth = Math.max(1, chromeScale);
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
                strokeWidth={handleLineStrokeWidth}
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
                strokeWidth={handleLineStrokeWidth}
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
          strokeWidth={outlineStrokeWidth}
        />
        <path
          d={pathData}
          fill="none"
          stroke="var(--design-editor-accent-color)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />
      </svg>
      {path.nodes.map((node, index) => (
        <span
          key={`anchor-${index}`}
          data-pen-anchor
          className={cn(
            "absolute rounded-[2px] border shadow-sm",
            index === 0 && closeHover
              ? "scale-125 border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)] ring-4 ring-[var(--design-editor-selection-color)]"
              : "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)]",
          )}
          style={{
            left: node.point.x - geometry.x - anchorSize / 2,
            top: node.point.y - geometry.y - anchorSize / 2,
            width: anchorSize,
            height: anchorSize,
            borderWidth: anchorBorderWidth,
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
              className="absolute rounded-full border border-[var(--design-editor-accent-color)] bg-background shadow-sm"
              style={{
                left: handle.x - geometry.x - handleSize / 2,
                top: handle.y - geometry.y - handleSize / 2,
                width: handleSize,
                height: handleSize,
                borderWidth: handleBorderWidth,
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

/**
 * Interactive counterpart of `PenPathOverlay` (P-VE1): renders the same
 * anchor-square / handle-circle / dashed-connector visual language, sized by
 * `chromeScale` so it stays a constant screen size at any zoom — like
 * `SelectionBox`'s resize handles, not like `PenPathOverlay`'s fixed-size
 * (non-interactive) chrome. Lives inside the pan/zoom-scaled `world`
 * container alongside `PenPathOverlay`/`SelectionBox`, positioned in canvas
 * space via `originCanvas + local point` (`vectorEditLocalToCanvasPoint`).
 *
 * Purely visual: pointer interaction (hit-testing + drag) is owned entirely
 * by the parent's `handleMouseDown`, which runs on the capture phase and
 * resolves hitTestPenHandle/hitTestPenAnchor itself against the raw click
 * point (handles take priority over anchors when both are in range) — see
 * the `vectorEdit` branch there. This mirrors how `PenPathOverlay` is a pure
 * render of `activePenPath`/`penGesturePreview` state owned by the pen-tool
 * gesture handlers rather than an independently-interactive component.
 */
function VectorEditOverlay({
  vectorEdit,
  chromeScale,
}: {
  vectorEdit: VectorEditOverlayState;
  chromeScale: number;
}) {
  const { path, originCanvas } = vectorEdit;
  // Render in canvas space: every local point is offset by the path's
  // canvas origin before being laid out, so the overlay's own geometry/
  // pathData stay in the same canvas coordinate frame PenPathOverlay uses.
  const canvasPath = useMemo<PenPath>(
    () => translatePenPath(path, originCanvas.x, originCanvas.y),
    [path, originCanvas.x, originCanvas.y],
  );
  const geometry = getPenPathGeometry(canvasPath);
  const pathData = serializePenPath(canvasPath);

  const anchorSize = 9 * chromeScale;
  const handleSize = 7 * chromeScale;
  const anchorBorderWidth = Math.max(1, 1.5 * chromeScale);
  const handleBorderWidth = Math.max(1, chromeScale);
  const outlineStrokeWidth = 5 * chromeScale;
  const strokeWidth = 2 * chromeScale;
  const handleLineStrokeWidth = Math.max(1, chromeScale);

  return (
    <div
      data-vector-edit-overlay
      // pointer-events:auto on the overlay's own bounding box (not each
      // anchor/handle) so a click anywhere within it is captured by the
      // surface's onMouseDownCapture handler for hit-testing, while empty
      // space *outside* this box still reaches the surface as a background
      // click (which exits vector edit mode) via CSS containment rather than
      // per-element listeners.
      className="pointer-events-auto absolute z-[95]"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
    >
      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox={`${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`}
      >
        {canvasPath.nodes.map((node, index) => (
          <g key={`vector-handle-lines-${index}`}>
            {node.handleIn ? (
              <line
                x1={node.point.x}
                y1={node.point.y}
                x2={node.handleIn.x}
                y2={node.handleIn.y}
                stroke="var(--design-editor-accent-color)"
                strokeDasharray="3 3"
                strokeWidth={handleLineStrokeWidth}
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
                strokeWidth={handleLineStrokeWidth}
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
          strokeWidth={outlineStrokeWidth}
        />
        <path
          d={pathData}
          fill="none"
          stroke="var(--design-editor-accent-color)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />
      </svg>
      {canvasPath.nodes.map((node, index) => (
        <span
          key={`vector-anchor-${index}`}
          data-vector-anchor
          className="pointer-events-none absolute rounded-[2px] border shadow-sm border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)]"
          style={{
            left: node.point.x - geometry.x - anchorSize / 2,
            top: node.point.y - geometry.y - anchorSize / 2,
            width: anchorSize,
            height: anchorSize,
            borderWidth: anchorBorderWidth,
          }}
        />
      ))}
      {canvasPath.nodes.flatMap((node, index) =>
        (
          [
            ["in", node.handleIn] as const,
            ["out", node.handleOut] as const,
          ] as const
        )
          .filter((entry): entry is ["in" | "out", Point] => isPoint(entry[1]))
          .map(([which, handle]) => (
            <span
              key={`vector-handle-${index}-${which}`}
              data-vector-handle
              className="pointer-events-none absolute rounded-full border border-[var(--design-editor-accent-color)] bg-background shadow-sm"
              style={{
                left: handle.x - geometry.x - handleSize / 2,
                top: handle.y - geometry.y - handleSize / 2,
                width: handleSize,
                height: handleSize,
                borderWidth: handleBorderWidth,
              }}
            />
          )),
      )}
    </div>
  );
}

/** Which part of the gradient the user is currently dragging on canvas. */
type GradientDragKind =
  | { kind: "endpoint"; which: "start" | "end" }
  | { kind: "stop"; stopId: string };

/**
 * Figma-parity on-canvas gradient editing handles (see the
 * `gradientEditTarget` prop / `GradientEditOverlayTarget` doc above). Purely
 * a linear-gradient-line renderer + its own pointer
 * handlers: unlike `VectorEditOverlay` (whose drag is owned by the parent
 * surface's capture-phase mousedown handler), this overlay is small and
 * self-contained enough to own its own drag gesture directly — there's no
 * existing shared gesture-state plumbing for gradients to hook into, and
 * adding one to the giant `MultiScreenCanvas` drag-state machine for a
 * single, independent overlay would be the wrong trade. Mirrors
 * `GradientEditor`'s own pointer-capture + preview/commit conventions
 * (`startStopDrag`/`handleStopPointerMove`/`endStopDrag`) so dragging here
 * and dragging the inspector's ramp bar feel identical.
 */
function GradientEditOverlay({
  target,
  geometry,
  chromeScale,
}: {
  target: GradientEditOverlayTarget;
  geometry: FrameGeometry;
  chromeScale: number;
}) {
  const gradient = useMemo(
    () => parseGradientCss(target.cssValue, "linear"),
    [target.cssValue],
  );
  const dragRef = useRef<{
    kind: GradientDragKind;
    pointerId: number;
  } | null>(null);
  // Rect used to convert pointer clientX/Y back to the overlay's own local
  // (unrotated) coordinate space. Always the *outer* container div — not
  // whichever small handle span the pointer landed on — so the scale-only
  // inverse in `localPointFromEvent` is correct regardless of which handle
  // started the drag (pointer capture keeps delivering events to that span,
  // but its own rect is the wrong reference frame for this math).
  const containerRef = useRef<HTMLDivElement>(null);

  // Linear-only (P0 scope, see prop doc): non-linear/unparseable values
  // render nothing rather than guessing at radial/angular chrome.
  if (!gradient || gradient.kind !== "linear") return null;

  const { width, height } = geometry;
  const { start, end } = gradientLineEndpoints(gradient.angle, width, height);
  const stopPoints = gradientStopPoints(
    gradient.angle,
    width,
    height,
    gradient.stops,
  );

  const emit = (
    nextGradient: {
      kind: "linear";
      angle: number;
      stops: GradientStopValue[];
    },
    phase: "preview" | "commit",
  ) => {
    target.onChange(gradientToCss(nextGradient), { phase });
  };

  const localPointFromEvent = (
    event: ReactPointerEvent<HTMLElement>,
  ): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    // rect is the container's on-screen box (already rotated by the CSS
    // `transform`, since getBoundingClientRect measures the rotated result);
    // for chromeScale=1:1 zoom with no rotation this reduces to a plain
    // offset. At non-1:1 zoom the container is still laid out at exactly
    // `width x height` local units (zoom only scales the ancestor `world`
    // transform, not this element's own box), so rect.width/height already
    // equals width/height on-screen and this scale factor stays ~1 in the
    // common (unrotated) case; for a rotated target the bounding rect is the
    // rotated AABB, so this remains an approximation — acceptable for P0
    // since draft primitives/screen frames are typically edited unrotated
    // and rotation support can be revisited alongside radial handles.
    const scaleX = rect.width / width || 1;
    const scaleY = rect.height / height || 1;
    return {
      x: (event.clientX - rect.left) / scaleX,
      y: (event.clientY - rect.top) / scaleY,
    };
  };

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    dragKind: GradientDragKind,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    dragRef.current = { kind: dragKind, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !gradient) return;
    const local = localPointFromEvent(event);
    if (drag.kind.kind === "endpoint") {
      const nextAngle = angleFromDraggedEndpoint(
        local,
        width,
        height,
        drag.kind.which,
      );
      emit(
        { kind: "linear", angle: nextAngle, stops: gradient.stops },
        "preview",
      );
      return;
    }
    const stopId = drag.kind.stopId;
    const nextPosition = stopPercentFromDraggedPoint(
      local,
      gradient.angle,
      width,
      height,
    );
    emit(
      {
        kind: "linear",
        angle: gradient.angle,
        stops: gradient.stops.map((stop) =>
          stop.id === stopId ? { ...stop, position: nextPosition } : stop,
        ),
      },
      "preview",
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!gradient) return;
    emit(
      { kind: "linear", angle: gradient.angle, stops: gradient.stops },
      "commit",
    );
  };

  const endpointSize = 10 * chromeScale;
  const endpointBorderWidth = Math.max(1, 1.5 * chromeScale);
  const stopSize = 12 * chromeScale;
  const stopBorderWidth = Math.max(1, 2 * chromeScale);
  const lineStrokeWidth = Math.max(1, 1.5 * chromeScale);

  return (
    <div
      ref={containerRef}
      data-gradient-edit-overlay
      className="pointer-events-none absolute z-[96]"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${geometry.height / 2}px`,
      }}
    >
      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="rgba(255,255,255,0.95)"
          strokeWidth={lineStrokeWidth + 1.5 * chromeScale}
        />
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke="var(--design-editor-accent-color)"
          strokeWidth={lineStrokeWidth}
        />
      </svg>

      {(["start", "end"] as const).map((which) => {
        const point = which === "start" ? start : end;
        return (
          <span
            key={`gradient-endpoint-${which}`}
            data-gradient-endpoint={which}
            role="slider"
            aria-label={
              which === "start"
                ? "Gradient start" /* i18n-ignore */
                : "Gradient end" /* i18n-ignore */
            }
            aria-valuenow={Math.round(gradient.angle)}
            className="pointer-events-auto absolute cursor-move rounded-[2px] border bg-[var(--design-editor-accent-contrast-color)] border-[var(--design-editor-accent-color)] shadow"
            style={{
              left: point.x - endpointSize / 2,
              top: point.y - endpointSize / 2,
              width: endpointSize,
              height: endpointSize,
              borderWidth: endpointBorderWidth,
            }}
            onPointerDown={(e) => beginDrag(e, { kind: "endpoint", which })}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        );
      })}

      {stopPoints.map((point, index) => {
        const stop = gradient.stops[index];
        if (!stop) return null;
        return (
          <span
            key={`gradient-stop-${stop.id}`}
            data-gradient-stop={stop.id}
            role="slider"
            aria-label={`${stop.color} at ${Math.round(stop.position)}%`}
            aria-valuenow={Math.round(stop.position)}
            className="pointer-events-auto absolute cursor-grab rounded-full border shadow active:cursor-grabbing border-white"
            style={{
              left: point.x - stopSize / 2,
              top: point.y - stopSize / 2,
              width: stopSize,
              height: stopSize,
              borderWidth: stopBorderWidth,
              backgroundColor: stop.color,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
            }}
            onPointerDown={(e) =>
              beginDrag(e, { kind: "stop", stopId: stop.id })
            }
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        );
      })}
    </div>
  );
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

/**
 * The `data-screen-iframe-id` DOM attribute value for a screen's PRIMARY
 * iframe. Breakpoint sub-frames (see BreakpointPreviewRow) get their own
 * distinct suffixed id via `getBreakpointIframeId` so `querySelector`
 * (which always returns the first DOM match) can't silently collide two
 * different iframes onto the same id.
 */
export function getPrimaryIframeId(screenId: string): string {
  return screenId;
}

/** The `data-screen-iframe-id` value for one specific breakpoint sub-frame. */
export function getBreakpointIframeId(
  screenId: string,
  widthPx: number,
): string {
  return `${screenId}::bp-${widthPx}`;
}

/**
 * BP-DEEP v2 item 3 — whether the selection chrome for a selected screen
 * belongs on one of its BREAKPOINT sub-frames instead of the base frame:
 * true when the screen's active breakpoint width is set AND still exists in
 * its breakpoint set (a stale width from a removed breakpoint falls back to
 * the base frame carrying selection as usual). While true, the base frame
 * suppresses its own selected chrome (label emphasis + SelectionBox corner
 * handles) so exactly ONE frame — the active edit target — reads as
 * selected. Pure/exported for unit tests.
 */
export function isBreakpointSelectionTarget(screen: {
  breakpointWidths?: number[];
  activeBreakpointWidth?: number;
}): boolean {
  return (
    screen.activeBreakpointWidth != null &&
    (screen.breakpointWidths ?? []).includes(screen.activeBreakpointWidth)
  );
}

/**
 * Resolves which iframe DOM id actually represents `screen` right now for
 * hit-test / drag / wheel bridge lookups: the currently active breakpoint
 * sub-frame if one is selected, otherwise the primary iframe. Every
 * `querySelector('[data-screen-iframe-id="…"]')` call site that resolves a
 * screen id to a live iframe must go through this so an active breakpoint
 * scope actually targets the frame the user is looking at, instead of
 * always silently resolving to the primary frame regardless of which one is
 * selected.
 */
export function getActiveScreenIframeId(screen: {
  id: string;
  activeBreakpointWidth?: number;
  breakpointWidths?: number[];
}): string {
  const activeWidth = screen.activeBreakpointWidth;
  if (
    activeWidth !== undefined &&
    screen.breakpointWidths?.includes(activeWidth)
  ) {
    return getBreakpointIframeId(screen.id, activeWidth);
  }
  return getPrimaryIframeId(screen.id);
}

interface ScreenProps {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  geometry: FrameGeometry;
  isActive: boolean;
  isSelected: boolean;
  isTopScreen: boolean;
  showFullView: boolean;
  isDirectlyHovered: boolean;
  /** True while a native OS file drag is hovering this frame (Figma parity §1). */
  isFileDragOver: boolean;
  hasHoveredChild: boolean;
  groupSelected: boolean;
  handlesEnabled: boolean;
  penActive: boolean;
  creationToolActive: boolean;
  canvasGestureActive: boolean;
  chromeScale: number;
  chromeSettling: boolean;
  screenContent?: ReactNode;
  /** Overview viewport culling tier (PF22) — see computeScreenCullTier.
   *  "visible": render screenContent normally. "culled": screenContent (if
   *  any) stays mounted but is hidden from paint (visibility/
   *  content-visibility, never display:none/unmount — iframes lose all
   *  internal state on unmount). "placeholder": no screenContent was even
   *  computed for this screen (see screenContentById) — render a
   *  lightweight chrome-only placeholder instead of an iframe. */
  cullTier: ScreenCullTier;
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
  // Id-first (screenId, widthPx) shape, same as MultiScreenCanvas's own
  // onAddBreakpoint/onActiveBreakpointChange props (PF18): Screen binds
  // screen.id itself when calling these, so the parent can pass the same
  // stable function reference for every screen instead of allocating a new
  // per-screen `(widthPx) => onAddBreakpoint(screen.id, widthPx)` closure on
  // every render, which defeated memo(Screen) for every screen every time.
  onAddBreakpoint?: (screenId: string, widthPx: number) => void;
  onActiveBreakpointChange?: (
    screenId: string,
    widthPx: number | undefined,
  ) => void;
  /** Item 8b — "…" menu "Remove" on an overview breakpoint frame. */
  onRemoveBreakpoint?: (screenId: string, widthPx: number) => void;
  /** Item 8b — "…" menu "Change width" on an overview breakpoint frame. */
  onChangeBreakpointWidth?: (
    screenId: string,
    widthPx: number,
    nextWidthPx: number,
  ) => void;
  /** Item 8b — full-view entry for one breakpoint frame. */
  onEditBreakpoint?: (screenId: string, widthPx: number) => void;
}

const Screen = memo(function Screen({
  screen,
  metadata,
  geometry,
  isActive,
  isSelected,
  isTopScreen,
  showFullView,
  isDirectlyHovered,
  isFileDragOver,
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
  cullTier,
  onAddBreakpoint,
  onActiveBreakpointChange,
  onRemoveBreakpoint,
  onChangeBreakpointWidth,
  onEditBreakpoint,
}: ScreenProps) {
  const t = useT();
  const display = metadata.title ?? prettyScreenName(screen.filename);
  const previewUrl = metadata.previewUrl ?? getPreviewUrl(screen.content);
  const previewViewport = getScreenPreviewViewport(metadata, geometry);
  const suppressNextClick = useRef(false);
  // Overview viewport culling (PF22): a "culled" screen keeps its content
  // (iframe/DesignCanvas) fully mounted — unmounting would lose all internal
  // iframe state (scroll position, form input, in-progress Alpine/JS state)
  // — but skips paint/layout cost for it via visibility:hidden +
  // contentVisibility:"hidden" on the content wrapper. Deliberately NOT
  // display:none (can drop layout/scroll state on some engines) and NOT
  // will-change (a prior perf attempt using will-change on this same overview
  // caused permanent blur by pinning a low-res compositor layer — see the
  // world-transform comment near applyViewToDom). "placeholder" tier never
  // had content computed for it at all (see screenContentById), so it always
  // renders the chrome-only placeholder below regardless of this flag.
  const isCulled = cullTier === "culled";
  const [directlyHovered, setDirectlyHovered] = useState(false);
  const frameDirectlyHovered =
    (directlyHovered || isDirectlyHovered) &&
    !creationToolActive &&
    !canvasGestureActive;
  const childHoverActive =
    hasHoveredChild && !creationToolActive && !canvasGestureActive;
  const suppressFrameChromeForChild =
    hasHoveredChild && !directlyHovered && !isDirectlyHovered;
  const emphasized = isSelected || frameDirectlyHovered;
  // B5-2: the screen LABEL (dot + title text) must only pick up the accent
  // color when the label itself is hovered or the screen is selected — not
  // whenever `frameDirectlyHovered` is true, which also turns true from
  // hovering anywhere *inside* the screen's iframe content (isDirectlyHovered
  // prop, driven by handleScreenElementHover -> hoveredScreenRootId in
  // DesignEditor). `directlyHovered` is the label's own local hover state
  // (set via onMouseEnter/onMouseLeave on the data-frame-label div below), so
  // it alone (not isDirectlyHovered) is the right signal for "label hovered".
  const labelEmphasized = isSelected || directlyHovered;
  const fullViewVisible = shouldShowFrameFullViewButton({
    emphasized,
    showFullView,
    childHoverActive,
  });
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
  // BP-DEEP v2 item 1: the narrow-frame fallback that floats the Full-view
  // pill OUTSIDE the frame's right edge (left-full) lands exactly where the
  // breakpoint preview row starts, covering the first breakpoint frame's
  // label/corner (the pill is z-40 over the row). When this screen has
  // breakpoint frames, always keep the pill INSIDE the frame header —
  // labelInfoMaxWidth already reserves room for the inside placement.
  const fullViewOutsideFrame =
    frameScreenWidth < FRAME_HEADER_BUTTON_OUTSIDE_WIDTH &&
    !(screen.breakpointWidths && screen.breakpointWidths.length > 0);
  const labelInfoMaxWidth = Math.max(
    64,
    frameScreenWidth - (fullViewOutsideFrame ? 8 : FRAME_HEADER_BUTTON_RESERVE),
  );
  const fullViewMaxWidth = fullViewOutsideFrame
    ? 120
    : Math.max(84, Math.min(180, frameScreenWidth * 0.46));

  return (
    <div
      data-frame-shell
      data-screen-shell
      // PERF9: stable per-screen lookup key so beginFrameDrag can grab this
      // exact DOM node once at drag-start and mutate its style.left/top
      // directly on every rAF tick (see frameStyleLeftTop), instead of
      // committing React state (setFrameGeometry) every frame.
      data-frame-id={screen.id}
      className="group/frame pointer-events-auto absolute"
      style={{
        ...frameStyleLeftTop(geometry, frameLabelHeight),
        width: geometry.width,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${frameLabelHeight + geometry.height / 2}px`,
        zIndex: isTopScreen
          ? (geometry.z ?? 0) + TOP_SCREEN_Z_BOOST
          : geometry.z,
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
            // Matches the data-screen-card mousedown handler below: without
            // this, a trailing click after the alt-drag/duplicate gesture
            // ends falls through to this row's onClick and steals selection
            // away from the newly created duplicate.
            suppressNextClick.current = true;
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
            width: labelInfoMaxWidth,
            maxWidth: labelInfoMaxWidth,
            transform: `translateY(-50%) scale(${chromeScale})`,
            transformOrigin: "left center",
            transition: getChromeLabelTransition(chromeSettling),
          }}
        >
          {/* B5-3: the leading dot/bullet before the screen label was pure
              decorative chrome added in the Figma-parity visual pass
              (aa345ccde3, #1636) — it renders unconditionally for every
              screen with no semantic meaning (not a base/breakpoint marker,
              not a dirty/unsaved indicator), and Figma's own frame labels
              don't use one. Removed rather than kept, per B5-3 spec. */}
          <span
            data-frame-title
            className={cn(
              "min-w-0 flex-1 truncate !text-[11px] font-medium",
              labelEmphasized
                ? "text-[var(--design-editor-accent-color)]"
                : activeOrEmphasized
                  ? "text-foreground"
                  : "text-muted-foreground",
            )}
            title={screen.filename}
          >
            {display}
          </span>
          {metadata.source === "fusion" ? (
            <span
              data-frame-source-badge="fusion"
              className="shrink-0 rounded-sm bg-muted-foreground/15 px-1 !text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
              title={
                "Backed by a running app" /* i18n-ignore short frame badge, mirrors other frame-chrome literals in this file */
              }
            >
              {
                "App" /* i18n-ignore short frame badge, mirrors other frame-chrome literals in this file */
              }
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
          onEdit(screen.id, e);
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
          data-file-drag-over={isFileDragOver || undefined}
          data-cull-tier={cullTier}
          className={cn(
            "relative block h-full w-full overflow-hidden rounded-[inherit] bg-white shadow-2xl ring-1 ring-inset ring-border transition-colors",
            isFileDragOver &&
              "ring-2 ring-[var(--design-editor-accent-color)] ring-inset",
          )}
          style={{
            pointerEvents: screenContentInteractive ? "auto" : "none",
            // Tier B (PF22): keep the mounted iframe/DesignCanvas alive (see
            // the isCulled comment above) but skip its paint/layout cost.
            // visibility:hidden (not display:none) keeps the box in the
            // layout/measurement tree; contentVisibility:"hidden" skips
            // rendering its subtree entirely until it's shown again. Neither
            // property touches will-change/compositor layers, so this can't
            // reproduce the permanent-blur regression a prior will-change
            // attempt on this same surface caused.
            visibility: isCulled ? "hidden" : undefined,
            contentVisibility: isCulled ? "hidden" : undefined,
          }}
        >
          {cullTier === "placeholder" ? (
            // Tier A (PF22): this screen has never been visible this
            // session, so no iframe/DesignCanvas was ever mounted for it
            // (see screenContentById) — render inert chrome-only filler that
            // keeps the same wrapper geometry as real content so selection,
            // drag, marquee, and measurement math (all geometry-based, see
            // computeScreenCullTier's callers) stay unaffected. Deliberately
            // no iframe here at all, not even a hidden one.
            <div
              data-screen-placeholder
              aria-hidden="true"
              className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground"
            >
              <span className="max-w-[80%] truncate px-2 text-center !text-[11px] font-medium">
                {display}
              </span>
            </div>
          ) : (
            (screenContent ?? (
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
            ))
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
            // Figma parity: the hover outline is visibly thinner than the
            // 1.5 * chromeScale selection outline (SelectionBox /
            // PassiveSelectionBox) — hover is a light "you could select
            // this" hint, selection is the stronger confirmed-state chrome.
            borderWidth: chromeScale,
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
          rotationDeg={geometry.rotation ?? 0}
          frameWidth={geometry.width}
          frameHeight={geometry.height}
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
          // See getBreakpointFrameGeometry's doc comment: reusing the
          // primary frame's OWN previewViewport.scale (how far the user has
          // resized this screen's box away from its natural/metadata width)
          // keeps every frame in the row at the same on-canvas "zoom level"
          // without conflating that resize factor with the primary's aspect
          // ratio the way the original forced-height math did.
          primaryScale={previewViewport.scale}
          naturalAspect={metadata.height / Math.max(1, metadata.width)}
          previewUrl={previewUrl}
          srcdocWithHitTest={srcdocWithHitTest}
          activeBreakpointWidth={screen.activeBreakpointWidth}
          isScreenSelected={isSelected}
          penActive={penActive}
          creationToolActive={creationToolActive}
          chromeScale={chromeScale}
          chromeSettling={chromeSettling}
          onPick={onPick}
          onStartFrameDrag={onStartFrameDrag}
          onActiveBreakpointChange={
            onActiveBreakpointChange
              ? (widthPx) => onActiveBreakpointChange(screen.id, widthPx)
              : undefined
          }
          onAddBreakpoint={
            onAddBreakpoint
              ? (widthPx) => onAddBreakpoint(screen.id, widthPx)
              : undefined
          }
          onRemoveBreakpoint={
            onRemoveBreakpoint
              ? (widthPx) => onRemoveBreakpoint(screen.id, widthPx)
              : undefined
          }
          onChangeBreakpointWidth={
            onChangeBreakpointWidth
              ? (widthPx, nextWidthPx) =>
                  onChangeBreakpointWidth(screen.id, widthPx, nextWidthPx)
              : undefined
          }
          onEditBreakpoint={
            onEditBreakpoint
              ? (widthPx) => onEditBreakpoint(screen.id, widthPx)
              : undefined
          }
          canEdit={Boolean(
            onRemoveBreakpoint || onChangeBreakpointWidth || onAddBreakpoint,
          )}
        />
      ) : null}
    </div>
  );
}, areScreenPropsEqual);

function areScreenPropsEqual(prev: ScreenProps, next: ScreenProps) {
  return (
    prev.screen === next.screen &&
    prev.screenContent === next.screenContent &&
    prev.cullTier === next.cullTier &&
    sameResolvedMetadata(prev.metadata, next.metadata) &&
    sameFrameGeometry(prev.geometry, next.geometry) &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.isTopScreen === next.isTopScreen &&
    prev.showFullView === next.showFullView &&
    prev.isDirectlyHovered === next.isDirectlyHovered &&
    prev.isFileDragOver === next.isFileDragOver &&
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
    prev.onStartDuplicateGesture === next.onStartDuplicateGesture &&
    // Now id-first (screenId, widthPx) callbacks passed straight through
    // from MultiScreenCanvas's own props (PF18) instead of a fresh
    // per-screen arrow allocated in the render loop, so these are expected
    // to be referentially stable across renders and are safe to compare.
    prev.onAddBreakpoint === next.onAddBreakpoint &&
    prev.onActiveBreakpointChange === next.onActiveBreakpointChange &&
    prev.onRemoveBreakpoint === next.onRemoveBreakpoint &&
    prev.onChangeBreakpointWidth === next.onChangeBreakpointWidth &&
    prev.onEditBreakpoint === next.onEditBreakpoint
  );
}

// ── Breakpoint preview row (§6.4) ────────────────────────────────────────────

/** Gap between adjacent breakpoint frames in canvas pixels. */
const BREAKPOINT_FRAME_GAP = 24;

/**
 * Pure geometry helper for one breakpoint sub-frame (BP-DEEP item 3a): the
 * on-canvas frame box is a UNIFORM scale of the iframe's own natural size at
 * `widthPx`, never a non-uniform scale(x, y) that would stretch/squish the
 * narrower layout's aspect ratio to match the primary frame's height.
 *
 * `primaryScale` is the SAME "how far has this screen's on-canvas box been
 * resized away from its natural/metadata width" factor `Screen` already
 * computes for the primary frame via `getScreenPreviewViewport(...).scale` —
 * reusing it here (instead of re-deriving one from primaryGeometry alone,
 * which conflated the primary's aspect ratio with its resize factor and
 * produced the original forced-height distortion) keeps every frame in the
 * row at the same "zoom level" the user resized the primary frame to, while
 * each frame's OWN natural height comes from its own aspect ratio at its own
 * width — so a narrower breakpoint is allowed to be visually shorter than
 * the primary, matching a real device preview instead of an artificially
 * stretched one.
 *
 * `naturalAspect` is the breakpoint iframe's own natural height/width ratio
 * at `widthPx`; callers without a live measurement fall back to the
 * primary's own aspect ratio (same document, same rough proportions).
 * Exported so MultiScreenCanvas.primitives.test.ts can assert the scale is
 * always uniform (one `scale` value applied to both iframe axes) and the
 * frame box height is therefore derived from the breakpoint's OWN natural
 * size, never forced to equal the primary frame's height.
 */
export function getBreakpointFrameGeometry(args: {
  widthPx: number;
  naturalAspect: number;
  primaryScale: number;
}): {
  /** On-canvas frame box width, in canvas px. */
  frameWidth: number;
  /** On-canvas frame box height, in canvas px — the iframe's own natural
   *  aspect at `widthPx`, uniformly scaled; NOT forced to the primary's
   *  height. */
  frameHeight: number;
  /** The iframe's own intrinsic (pre-scale) height at `widthPx`. */
  naturalHeight: number;
  /** Uniform scale factor applied to BOTH iframe axes (never distorts). */
  scale: number;
} {
  const scale =
    Number.isFinite(args.primaryScale) && args.primaryScale > 0
      ? args.primaryScale
      : 1;
  const naturalHeight = Math.round(
    args.widthPx * Math.max(0.01, args.naturalAspect),
  );
  const frameWidth = Math.round(args.widthPx * scale);
  const frameHeight = Math.round(naturalHeight * scale);
  return { frameWidth, frameHeight, naturalHeight, scale };
}

function BreakpointPreviewRow({
  screen,
  primaryGeometry,
  primaryScale,
  naturalAspect,
  previewUrl,
  srcdocWithHitTest,
  activeBreakpointWidth,
  isScreenSelected,
  penActive,
  creationToolActive,
  chromeScale,
  chromeSettling,
  onPick,
  onStartFrameDrag,
  onActiveBreakpointChange,
  onAddBreakpoint,
  onRemoveBreakpoint,
  onChangeBreakpointWidth,
  onEditBreakpoint,
  canEdit = false,
}: {
  screen: ScreenFile;
  primaryGeometry: FrameGeometry;
  /** The primary frame's own resize scale (`getScreenPreviewViewport(...).
   *  scale`) — see getBreakpointFrameGeometry's doc comment for why this,
   *  not primaryGeometry alone, drives each breakpoint frame's on-canvas
   *  size. */
  primaryScale: number;
  /** The primary frame's own natural height/width ratio, used as the
   *  breakpoint iframe's assumed natural aspect (same document). */
  naturalAspect: number;
  previewUrl: string | undefined;
  /**
   * The primary screen's srcdoc with the lightweight hit-test responder already
   * injected (memoised in the parent Screen component).  Passed down so
   * breakpoint sub-iframes carry the same responder and can be found via
   * their own distinct [data-screen-iframe-id] (see getBreakpointIframeId)
   * by the cross-screen drop-into-container handler when that breakpoint is
   * the active edit scope (see getActiveScreenIframeId).
   */
  srcdocWithHitTest: string;
  activeBreakpointWidth: number | undefined;
  /** Whether the OWNING screen (base frame) is the current selection —
   *  mirrors `Screen`'s own `isSelected`, used so a breakpoint frame's chrome
   *  reads as "part of a selected group" the same way the base frame does. */
  isScreenSelected: boolean;
  penActive: boolean;
  creationToolActive: boolean;
  chromeScale: number;
  chromeSettling: boolean;
  /** BP-DEEP item 5 — click-to-target: picking a breakpoint frame picks its
   *  owning screen too (same onPick the base frame card/label already use),
   *  so selection, the layers panel, and the inspector all agree on which
   *  screen is focused regardless of which frame in the group was clicked. */
  onPick?: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  /** BP-DEEP item 3b — dragging ANY frame in the breakpoint group (not just
   *  the primary) moves the group together: breakpoint frames have no
   *  geometry entry of their own (they're always derived from
   *  primaryGeometry, see the offset/left math below), so proxying straight
   *  to the primary screen's own drag start keeps every frame in the row
   *  pinned at its existing gap/offset for free. */
  onStartFrameDrag?: (id: string, e: React.MouseEvent) => void;
  onActiveBreakpointChange?: (widthPx: number | undefined) => void;
  onAddBreakpoint?: (widthPx: number) => void;
  /** Item 8b — "…" menu "Remove" for one breakpoint frame. */
  onRemoveBreakpoint?: (widthPx: number) => void;
  /** Item 8b — "…" menu "Change width" for one breakpoint frame. */
  onChangeBreakpointWidth?: (widthPx: number, nextWidthPx: number) => void;
  /** Item 8b — full-view entry for one breakpoint frame (double-click or its
   *  own full-view button), mirroring the base frame's onEdit/full-view
   *  affordance. */
  onEditBreakpoint?: (widthPx: number) => void;
  /** Gates the "…" menu's mutating items (Remove / Change width) — mirrors
   *  BreakpointBar's own canEdit. Full-view entry is never gated by this,
   *  same as the base frame's own full-view button. */
  canEdit?: boolean;
}) {
  const t = useT();
  const breakpointWidths = screen.breakpointWidths ?? [];
  // Place additional frames to the right of the primary, starting after the gap
  let offsetX = primaryGeometry.width + BREAKPOINT_FRAME_GAP;

  const nextWidth = nextBreakpointWidth(breakpointWidths);
  // Item 8b — "…" menu (Change width / Remove), same one-open-at-a-time
  // pattern as BreakpointDeviceControl's own per-segment menu: which
  // breakpoint's menu is open (by widthPx, the only stable identifier this
  // row has — see the ScreenFile.breakpointWidths doc comment) and the
  // draft value of its width input.
  const [menuOpenForWidth, setMenuOpenForWidth] = useState<number | null>(null);
  const [widthDraft, setWidthDraft] = useState("");

  return (
    <>
      {breakpointWidths.map((widthPx) => {
        const { frameWidth, frameHeight, naturalHeight, scale } =
          getBreakpointFrameGeometry({ widthPx, naturalAspect, primaryScale });
        const isActive = activeBreakpointWidth === widthPx;
        const currentOffsetX = offsetX;
        offsetX += frameWidth + BREAKPOINT_FRAME_GAP;
        // BP-DEEP item 5 — clicking a frame in the group always SELECTS it
        // (never toggles it off): the Framer click-to-target model returns to
        // Base by clicking the base frame / empty canvas / Escape, not by
        // re-clicking the already-active breakpoint. BreakpointBar's own chip
        // still toggles (see handleBreakpointBarSelect's caller), which is
        // the one place an explicit on/off switch stays intentional.
        const activateThisFrame = (e: React.MouseEvent<HTMLElement>) => {
          onPick?.(screen.id, e);
          onActiveBreakpointChange?.(widthPx);
        };
        const showMenuAffordance = shouldShowBreakpointMenuAffordance({
          canEdit,
          hasRemoveOrChangeWidth: Boolean(
            onRemoveBreakpoint || onChangeBreakpointWidth,
          ),
          isActive,
          menuOpen: menuOpenForWidth === widthPx,
        });

        return (
          <div
            key={widthPx}
            data-frame-shell
            data-breakpoint-frame
            className="group/frame pointer-events-auto absolute"
            // Positioned relative to the parent Screen wrapper, which is already
            // absolute at left: SURFACE_PADDING + geometry.x / top:
            // SURFACE_PADDING + geometry.y - FRAME_LABEL_HEIGHT * chromeScale.
            // Re-adding those surface/primary terms here would double-offset
            // every breakpoint frame (~240px+ down-right), so we offset only
            // within the wrapper.
            // BP-DEEP item 3c (common top edge): `top: 0` aligns this frame's
            // own label row with the wrapper's top — the exact line the base
            // frame's own label row starts on — and the label row below is
            // given the SAME chromeScale-scaled height as the base's label
            // band (Screen's `frameLabelHeight`), so both label rows AND both
            // card top edges line up at every zoom level. The previous
            // constant `top: -FRAME_LABEL_HEIGHT` + unscaled label height
            // only lined up at 100% zoom and drifted the card top up by
            // FRAME_LABEL_HEIGHT * (chromeScale - 1) as the user zoomed out.
            style={{
              left: currentOffsetX,
              top: 0,
              width: frameWidth,
              zIndex: primaryGeometry.z,
            }}
          >
            {/* Frame label row — same height/typography/chromeScale
                transform as the primary frame's own label row (Screen, see
                the `data-frame-label` block above) so breakpoint chrome
                doesn't visibly shrink relative to regular screens at
                zoom-out (BP-DEEP item 3c). */}
            <div
              className="relative flex w-full cursor-pointer select-none items-center"
              style={{ height: FRAME_LABEL_HEIGHT * chromeScale }}
              onClick={(e) => {
                e.stopPropagation();
                activateThisFrame(e);
              }}
              onMouseDown={(e) => {
                if (e.button !== 0 || penActive || creationToolActive) return;
                if (e.shiftKey) {
                  e.stopPropagation();
                  return;
                }
                onStartFrameDrag?.(screen.id, e);
                // AFTER the drag start: beginFrameDrag internally picks the
                // owning screen when it isn't active yet, and picking a base
                // screen resets the edit scope to Base (see
                // handleOverviewScreenPick). Re-targeting THIS breakpoint
                // afterwards keeps a drag that starts on a breakpoint frame
                // scoped to that breakpoint — mousedown on a frame IS the
                // click-to-target gesture, whether or not it turns into a
                // drag.
                onActiveBreakpointChange?.(widthPx);
              }}
            >
              <div
                data-frame-label
                className="absolute left-1 top-1/2 flex min-w-0 max-w-[calc(100%-28px)] items-center gap-1.5"
                style={{
                  transform: `translateY(-50%) scale(${chromeScale})`,
                  transformOrigin: "left center",
                  transition: getChromeLabelTransition(chromeSettling),
                }}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    isActive || isScreenSelected
                      ? "bg-primary"
                      : "bg-muted-foreground/40",
                  )}
                />
                <span
                  data-frame-title
                  className={cn(
                    "min-w-0 flex-1 truncate !text-[11px] font-medium",
                    isActive
                      ? "text-[var(--design-editor-accent-color)]"
                      : "text-muted-foreground",
                  )}
                  title={`${screen.filename} — ${breakpointLabel(widthPx)}`}
                >
                  {breakpointLabel(widthPx)}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
                  {widthPx}px
                </span>
              </div>
              {/* Item 8b — "…" menu (Change width / Remove), reusing the
                  exact affordance BreakpointDeviceControl already offers per
                  segment, so a breakpoint frame in overview and its chip in
                  the inspector behave identically. Shown for the active
                  frame (and while its own menu is open) so idle frames stay
                  visually clean, same rule as the chip control. */}
              {showMenuAffordance ? (
                <div
                  className="absolute right-1 top-1/2 z-30"
                  style={{
                    transform: `translateY(-50%) scale(${chromeScale})`,
                    transformOrigin: "right center",
                  }}
                >
                  <DropdownMenu
                    open={menuOpenForWidth === widthPx}
                    onOpenChange={(open) => {
                      setMenuOpenForWidth(open ? widthPx : null);
                      setWidthDraft(open ? String(widthPx) : "");
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={t("designEditor.breakpointBar.options")}
                        className="flex h-5 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] bg-background/95 text-muted-foreground shadow-sm hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <IconDots className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="design-editor-app-menu-content w-52 rounded-lg bg-[var(--design-editor-panel-bg)] p-1"
                    >
                      {onChangeBreakpointWidth ? (
                        <div className="flex items-center gap-1.5 px-1.5 py-1">
                          <span className="shrink-0 !text-[11px] text-muted-foreground">
                            {t("designEditor.breakpointBar.changeWidth")}
                          </span>
                          <Input
                            type="number"
                            min={320}
                            max={3840}
                            value={widthDraft}
                            autoFocus
                            onChange={(e) => setWidthDraft(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const nextWidthPx = parseBreakpointWidthInput(
                                widthDraft,
                                breakpointWidths.filter((w) => w !== widthPx),
                              );
                              setMenuOpenForWidth(null);
                              if (
                                nextWidthPx !== null &&
                                nextWidthPx !== widthPx
                              ) {
                                onChangeBreakpointWidth(widthPx, nextWidthPx);
                              }
                            }}
                            className="h-6 px-1.5 !text-[11px] tabular-nums"
                            aria-label={t(
                              "designEditor.breakpointBar.changeWidth",
                            )}
                          />
                        </div>
                      ) : null}
                      {onChangeBreakpointWidth && onRemoveBreakpoint ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      {onRemoveBreakpoint ? (
                        <DropdownMenuItem
                          className="h-7 px-2 py-0 !text-[12px] text-destructive focus:text-destructive"
                          onSelect={() => {
                            setMenuOpenForWidth(null);
                            onRemoveBreakpoint(widthPx);
                          }}
                        >
                          {t("designEditor.breakpointBar.remove")}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </div>
            {/* Frame card — same corner/hover-outline chrome as the primary
                frame's own `data-screen-card` (BP-DEEP item 3c), sized to the
                UNDISTORTED uniform-scale box from getBreakpointFrameGeometry
                (BP-DEEP item 3a) instead of a forced shared height. */}
            <div
              role="button"
              tabIndex={0}
              data-screen-card
              className={cn(
                "group/artboard relative block cursor-pointer overflow-visible rounded-lg bg-background text-left outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
              style={{ width: frameWidth, height: frameHeight }}
              onClick={(e) => {
                e.stopPropagation();
                activateThisFrame(e);
              }}
              onDoubleClick={(e) => {
                // Item 8b — full view for THIS breakpoint: same double-click
                // gesture as a regular screen's card (handleFrameDoubleClick),
                // but targeting the breakpoint's own width so the editor
                // opens single-screen mode scoped to it instead of Base.
                e.preventDefault();
                e.stopPropagation();
                activateThisFrame(e);
                onEditBreakpoint?.(widthPx);
              }}
              onMouseDown={(e) => {
                if (e.button !== 0 || penActive || creationToolActive) return;
                if (e.shiftKey) {
                  e.stopPropagation();
                  return;
                }
                if (e.detail > 1) {
                  // Let onDoubleClick own the second click of a dblclick —
                  // starting a frame drag on it would fight the full-view
                  // gesture (matches the base frame's own onMouseDown guard).
                  e.stopPropagation();
                  return;
                }
                onStartFrameDrag?.(screen.id, e);
                // See the label row's matching comment above: re-target this
                // breakpoint after beginFrameDrag's internal pick so drags
                // started on a breakpoint frame stay scoped to it.
                onActiveBreakpointChange?.(widthPx);
              }}
            >
              {onEditBreakpoint ? (
                <button
                  type="button"
                  data-frame-full-view
                  className="absolute right-1 top-1 z-30 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/artboard:opacity-100"
                  style={{
                    transform: `scale(${chromeScale})`,
                    transformOrigin: "right center",
                  }}
                  aria-label={t("multiScreenCanvas.fullView")}
                  title={t("multiScreenCanvas.fullView")}
                  onClick={(e) => {
                    e.stopPropagation();
                    activateThisFrame(e);
                    onEditBreakpoint(widthPx);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <IconMaximize className="size-3" />
                </button>
              ) : null}
              <span
                data-screen-content
                className="relative block h-full w-full overflow-hidden rounded-[inherit] bg-white shadow-2xl ring-1 ring-inset ring-border"
              >
                <iframe
                  // Distinct id per breakpoint sub-frame — the primary iframe
                  // above uses the bare screen id, so without a suffix here
                  // every breakpoint sub-frame's iframe would share the exact
                  // same [data-screen-iframe-id] as the primary, and
                  // querySelector (which returns only the first DOM match)
                  // would always resolve hit-test/drag/wheel bridge lookups to
                  // the primary frame regardless of which breakpoint is
                  // active. getActiveScreenIframeId resolves the correct one
                  // to query at lookup time.
                  data-screen-iframe-id={getBreakpointIframeId(
                    screen.id,
                    widthPx,
                  )}
                  src={previewUrl}
                  srcDoc={previewUrl ? undefined : srcdocWithHitTest}
                  sandbox="allow-scripts"
                  loading="lazy"
                  className="pointer-events-none border-0"
                  style={{
                    width: widthPx,
                    height: naturalHeight,
                    // BP-DEEP item 3a: a SINGLE uniform factor on both axes —
                    // the iframe lays out at its own real width (so CSS media
                    // queries recompute exactly like a real narrower
                    // viewport), then that already-correct box is scaled down
                    // uniformly to fit the canvas, never stretched
                    // non-uniformly to match the primary frame's height.
                    transform: scale === 1 ? undefined : `scale(${scale})`,
                    transformOrigin: "top left",
                    backgroundColor: "white",
                    colorScheme: "light",
                    backfaceVisibility: "hidden",
                  }}
                  title={`${screen.filename} — ${breakpointLabel(widthPx)}`}
                />
                {creationToolActive || penActive ? (
                  <span className="absolute inset-0 z-20 cursor-crosshair" />
                ) : null}
              </span>
              <span
                data-screen-hover-outline
                className={cn(
                  "pointer-events-none absolute inset-0 z-10 rounded-[inherit] border border-[var(--design-editor-accent-color)] opacity-0 transition-opacity",
                  "group-hover/artboard:opacity-100",
                )}
                style={{ borderWidth: chromeScale }}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "pointer-events-none absolute inset-0 rounded-[inherit] border transition-colors",
                  isActive
                    ? "border-[var(--design-editor-accent-color)]"
                    : "border-black/5",
                )}
                style={{ borderWidth: isActive ? 1.5 * chromeScale : 1 }}
                aria-hidden="true"
              />
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
          // double-offset. Vertically centered on the card band: cards start
          // at FRAME_LABEL_HEIGHT * chromeScale below the wrapper top (see
          // the top: 0 + scaled-label-row comment above), and the button
          // itself is size-7 (28px), so subtract half of that.
          style={{
            left: offsetX,
            top:
              FRAME_LABEL_HEIGHT * chromeScale +
              primaryGeometry.height / 2 -
              14,
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
  onStartRotate,
}: {
  bounds: NonNullable<ReturnType<typeof getFrameGroupBounds>>;
  chromeScale: number;
  chromeSettling: boolean;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  /** Multi-selection rotate (CV14). Omit to keep the previous behavior (no
   *  rotate handle shown) — used by callers whose selection kind doesn't
   *  support group rotate yet (e.g. draft primitives). */
  onStartRotate?: (e: React.MouseEvent) => void;
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
      showRotate={!!onStartRotate}
      filled
      onStartResize={onStartResize}
      onStartRotate={onStartRotate ?? (() => {})}
    />
  );
}

function PassiveSelectionBox({
  geometry,
  chromeScale,
  chromeSettling,
}: {
  geometry: FrameGeometry;
  chromeScale: number;
  chromeSettling: boolean;
}) {
  return (
    <div
      data-passive-frame-selection-box
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
        zIndex: 999_999,
      }}
    >
      {CORNER_RESIZE_HANDLE_CONFIGS.map((config) => (
        <span
          key={config.handle}
          data-passive-resize-handle={config.handle}
          className="pointer-events-none absolute z-20 rounded-[2px] border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)] shadow"
          style={cornerHandleStyle(
            config.handle,
            config.cursor,
            chromeScale,
            chromeSettling,
            geometry.width,
            geometry.height,
          )}
        />
      ))}
    </div>
  );
}

function SelectionBox({
  geometry,
  chromeScale,
  chromeSettling,
  filled = false,
  showRotate = true,
  onStartResize,
  onStartRotate,
}: {
  geometry: FrameGeometry;
  chromeScale: number;
  chromeSettling: boolean;
  filled?: boolean;
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
        background: filled
          ? "var(--design-editor-selection-color)"
          : "transparent",
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
        rotationDeg={geometry.rotation ?? 0}
        frameWidth={geometry.width}
        frameHeight={geometry.height}
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
  rotationDeg = 0,
  frameWidth = Number.POSITIVE_INFINITY,
  frameHeight = Number.POSITIVE_INFINITY,
  onStartResize,
  onStartRotate,
}: {
  active: boolean;
  enabled: boolean;
  showOnHover?: boolean;
  showRotate?: boolean;
  chromeScale?: number;
  chromeSettling?: boolean;
  /** The frame's own rotation, so hover cursors match the handle's rotated
   *  visual direction instead of a static unrotated cursor (CSS `cursor` is
   *  never itself rotated by a transform on the element). */
  rotationDeg?: number;
  /** Frame dimensions in local (board) px, used to clamp how far handle hit
   *  zones may reach into the frame body (handle-hit-zones.ts). Omit for the
   *  unclamped historical behavior. */
  frameWidth?: number;
  frameHeight?: number;
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
            getResizeCursorForHandle(config.handle, rotationDeg),
            chromeScale,
            chromeSettling,
            frameWidth,
            frameHeight,
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
            getResizeCursorForHandle(config.handle, rotationDeg),
            chromeScale,
            chromeSettling,
            frameWidth,
            frameHeight,
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
                "pointer-events-auto absolute z-10 size-5 rounded-full transition-opacity",
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
                rotationDeg,
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

// Edge/corner handle hit zones are clamped against the frame's own dimensions
// (handle-hit-zones.ts) so that at low zoom the chromeScale-compensated hit
// slop can never cover the whole frame body and steal every press as a
// resize — the frame's central 50% band stays grabbable for a move drag at
// any zoom. On large frames these produce the historical geometry exactly.
function edgeHandleStyle(
  handle: ResizeHandle,
  cursor: string,
  chromeScale: number,
  chromeSettling: boolean,
  frameWidth: number,
  frameHeight: number,
): CSSProperties {
  if (handle === "n" || handle === "s") {
    const geometry = getEdgeHandleHitGeometry(chromeScale, frameHeight);
    return {
      cursor,
      transition: getChromeHandleTransition(chromeSettling),
      left: 0,
      right: 0,
      height: geometry.thickness,
      [handle === "n" ? "top" : "bottom"]: geometry.outwardOffset,
    };
  }
  const geometry = getEdgeHandleHitGeometry(chromeScale, frameWidth);
  return {
    cursor,
    transition: getChromeHandleTransition(chromeSettling),
    top: 0,
    bottom: 0,
    width: geometry.thickness,
    [handle === "w" ? "left" : "right"]: geometry.outwardOffset,
  };
}

function cornerHandleStyle(
  handle: ResizeHandle,
  cursor: string,
  chromeScale: number,
  chromeSettling: boolean,
  frameWidth: number,
  frameHeight: number,
): CSSProperties {
  const { size, offsetX, offsetY } = getCornerHandleGeometry(
    chromeScale,
    frameWidth,
    frameHeight,
  );
  return {
    cursor,
    transition: getChromeHandleTransition(chromeSettling),
    width: size,
    height: size,
    borderWidth: Math.max(1, 1.25 * chromeScale),
    ...(handle.includes("n") ? { top: offsetY } : { bottom: offsetY }),
    ...(handle.includes("w") ? { left: offsetX } : { right: offsetX }),
  };
}

/**
 * Base (unrotated) orientation angle for each rotate handle corner, in the
 * same "0 = east, clockwise, canvas-y-grows-down" convention as
 * RESIZE_HANDLE_ANGLES in shared/canvas-math.ts's getResizeCursorForHandle —
 * each corner's curved-arrow cursor glyph is drawn pointing "outward" along
 * this base angle before any frame rotation is added.
 */
const ROTATE_HANDLE_BASE_ANGLE: Record<string, number> = {
  ne: 0,
  se: 90,
  sw: 180,
  nw: 270,
};

/**
 * Quantizes `angleDeg` to the nearest of 8 compass buckets (0/45/90/…/315),
 * mirroring the 8-bucket quantization getResizeCursorForHandle uses for
 * resize cursors — but returning the bucket angle itself (not a lookup into
 * a 4-symmetric cursor keyword table), since a rotate cursor's curved-arrow
 * glyph is directional and needs a distinct rendered rotation per bucket
 * rather than collapsing opposite corners onto the same CSS cursor keyword.
 */
function quantizeAngleTo8Buckets(angleDeg: number): number {
  const normalized = ((angleDeg % 360) + 360) % 360;
  return (Math.round(normalized / 45) % 8) * 45;
}

/**
 * Builds a small (~20x20) curved double-headed-arrow cursor as an inline SVG
 * data URI, rotated to `angleDeg`, matching Figma's rotate-handle cursor
 * instead of the generic "grab" hand. The cursor hotspot (11 11) keeps the
 * glyph's visual center under the pointer.
 */
function rotateCursorDataUri(angleDeg: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">` +
    `<g transform="rotate(${angleDeg} 10 10)" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M 4 8 A 7 7 0 0 1 16 8" stroke="white" stroke-width="3.5"/>` +
    `<path d="M 4 8 A 7 7 0 0 1 16 8"/>` +
    `<path d="M 12.5 3.5 L 16 8 L 11 8.5" fill="white" stroke="white" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M 12.5 3.5 L 16 8 L 11 8.5" fill="black"/>` +
    `</g>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, grab`;
}

/**
 * Comment-tool cursor: a small speech-bubble/pin glyph, matching Figma's
 * comment-placement affordance instead of the plain arrow. The hotspot (2 2)
 * sits at the pin's tip so the click lands exactly where the pin points.
 */
const COMMENT_CURSOR = (() => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<path d="M2 2 L2 17 L7 17 L10 22 L10 17 L20 17 L20 2 Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="7" cy="9.5" r="1.4" fill="black"/>` +
    `<circle cx="11" cy="9.5" r="1.4" fill="black"/>` +
    `<circle cx="15" cy="9.5" r="1.4" fill="black"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, default`;
})();

function rotateHandleStyle(
  corner: string,
  chromeScale: number,
  chromeSettling: boolean,
  rotationDeg = 0,
): CSSProperties {
  const size = 28 * chromeScale;
  const offset = -34 * chromeScale;
  const baseAngle = ROTATE_HANDLE_BASE_ANGLE[corner] ?? 0;
  const quantized = quantizeAngleTo8Buckets(baseAngle + rotationDeg);
  return {
    cursor: rotateCursorDataUri(quantized),
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

export interface ScreenViewportSize {
  width: number;
  height: number;
}

export function getInitialFrameGeometry(
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

/**
 * B5-9: resolves the `screens`/`geometryById` prop-sync effect's per-screen
 * frame geometry AND decides whether the result is worth notifying the
 * parent about (`onGeometryChange`).
 *
 * A brand-new screen (duplicate or frame-tool create) appears in `screens`
 * as soon as its file row exists, but its REAL geometry (correct width/
 * height copied from the source, or drawn dimensions) is written to the
 * server by the caller (e.g. DesignEditor's handleDuplicateScreen) and only
 * round-trips back into `geometryById` a beat later. In that gap, treating
 * "no existing local entry yet" as a real geometry change and notifying the
 * parent with the disposable `getInitialFrameGeometry()` fallback (hardcoded
 * SCREEN_WIDTH/height) is wrong: `onGeometryChange` and the caller's own
 * save share one debounced timer, so this fallback-driven notify can fire
 * AFTER and silently overwrite the caller's correct pending write —
 * permanently persisting the wrong (narrower, default-positioned) geometry.
 *
 * So: `shouldNotifyParent` is true only when a screen's PERSISTED geometry
 * actually differs from what's locally known (a real external change worth
 * syncing back — e.g. a resize/move that arrived through the prop), or when
 * a screen was removed. A screen adopting its local-only fallback for the
 * first time (`existing` undefined, `persisted` undefined) sets `changed`
 * so the render-local state still updates, but must NOT set
 * `shouldNotifyParent` — the caller should apply that case via a ref-only
 * update instead of the notifying path.
 *
 * Exported for unit testing.
 */
export function resolveFrameGeometrySync(args: {
  screens: ReadonlyArray<{ id: string; metadata?: ScreenViewportSize }>;
  currentGeometryById: FrameGeometryById;
  persistedGeometryById:
    | Record<string, Partial<FrameGeometry> | undefined>
    | undefined;
}): {
  next: FrameGeometryById;
  changed: boolean;
  shouldNotifyParent: boolean;
} {
  const { screens, currentGeometryById, persistedGeometryById } = args;
  const currentIds = new Set(screens.map((screen) => screen.id));
  let shouldNotifyParent = Object.keys(currentGeometryById).some(
    (id) => !currentIds.has(id),
  );

  const next: FrameGeometryById = {};
  let changed = shouldNotifyParent;

  screens.forEach((screen, index) => {
    const existing = currentGeometryById[screen.id];
    const persisted = persistedGeometryById?.[screen.id];
    const resolved = {
      ...getInitialFrameGeometry(index, screen.metadata),
      ...persisted,
    } as FrameGeometry;
    next[screen.id] = persisted ? resolved : (existing ?? resolved);
    if (!existing) {
      changed = true;
    }
    if (persisted && !sameFrameGeometry(existing ?? resolved, resolved)) {
      changed = true;
      shouldNotifyParent = true;
    }
  });

  return { next, changed, shouldNotifyParent };
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

/** Matches the render-time `chromeScale = scale > 0 ? 1 / scale : 1` used to
 *  keep on-screen chrome (labels, handles) a constant pixel size regardless
 *  of canvas zoom. Callbacks that hit-test against the rendered label band
 *  (e.g. marquee selection) must use the same conversion from the live zoom
 *  ref instead of a fixed constant. */
function chromeScaleFromZoom(zoom: number) {
  const scale = zoom / 100;
  return scale > 0 ? 1 / scale : 1;
}

/** Shift-marquee selection combine, matching Figma: items currently swept by
 *  the marquee toggle relative to the selection the gesture started with —
 *  already-selected items under the marquee are deselected, not re-added.
 *  Items outside the base selection AND not currently under the marquee are
 *  left untouched. A plain union (the previous behavior) can only ever grow
 *  the selection, so it never lets a shift-marquee deselect anything. */
function xorMarqueeSelection(baseIds: string[], hitIds: string[]) {
  const hitSet = new Set(hitIds);
  const kept = baseIds.filter((id) => !hitSet.has(id));
  const added = hitIds.filter((id) => !baseIds.includes(id));
  return dedupeIds([...kept, ...added]);
}

/** A mousedown/mouseup gesture on empty board space (no frame/draft under the
 *  pointer) always begins a marquee drag (see `beginMarquee`). This decides
 *  whether that gesture's mouseup should deselect everything: only a plain
 *  click — the pointer never moved past the drag threshold, and shift wasn't
 *  held — clears the current selection. A real marquee drag (`hasMoved`)
 *  already reported its own hit-tested selection on every mousemove tick, and
 *  a shift-click on empty space (`additive`) is a no-op that preserves the
 *  existing selection, matching Figma/Cursor's overview-canvas convention. */
export function shouldClearSelectionOnEmptyCanvasClick(gesture: {
  hasMoved: boolean;
  additive: boolean;
}): boolean {
  return !gesture.hasMoved && !gesture.additive;
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

/**
 * Pure drop-target resolution: finds the topmost frame entry (by z, then DOM
 * index) whose (possibly rotated) bounds contain `point`, in canvas-world
 * coordinates. Factored out of `getFrameEntryAtPoint`'s inline
 * filter/sort so OS file drag-and-drop (Figma parity §1) can be unit tested
 * without mounting the component — `getFrameEntryAtPoint` itself is just this
 * function applied to `getCurrentFrameEntries()`.
 */
export function findTopFrameEntryAtPoint<
  T extends { id: string; geometry: FrameGeometry },
>(entries: readonly T[], point: Point): T | undefined {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
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
        (b.entry.geometry.z ?? 0) - (a.entry.geometry.z ?? 0) ||
        b.index - a.index,
    )[0]?.entry;
}

/** Decides where a drawn primitive lands when its center falls outside every
 *  screen frame (findTopFrameEntryAtPoint returned undefined) — used by
 *  getTargetFrameForDraft's fallback branch. Exported for direct unit
 *  testing, mirroring getCachedScreenContentNode.
 *
 *  A draft drawn outside every frame belongs on the board (floating on the
 *  infinite canvas surface), not absorbed into a screen it was never drawn
 *  inside — regardless of how many screens exist. Returning undefined here
 *  routes the caller to onBoardDrawPrimitive.
 *
 *  Only when there is genuinely no board to route to (no handler registered)
 *  do we fall back to absorbing into the nearest frame, so a drawn shape
 *  still persists somewhere rather than becoming a lost draft primitive.
 *  This previously special-cased "exactly one screen" as if a single-screen
 *  board had no meaningful "outside" — stale from before the board-file
 *  surface existed, and it broke drawing on empty canvas space whenever a
 *  design happened to have only one screen. */
export function getOutsideFrameDraftFallback<T>(
  entries: readonly T[],
  options: { hasBoardDrawHandler: boolean },
): T | undefined {
  if (entries.length === 0) return undefined;
  if (options.hasBoardDrawHandler) return undefined;
  return entries[0];
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
  modifiers?: DraftGeometryModifiers,
): FrameGeometry {
  // Note: "pen" is a valid DraftCreationTool value for board-surface/cursor
  // purposes (see getDraftCreationTool), but the pen tool never actually
  // drives this creation-drag geometry path — beginPenNodeCreation handles
  // pen gestures entirely separately via activePenPath/PenNodeDragState.
  if (tool === "line" || tool === "arrow") {
    return getDraftGeometryForTool(tool, start, end, modifiers);
  }

  if (!hasMoved) {
    return { x: start.x, y: start.y, width: 0, height: 0 };
  }

  return getDraftGeometryForTool(tool, start, end, modifiers);
}

function getDraftGeometryForTool(
  tool: DraftCreationTool,
  start: Point,
  end: Point,
  modifiers?: DraftGeometryModifiers,
): FrameGeometry {
  if (tool === "line" || tool === "arrow") {
    // Shift constrains the line/arrow to 45deg increments, reusing the same
    // helper the pen tool already uses for constrained segments.
    const effectiveEnd = modifiers?.shiftKey
      ? constrainPointTo45Degrees(start, end)
      : end;
    return getPathGeometry([start, effectiveEnd]);
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
  return getDraftGeometryFromPoints(start, end, {
    ...options,
    square: modifiers?.shiftKey,
    fromCenter: modifiers?.altKey,
  });
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
  moved,
  toolProps,
  modifiers,
}: DraftPrimitiveInput): DraftPrimitive {
  const id = createDraftId(tool);
  const geometry = moved
    ? getDraftGeometryForTool(tool, start, end, modifiers)
    : getDraftGeometryForTool(tool, start, start, modifiers);
  // Note: pen never reaches createDraftPrimitive — beginPenNodeCreation
  // commits pen paths directly via createPenDraftPrimitive (see
  // finishPenPath). The old fallback here (a hardcoded 3-point zigzag
  // placeholder path used when no freehand samples existed) was unreachable
  // dead code and has been removed.
  if (tool === "text") {
    return {
      id,
      kind: "text",
      geometry,
      text: toolProps?.text ?? "",
      fill: toolProps?.fill,
      stroke: toolProps?.stroke,
      autoSize: !moved,
    };
  }
  if (tool === "line" || tool === "arrow") {
    const effectiveEnd = modifiers?.shiftKey
      ? constrainPointTo45Degrees(start, end)
      : end;
    const pathPoints = moved
      ? [start, effectiveEnd]
      : [start, { x: start.x + DRAFT_LINE_WIDTH, y: start.y }];
    return {
      id,
      kind: tool,
      geometry: getPathGeometry(pathPoints),
      points: pathPoints,
      stroke: toolProps?.stroke,
      // Figma parity: default line/arrow stroke width is 1px, not 3px. See
      // DEFAULT_LINE_STROKE_WIDTH_PX in canvas-primitive-style.ts — the same
      // token every other draw/commit call site uses.
      strokeWidth: toolProps?.strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX,
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

/**
 * Builds the closed preview/commit path for a click-or-drag close gesture
 * (P6). Closing on the first anchor is deferred to mouseup so a drag can
 * shape the closing segment's curve: dragging sets the first anchor's
 * handleIn (mirrored across that anchor, like every other smooth-node
 * handle) so the curve eases into the start point instead of always
 * closing with a hard straight/corner segment.
 */
function shapeClosingHandles(
  pathBefore: PenPath,
  dragPoint: Point | null,
): PenPath {
  const closed = closePenPath(pathBefore);
  if (!dragPoint || closed.nodes.length === 0) return closed;

  const first = closed.nodes[0];
  const handleIn = {
    x: first.point.x - (dragPoint.x - first.point.x),
    y: first.point.y - (dragPoint.y - first.point.y),
  };
  const nodes = closed.nodes.slice();
  nodes[0] = { ...first, handleIn };
  return { nodes, closed: true };
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
    // Figma parity: default pen-path stroke width is 1px, not 3px.
    strokeWidth: strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX,
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
  const scaledPenPath = draft.penPath
    ? scalePenPathToGeometry(draft.penPath, frameGeometry, {
        x: 0,
        y: 0,
        width: metadata?.width ?? frameGeometry.width,
        height: metadata?.height ?? frameGeometry.height,
      })
    : undefined;
  const localGeometry = scaledPenPath
    ? getPenPathGeometry(scaledPenPath)
    : {
        ...draft.geometry,
        x: Math.round((draft.geometry.x - frameGeometry.x) * scaleX),
        y: Math.round((draft.geometry.y - frameGeometry.y) * scaleY),
        width: Math.max(1, Math.round(draft.geometry.width * scaleX)),
        height: Math.max(1, Math.round(draft.geometry.height * scaleY)),
      };
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

/**
 * K-scale (Figma "Scale" tool) parity for draft primitives: when `scaleK` is
 * true, `strokeWidth` grows/shrinks proportionally with the resize's uniform
 * scale factor, matching Figma's Scale tool multiplying stroke weight (and,
 * for text layers, font size — see the note below) along with the box. A
 * *normal* resize (`scaleK` false/omitted, the default) only ever changes
 * `geometry`, exactly as before this parity change.
 *
 * Uses `Math.max(scaleX, scaleY)` as the single scalar rather than scaling
 * each axis independently: a stroke or font size has no "horizontal" vs
 * "vertical" component to split across, so a non-uniform drag (K-scale
 * doesn't itself force uniform scaling the way Shift does — see
 * beginDraftResize's `preserveAspectRatio: ev.shiftKey` option, which is
 * independent of the K tool) still needs one scalar. Figma's own Scale tool
 * always drags with aspect ratio implicitly locked in practice; taking the
 * larger of the two axis factors keeps the stroke/text growth from ever
 * silently lagging behind the more-scaled axis.
 *
 * Text drafts (`DraftPrimitive` kind "text") have no explicit numeric
 * font-size field today — text sizing on this canvas is implicit (CSS
 * `font-size: 16px` baked into canvas-primitive-style.ts's `text` case, not a
 * per-draft property), so there is nothing here to scale for text yet. See
 * the report for the precise follow-up needed (promoting font-size to a
 * first-class DraftPrimitive field) before K-scale can affect text size.
 */
export function applyDraftGeometry(
  draft: DraftPrimitive,
  geometry: FrameGeometry,
  scaleK?: boolean,
): DraftPrimitive {
  const origin = draft.geometry;
  const scaleX = geometry.width / Math.max(1, origin.width);
  const scaleY = geometry.height / Math.max(1, origin.height);
  const scaledPenPath = draft.penPath
    ? scalePenPathToGeometry(draft.penPath, origin, geometry)
    : undefined;
  const strokeScaleFactor = Math.max(scaleX, scaleY);
  const scaledStrokeWidth =
    scaleK && draft.strokeWidth !== undefined
      ? Math.max(
          0,
          Math.round(draft.strokeWidth * strokeScaleFactor * 100) / 100,
        )
      : draft.strokeWidth;
  return {
    ...draft,
    geometry,
    points: draft.points?.map((point) => ({
      x: geometry.x + (point.x - origin.x) * scaleX,
      y: geometry.y + (point.y - origin.y) * scaleY,
    })),
    penPath: scaledPenPath,
    pathData: scaledPenPath ? serializePenPath(scaledPenPath) : draft.pathData,
    strokeWidth: scaledStrokeWidth,
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

function getSelectableBounds(
  geometry: FrameGeometry,
  chromeScale = 1,
): BoundsRect {
  return {
    left: geometry.x,
    // The rendered frame-label band is FRAME_LABEL_HEIGHT * chromeScale (see
    // frameLabelHeight in the Screen renderer) — chromeScale grows as you
    // zoom out (chromeScale = 1 / scale) so the label stays a constant
    // on-screen size. Marquee/layer hit-testing must match that rendered
    // band, not a fixed canvas-space height, or the clickable label area
    // drifts out of sync with what's drawn at any zoom other than 100%.
    top: geometry.y - FRAME_LABEL_HEIGHT * chromeScale,
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

interface ResolvedMetadataCacheEntry {
  screen: ScreenFile;
  keyedMetadata?: ScreenMetadata;
  getterMetadata?: ScreenMetadata;
  previewDeviceFrame: DeviceFrameType;
  result: ResolvedScreenMetadata;
}

/** Shallow-compares the small flat metadata records resolveScreenMetadata
 *  reads. `getScreenMetadata?.(screen)` callers are not required to return a
 *  referentially-stable object (DesignEditor's own implementations typically
 *  build a fresh literal per call), so an identity check alone would never
 *  hit. A field-by-field compare over ScreenMetadata's small fixed key set
 *  is cheap and correct. */
function sameScreenMetadataInput(
  a: ScreenMetadata | undefined,
  b: ScreenMetadata | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.source === b.source &&
    a.sourceType === b.sourceType &&
    a.lod === b.lod &&
    a.previewState === b.previewState &&
    a.title === b.title &&
    a.width === b.width &&
    a.height === b.height &&
    a.url === b.url &&
    a.previewUrl === b.previewUrl &&
    a.bridgeUrl === b.bridgeUrl
  );
}

/** Test-only escape hatch, mirrors __clearPrimitiveParseCachesForTests. The
 *  cache itself is a per-MultiScreenCanvas-instance ref (see
 *  resolvedMetadataCacheRef), so production code never needs to reset it. */
export function __clearResolvedMetadataCacheForTests(
  cache: Map<string, ResolvedMetadataCacheEntry>,
) {
  cache.clear();
}

/** Per-screen memoized resolveScreenMetadata (PF20). resolveScreenMetadata
 *  does a bounded string scan (deriveSource/derivePreviewState, up to 4000
 *  chars) plus URL parsing every time it's called — work that is wasted when
 *  called again for a screen whose `screen`/`keyedMetadata`/`getterMetadata`/
 *  `previewDeviceFrame` inputs are unchanged from the previous call (e.g. a
 *  sibling screen's drag/resize triggering a canvasFrames rebuild). Cache is
 *  keyed by screen.id — one entry per screen, invalidated only when that
 *  screen's own inputs change — so it stays correct even though
 *  resolveScreenMetadata itself does not depend on geometry at all. */
export function resolveScreenMetadataCached(
  cache: Map<string, ResolvedMetadataCacheEntry>,
  screen: ScreenFile,
  keyedMetadata: ScreenMetadata | undefined,
  getterMetadata: ScreenMetadata | undefined,
  previewDeviceFrame: DeviceFrameType,
): ResolvedScreenMetadata {
  const cached = cache.get(screen.id);
  if (
    cached &&
    cached.screen === screen &&
    cached.previewDeviceFrame === previewDeviceFrame &&
    sameScreenMetadataInput(cached.keyedMetadata, keyedMetadata) &&
    sameScreenMetadataInput(cached.getterMetadata, getterMetadata)
  ) {
    return cached.result;
  }
  const result = resolveScreenMetadata(
    screen,
    keyedMetadata,
    getterMetadata,
    previewDeviceFrame,
  );
  cache.set(screen.id, {
    screen,
    keyedMetadata,
    getterMetadata,
    previewDeviceFrame,
    result,
  });
  return result;
}

/** Pure per-screen content-node cache lookup backing the screenContentById
 *  useMemo (PF21). Returns the previously rendered node when this screen's
 *  own inputs are unchanged — `screen` identity, `renderScreenContent`
 *  identity, `metadata` by value, and the ROUNDED geometry width/height
 *  (matching DesignEditor's getEmbeddedFrame rounding). geometry.x/y are
 *  deliberately excluded from the key: position is applied by the Screen
 *  wrapper's left/top/transform, never by the content node, so a move-drag
 *  must reuse the cached node. Exported for direct unit testing, mirroring
 *  parsePrimitivesFromScreen. */
export function getCachedScreenContentNode(
  cache: Map<string, ScreenContentCacheEntry>, // i18n-ignore scanner false positive on TS generics, not a string
  screen: ScreenFile,
  metadata: ResolvedScreenMetadata,
  geometry: FrameGeometry,
  renderScreenContent: NonNullable<
    MultiScreenCanvasProps["renderScreenContent"]
  >,
): ReactNode {
  const width = Math.max(1, Math.round(geometry.width));
  const height = Math.max(1, Math.round(geometry.height));
  const prior = cache.get(screen.id);
  if (
    prior &&
    prior.screen === screen &&
    prior.renderScreenContent === renderScreenContent &&
    sameResolvedMetadata(prior.metadata, metadata) &&
    prior.width === width &&
    prior.height === height
  ) {
    return prior.contentNode;
  }
  const contentNode = renderScreenContent(screen, metadata, geometry);
  cache.set(screen.id, {
    screen,
    metadata,
    width,
    height,
    renderScreenContent,
    contentNode,
  });
  return contentNode;
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

/** Simple LRU-style cache to avoid re-parsing the same screen HTML on every
 *  mousemove frame.  Keyed by `screenId:contentLength:hash` so that ANY edit
 *  (including changes deep in the middle of a large HTML document) invalidates
 *  the entry.  A length:hash pair eliminates the collision zone that existed
 *  when only prefix48+suffix48 were used — edits in `content[48..len-49]` would
 *  produce the same key even though the content differed. */
export const primitiveParseCache = new Map<string, ParsedScreenPrimitive[]>();
const PRIMITIVE_PARSE_CACHE_MAX = 64;

/** First-level identity cache: most callers (e.g. drag/marquee mousemove
 *  handlers) call parsePrimitivesFromScreen repeatedly per frame against the
 *  *same* ScreenFile object — `screen.content` hasn't changed at all between
 *  calls. Hashing the full content string on every call to build the
 *  second-level cache key is wasted work in that case (PF17). Keep one most-
 *  recent `{content, result}` pair per screen id and skip straight past the
 *  hash when the content reference is unchanged. Only falls through to the
 *  hash-keyed Map (and a real re-parse) when content has actually changed. */
const primitiveParseIdentityCache = new Map<
  string,
  { content: string; result: ParsedScreenPrimitive[] }
>();

/** Test-only escape hatch: clears both cache levels. Production code never
 *  needs to call this — the identity cache self-invalidates whenever
 *  `screen.content` changes, and the hash-keyed cache is bounded/LRU'd. */
export function __clearPrimitiveParseCachesForTests() {
  primitiveParseCache.clear();
  primitiveParseIdentityCache.clear();
}

export function parsePrimitivesFromScreen(
  screen: ScreenFile,
): ParsedScreenPrimitive[] {
  const identityEntry = primitiveParseIdentityCache.get(screen.id);
  if (identityEntry && identityEntry.content === screen.content) {
    return identityEntry.result;
  }

  const cacheKey = `${screen.id}:${screen.content.length}:${hashString(screen.content)}`;
  const cached = primitiveParseCache.get(cacheKey);
  if (cached) {
    primitiveParseIdentityCache.set(screen.id, {
      content: screen.content,
      result: cached,
    });
    return cached;
  }

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
      const primitiveKind = (
        el.getAttribute("data-an-primitive") || ""
      ).toLowerCase();

      // Only block elements with explicit absolute positioning are considered
      // positioned primitives drawn by appendCanvasPrimitiveToHtml.
      if (style.position !== "absolute") return;

      const left = parseFloat(style.left) || 0;
      const top = parseFloat(style.top) || 0;
      const width = parseFloat(style.width) || 0;
      const height = parseFloat(style.height) || 0;

      // Validity: must have non-zero size
      if (width <= 0 || height <= 0) return;

      // Only explicit layout primitives and canvas-created rectangles accept
      // drops. Avoid treating every absolute div as a container, because imported
      // app markup can contain structural wrappers that should stay inert here.
      const isDiv = tag === "div";
      const isEllipse =
        style.borderRadius === "50%" ||
        style.borderRadius === "50% 50% 50% 50%";
      const isTextAutoSize = style.display === "inline-block";
      const isAutoLayout =
        style.display === "flex" ||
        style.display === "inline-flex" ||
        style.display === "grid" ||
        style.display === "inline-grid";
      const isCanvasRectangle =
        isDiv && (primitiveKind === "rectangle" || primitiveKind === "rect");
      const isContainer =
        isDiv &&
        !isEllipse &&
        !isTextAutoSize &&
        (isAutoLayout || isCanvasRectangle);

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
  primitiveParseIdentityCache.set(screen.id, {
    content: screen.content,
    result,
  });
  return result;
}

/**
 * Surface-space `left`/`top` for a dragged frame's wrapper element, matching
 * the inline style Screen/DraftPrimitiveLayer compute from `geometry`
 * (`SURFACE_PADDING + geometry.x` / `SURFACE_PADDING + geometry.y -
 * labelHeight`). Used by beginFrameDrag/beginDraftDrag (PERF9 — see their
 * mousemove comments) to mutate a dragged node's DOM style directly every
 * rAF tick instead of committing React state, so the pan/zoom path's
 * "imperative transform now, commit state once on release" discipline
 * (applyViewToDom/scheduleViewCommit) also applies to object drags. Screens
 * pass their scaled label-row height; draft primitives (no label row) omit
 * it (default 0).
 */
export function frameStyleLeftTop(
  geometry: { x: number; y: number },
  labelHeight = 0,
): { left: number; top: number } {
  return {
    left: SURFACE_PADDING + geometry.x,
    top: SURFACE_PADDING + geometry.y - labelHeight,
  };
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
  options: { identityCoordinateScreenIds?: ReadonlySet<string> } = {},
): PrimitiveDropTarget | null {
  const toBoardRect = (
    prim: ParsedScreenPrimitive,
    frameGeometry: FrameGeometry,
    metadata: { width: number; height: number },
  ): FrameGeometry => {
    if (options.identityCoordinateScreenIds?.has(prim.screenId)) {
      return {
        x: prim.localLeft,
        y: prim.localTop,
        width: Math.max(1, prim.localWidth),
        height: Math.max(1, prim.localHeight),
      };
    }
    return primitiveLocalToBoardRect(
      prim.localLeft,
      prim.localTop,
      prim.localWidth,
      prim.localHeight,
      frameGeometry,
      metadata,
    );
  };

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
          draggedBoardRect = toBoardRect(prim, frameGeometry, metadata);
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

      const boardRect = toBoardRect(prim, frameGeometry, metadata);

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
