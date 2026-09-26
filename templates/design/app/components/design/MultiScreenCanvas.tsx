import {
  injectSessionReplayIframeBootstrap,
  SESSION_REPLAY_IFRAME_ATTRIBUTE,
} from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import { injectDocumentMarkup } from "@agent-native/core/shared";
import { constrainCanvasDragDelta } from "@agent-native/toolkit/canvas-interactions";
import {
  CANVAS_FIT_PADDING_PX,
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_AUTOFIT_MIN_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
  canvasToScreenPoint,
  computeDragSnap,
  computeMoveSnap,
  computeResizeSnap,
  type DistanceGuideBand,
  type ProximityMeasurement,
  type EqualGapGuide,
  getCameraForBounds,
  getFrameGroupBounds,
  getFrameGroupSizeBounds,
  getNudgeDelta,
  getPanForZoomToCursor,
  getResizeCursorForHandle,
  quantizeCanvasPoint,
  WHOLE_PIXEL_SNAP_STEP,
  resizeFrameGroupFromDelta,
  resizeFrameGroupToBounds,
  resizeRotatedFrameFromDeltaWithSnap,
  rotateFrameGroupAroundCenter,
  rotatedRectIntersects,
  screenToCanvasPoint,
  type ArrowNudgeKey,
} from "@shared/canvas-math";
import { parseCssColorExtended } from "@shared/color-utils";
import { resolveLayoutGridSnapStep } from "@shared/layout-grid";
import {
  appendPenNode,
  bendPenSegment,
  clonePenPath,
  closePenPath,
  constrainPointTo45Degrees,
  continuePenPathFromEndpoint,
  createCornerNode,
  createPenCuspLatch,
  createPenDragNode,
  getPenPathGeometry,
  hitTestPenAnchor,
  hitTestPenHandle,
  hitTestPenSegment,
  isClosedPathData,
  isPenCloseTarget,
  movePenAnchor,
  movePenHandle,
  parsePenNodes,
  resumePenPathAtEnd,
  serializePenNodes,
  serializePenPath,
  setPenNodeType,
  snapPenAnchorPoint,
  translatePenPath,
  type PenNode,
  type PenPath,
} from "@shared/pen-path";
import {
  readSourceNodeProvenance,
  type SourceNodeProvenance,
} from "@shared/preview-source-provenance";
import {
  getResponsiveBreakpointHeightPx,
  MAX_SANE_FRAME_DIMENSION_PX,
} from "@shared/responsive-frame-layout";
import { isRunningAppSourceType } from "@shared/source-mode";
import {
  vectorEndpointMarkerId,
  vectorEndpointMarkerOrientation,
  vectorEndpointPairForPrimitive,
  vectorEndpointMarkerRefX,
  vectorEndpointShape,
} from "@shared/vector-endpoints";
import {
  IconCopy,
  IconDots,
  IconHandClick,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import {
  memo,
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ReviewCanvasPins } from "@/components/visual-editor/ReviewCanvasPins";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";
import { penPathScreenContentOffset } from "@/pages/design-editor/clone-and-pen-edit";
import { CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS } from "@/pages/design-editor/commands/cross-screen-insert-timeout";

import { tweakBridgeScript } from "../../../.generated/bridge/tweak.generated";
import { parseBreakpointWidthInput } from "./BreakpointBar";
import { isCanvasOverlayInteractionTarget } from "./canvas-interactions/review-overlay-interaction";
import {
  canvasPrimitiveReactStyle,
  canvasVectorPaint,
} from "./canvas-primitive-style";
import {
  CONTENT_SIZE_REPORT_MESSAGE_TYPE,
  appendContentSizeReporter,
  resolveStableContentSizeSample,
  type ContentSizeSample,
} from "./design-canvas/content-size-report";
import { getEmbeddedFrameDocumentContent } from "./design-canvas/embedded-frame";
import {
  getDesignCanvasIframeSandbox,
  useBrowserOrigin,
} from "./design-canvas/external-preview";
import { appendHitTestResponder } from "./design-canvas/hit-test";
import { withLocalRuntimes } from "./design-canvas/local-runtime";
import { roundGeo, trace, type TraceArea } from "./design-trace";
import { DesignCanvas } from "./DesignCanvas";
import { dndHostLog } from "./dnd-debug";
import {
  gradientToCss,
  parseGradientCss,
  type GradientStopValue,
} from "./inspector/GradientEditor";
import { sendLinkedScreenPreviewCancelPendingDelete } from "./multi-screen/linked-screen-preview";
import type {
  AltHoverMeasurement,
  AltHoverMeasurementLine,
  CanvasLayerMarqueeCandidate,
  CrossScreenDragElementRect,
  CrossScreenDropGuide,
  CrossScreenHitTestResult,
  DraftCreationPreview,
  DraftCreationTool,
  DraftGeometryModifiers,
  DraftPrimitive,
  DraftPrimitiveById,
  DragState,
  DuplicatePreview,
  FrameGeometry,
  FrameGeometryById,
  GradientEditOverlayTarget,
  MarqueeDragState,
  MarqueeRect,
  MultiScreenCanvasProps,
  MultiScreenCanvasTool,
  PendingWheelGesture,
  PersistedDraftPrimitive,
  Point,
  ResizeHandle,
  ResolvedScreenMetadata,
  ScreenContentCacheEntry,
  ScreenFile,
  ScreenProjectionNodeIdentity,
  TransformBadge,
  VectorEditOverlayState,
} from "./multi-screen/types";
import {
  getIframePaintRetentionStyle,
  SCALED_IFRAME_PAINT_RETENTION_STYLE,
} from "./scaled-iframe-paint";
import {
  type ElementInfo,
  type ElementSelectionIntent,
  type PortableStyleSnapshot,
} from "./types";

const SCREEN_WIDTH = OVERVIEW_FRAME_WIDTH;
const CANVAS_BACKGROUND_VAR = "var(--design-editor-canvas-bg)";
const SCREEN_HEIGHT = 640;
const SCREEN_CARD_HEIGHT = SCREEN_HEIGHT + 26;
const SCREEN_GAP = 56;
const DUPLICATE_DRAG_THRESHOLD = 6;
const DRAG_THRESHOLD = 3;

function eventEpochMilliseconds(eventTimeStamp: number): number {
  return eventTimeStamp >= 1_000_000_000_000
    ? eventTimeStamp
    : performance.timeOrigin + eventTimeStamp;
}

function serializeMarqueeHostSelection(
  activeId: string | null | undefined,
  selectedElementScreenId: string | null | undefined,
  selectedLayerSelectorGroupsByScreen: Record<string, string[][]>,
): string {
  return JSON.stringify([
    activeId ?? null,
    selectedElementScreenId ?? null,
    Object.entries(selectedLayerSelectorGroupsByScreen)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([screenId, groups]) => [screenId, groups]),
  ]);
}
const SELECTABLE_RECTS_REPLY_TIMEOUT_MS = 2_000;
const HIT_TEST_PREVIEW_TIMEOUT_MS = 250;
const HIT_TEST_COMMIT_TIMEOUT_MS = 1200;
const SCREEN_HOVER_PROMOTE_DELAY_MS = 300;
const FRAME_LABEL_HEIGHT = 28;
const FRAME_HEADER_BUTTON_COMPACT_WIDTH = 260;
const FRAME_HEADER_BUTTON_RESERVE = 116;
const FRAME_HEADER_COMPACT_BUTTON_RESERVE = 32;
const FRAME_LABEL_MIN_SCREEN_WIDTH = 20;
const TRANSFORM_BADGE_OFFSET = 12;
const TRANSFORM_BADGE_EDGE_PADDING = 8;
const TRANSFORM_BADGE_HEIGHT = 28;
const TRANSFORM_BADGE_MIN_WIDTH = 64;
const TRANSFORM_BADGE_MAX_WIDTH = 180;
const TOP_SCREEN_Z_BOOST = 100_000;
const DRAFT_PREVIEW_Z = TOP_SCREEN_Z_BOOST + 50_000;
const EMPTY_SELECTED_LAYER_SELECTOR_GROUPS_BY_SCREEN: Record<
  string,
  string[][]
> = {};
const EMPTY_SCREEN_IDS: readonly string[] = [];
const EMPTY_TWEAK_VALUES: Record<string, string> = {};
const STATIC_PREVIEW_TWEAK_BRIDGE = `<script data-agent-native-tweak-bridge>${tweakBridgeScript}</script>`;
const MIN_ZOOM = DEFAULT_CANVAS_MIN_ZOOM;
const MAX_ZOOM = DEFAULT_CANVAS_MAX_ZOOM;
const AUTOFIT_MIN_ZOOM = DEFAULT_CANVAS_AUTOFIT_MIN_ZOOM;
const MAX_WHEEL_PAN_DELTA = 240;
const CHROME_SCALE_CSS_VAR = "--an-chrome-scale";

const LAYOUT_GRID_LINE_CSS = `calc(1px * var(${CHROME_SCALE_CSS_VAR}, 1))`;

const MIN_LAYOUT_GRID_SCREEN_PX = 10;
const PIXEL_GRID_ZOOM = 800;

function hasScreenChildLayers(content: string): boolean {
  const body = content.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? "";
  const editableMarkup = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>|<(link|meta|base)\b[^>]*>/gi, // i18n-ignore regex removes non-rendered document elements
      "",
    )
    .trim();

  return editableMarkup.length > 0;
}

import {
  getBoardContentKey,
  getBoardContentLayerSignature,
  getBoardSurfaceContentBounds,
  getBoardSurfaceHtml,
  getBoardSurfaceRenderContent,
  getBoardSurfaceStaticPreviewContent,
  hasBoardRuntimeSurfaceContent,
  hasBoardSurfaceContent,
  shouldMountBoardSurface,
  shouldRenderEmptyBoardReviewCanvas,
} from "./multi-screen/board-surface-html";
import {
  getDraftCreationTool,
  isDirectScreenHoverTarget,
  isOsFileDrag,
  normalizeCanvasTool,
  shouldBeginCanvasPan,
  shouldBoardSurfaceCapturePointerEvents,
  shouldClearSelectionOnEmptyCanvasClick,
  shouldShowBreakpointMenuAffordance,
  shouldShowFrameFullViewButton,
} from "./multi-screen/canvas-tools";
import {
  CHROME_SETTLE_MS,
  getChromeBorderTransition,
  getChromeHandleTransition,
  getChromeLabelTransition,
  getSelectionBoxTransition,
} from "./multi-screen/chrome-transitions";
import {
  isCrossScreenIgnoreAutoLayoutHeldAtRelease,
  mergeCrossScreenReleaseModifiers,
  seedCrossScreenSKeyTimesAtStart,
  shouldClearCrossScreenSKeyTimesOnWindowBlur,
} from "./multi-screen/cross-screen-modifiers";
import {
  getCornerHandleGeometry,
  getEdgeHandleHitGeometry,
} from "./multi-screen/handle-hit-zones";
import {
  findCanvasIframeForScreen,
  frameCommandTargetIds,
  getActiveScreenIframeId,
  getBreakpointIframeId,
  isBreakpointSelectionTarget,
  shouldRenderBoardSelectionBox,
  shouldSuppressFrameSelectionBox,
} from "./multi-screen/iframe-targeting";
import {
  boardPointToBoardSurfaceLocalPoint,
  boardSurfaceLocalPointToBoardPoint,
  getBoardSelectionWorldBounds,
  getBoardSurfaceRenderGeometry,
  getBoardSurfaceLayerStyle,
  getBoardSurfaceStaticPreviewTransform,
  getBoardSurfaceStaticPreviewViewport,
  isLineupShrinkOnlyChange,
  OVERVIEW_FRAME_WIDTH,
  shouldDeferLineupRecenterToCameraCommand,
  shouldRenderBoardSurfaceStaticPreview,
  shouldSuppressLineupRecenter,
  SURFACE_PADDING,
  type LineupRecenterDuplicateArm,
} from "./multi-screen/overview-layout";
import { persistBoardDraftPrimitive } from "./multi-screen/persist-board-draft-primitive";
import {
  getCachedScreenContentNode,
  getPreviewUrl,
  pruneResolvedMetadataCache,
  pruneScreenContentCache,
  resolveScreenMetadata,
  resolveScreenMetadataCached,
  sameResolvedMetadata,
  type ResolvedMetadataCacheEntry,
} from "./multi-screen/screen-content-cache";
import {
  isWheelCameraGestureActive,
  setWheelCameraGestureActive,
} from "./multi-screen/wheel-gesture-state";

export function isApplePlatform(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    nav.platform || (nav.userAgentData && nav.userAgentData.platform) || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

const PEN_CLOSE_HIT_RADIUS_SCREEN_PX = 10;
const VECTOR_EDIT_HIT_RADIUS_SCREEN_PX = 8;

import {
  alignmentGuidesEqual,
  altHoverMeasurementEqual,
  computeAltHoverMeasurement,
  equalGapGuidesEqual,
  proximityMeasurementsEqual,
} from "./multi-screen/alt-hover-measurement";
import {
  boardPointToScreenLocalPoint,
  screenLocalPointToBoardPoint,
  screenLocalRectToBoardGeometry,
} from "./multi-screen/coordinate-transforms";
import {
  captureCrossScreenSourceHtmlSnapshot,
  getCrossScreenDropGuideForHitTest,
  getCrossScreenDropGuideStyle,
  getCrossScreenGhostStyle,
  isCrossScreenDropAxis,
  isCrossScreenDropMode,
  isCrossScreenDropPlacement,
  isCrossScreenHitTestAnchorRect,
  isFinitePoint,
  isPointerInsideSourceIframe,
  isPortableStyleSnapshot,
} from "./multi-screen/cross-screen-drop";
import {
  admitBootBudget,
  admitIframesProgressively,
  clampFrameGeometryToViewport,
  computeBoundedScreenCullState,
  getScreenContentCullState,
  getOverscannedViewportCanvasBounds,
  isFrameWithinOverscannedViewport,
  orderByViewportDistance,
  OVERVIEW_LIVE_SCREEN_BUDGET,
  OVERVIEW_STATIC_PREVIEW_OVERSCAN_FACTOR,
  resolveLiveEditorScreenIds,
  selectStaticPreviewScreenIds,
  type OverscannedViewportBounds,
  type LiveScreenBootStatus,
  type ScreenCullTier,
} from "./multi-screen/culling";
import {
  applyDraftGeometry,
  cloneDraftPrimitive,
  createDraftPrimitive,
  createPenDraftPrimitive,
  DRAFT_LINE_WIDTH,
  draftPrimitiveToInsert,
  getDraftGeometryForTool,
  getDraftPreviewGeometryForTool,
  isDraftPrimitive,
  moveDraftPrimitive,
  pointsToPath,
  polygonPointsForBox,
  previewDraftPrimitive,
  shapeClosingHandles,
} from "./multi-screen/draft-primitives";
import {
  drillInCandidateKey,
  resolveDrillInTarget,
  resolvePickTargetAtPoint,
} from "./multi-screen/drill-in";
import {
  angleBetween,
  BREAKPOINT_FRAME_GAP,
  cloneFrameGeometryById,
  findTopFrameEntryAtPoint,
  frameGeometryWithOverrides,
  frameStyleLeftTop,
  geometryContainsPoint,
  getBreakpointFrameGeometry,
  getFrameCenter,
  getInitialFrameGeometry,
  getLayerSelectableBounds,
  getOutsideFrameDraftFallback,
  getPreviewDeviceFrameGeometry,
  getResponsiveScreenCullGeometry,
  getScreenPreviewViewport,
  getSelectableBounds,
  rectContainsPoint,
  resolveFrameGeometrySync,
  resolveHitTestForegroundId,
  rotatePointAroundCenter,
  sameFrameGeometry,
  visibleBreakpointWidths,
} from "./multi-screen/frame-geometry";
import {
  angleFromDraggedEndpoint,
  gradientLineEndpoints,
  gradientStopPoints,
  screenPxToCanvasPx,
  stopPercentFromDraggedPoint,
} from "./multi-screen/gradient-overlay-geometry";
import {
  applyScreenPaintSuppression,
  collectScreenPaintTargets,
  resolveSuppressedScreenIds,
  type ScreenPaintCandidate,
  type ScreenPaintTarget,
} from "./multi-screen/paint-suppression";
import {
  getPrimitiveDropTargetForPoint,
  getPrimitiveLowZoomHitRect,
  parsePrimitivesFromScreen,
  resolveNodeScreenId,
  type PrimitiveDropTarget,
} from "./multi-screen/primitive-drop-target";
import { resolveAutoFitScreenHeight } from "./multi-screen/screen-height";
import {
  clampScreenFrameSize,
  readScreenSizeConstraints,
  screenSizeConstraintsToFrameBounds,
} from "./multi-screen/screen-sizing";
import type {
  AlignmentGuide,
  CanvasFrameEntry,
  KScaleStyleChange,
  KScaleStyleChangesByFrameId,
} from "./multi-screen/types";
import { vectorEditCanvasToLocalPoint } from "./multi-screen/vector-edit-geometry";
import {
  accumulateZoomFactor,
  clampZoomFactor,
  normalizeWheelDeltaPx,
  panAfterSurfaceLeftShift,
  resolveExternalZoomAnchor,
  resolveZoomGestureDevice,
  type ZoomGestureDevice,
} from "./multi-screen/zoom-gesture";

function applyDraftPrimitiveToDom(
  element: HTMLElement,
  draft: DraftPrimitive,
): void {
  const { geometry } = draft;
  const { left, top } = frameStyleLeftTop(geometry);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${geometry.width}px`;
  element.style.height = `${geometry.height}px`;
  element.style.transform = geometry.rotation
    ? `rotate(${geometry.rotation}deg)`
    : "";

  if (
    draft.kind === "path" ||
    draft.kind === "line" ||
    draft.kind === "arrow"
  ) {
    const svgEl = element.querySelector("svg");
    const pathEl = element.querySelector("path");
    svgEl?.setAttribute(
      "viewBox",
      `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`,
    );
    if (pathEl) {
      const pathData =
        draft.pathData ??
        (draft.penPath
          ? serializePenPath(draft.penPath)
          : pointsToPath(draft.points ?? []));
      pathEl.setAttribute("d", pathData);
      if (draft.strokeWidth !== undefined) {
        pathEl.setAttribute("stroke-width", String(draft.strokeWidth));
      }
    }
  } else if (draft.kind === "polygon" || draft.kind === "star") {
    const svgEl = element.querySelector("svg");
    const polygonEl = element.querySelector("polygon");
    svgEl?.setAttribute(
      "viewBox",
      `0 0 ${Math.max(1, geometry.width)} ${Math.max(1, geometry.height)}`,
    );
    polygonEl?.setAttribute(
      "points",
      polygonPointsForBox(draft.kind, geometry.width, geometry.height),
    );
  }
}

export const MultiScreenCanvas = memo(function MultiScreenCanvas({
  screens,
  zoom,
  activeId,
  selectedScreenIds,
  exportPreviewScreenId = null,
  selectedElementScreenId = null,
  selectedPenPathNodeId,
  hiddenScreenIds = EMPTY_SCREEN_IDS,
  lockedScreenIds = EMPTY_SCREEN_IDS,
  fullViewScreenIds,
  pendingReviewScreenIds = EMPTY_SCREEN_IDS,
  onReviewPendingScreen,
  interactMode = false,
  interactScreenId = null,
  focusedInteractViewport = null,
  readOnly = false,
  editableScreenIds,
  activeScreenHasHoveredChild = false,
  hoveredChildScreenId,
  directlyHoveredScreenId,
  previewDeviceFrame = "none",
  activeTool,
  reviewResourceId,
  reviewPinMode = false,
  reviewCommentsHidden = false,
  reviewCanPost = false,
  reviewCanResolve = false,
  reviewTargetId,
  reviewFocusRequest,
  reviewCurrentUserEmail,
  onExitReviewPinMode,
  onDispatchCommentToAgent,
  onSendThreadToAgent,
  reviewSendingThreadId,
  reviewDesignTitle,
  toolProps,
  onActiveToolChange,
  onCommentPin,
  onPick,
  onEdit,
  metadataById,
  screenRootComputedStylesById,
  getScreenMetadata,
  onDuplicate,
  geometryById,
  geometryOverridesById,
  onGeometryChange,
  onGeometryCommit,
  onBreakpointContentHeightChange,
  onPrimaryContentHeightChange,
  onScreenContentNaturalHeightChange,
  onCreatePrimitive,
  onPrimitiveCreated,
  onUpdatePenPath,
  onPrimitiveReparent,
  onCreateScreenFrame,
  frameToolDraws = "frame",
  onDeleteSelection,
  onNudgeSelection,
  nudgeAmounts,
  layoutGrids,
  onZoomChange,
  renderScreenContent,
  screenContentRenderKey,
  screenSnapshotsById,
  tweakValues = EMPTY_TWEAK_VALUES,
  renderBreakpointContent,
  onScreenSelectionChange,
  selectAllRequest,
  clearSelectionRequest,
  onAddBreakpoint,
  breakpointMutationPending = false,
  onActiveBreakpointChange,
  onRemoveBreakpoint,
  onChangeBreakpointWidth,
  onEditBreakpoint,
  onSelectionChange,
  onLayerMarqueeSelectionChange,
  selectedLayerSelectorGroupsByScreen = EMPTY_SELECTED_LAYER_SELECTOR_GROUPS_BY_SCREEN,
  onCrossScreenElementDrop,
  boardFileId,
  boardCodeLayerSource,
  canvasBackground,
  boardFileContent,
  boardFrameGeometry,
  onBoardDrawPrimitive,
  boardEditMode = false,
  boardIsActive = false,
  boardRuntimeStructureInsertRequest,
  boardRuntimeStructureRollbackRequest,
  runtimeStructurePendingTransactionRef,
  onBoardRuntimeStructureInsertRejected,
  onBoardRuntimeStructureInsertApplied,
  onBoardRuntimeStructureRollbackResult,
  onBoardElementSelect,
  onBoardSelectionWorldBoundsChange,
  onBoardElementMarqueeSelect,
  onBoardElementHover,
  onBoardElementClear,
  onBoardElementDblClickText,
  onBoardIframeHotkey,
  onBoardFigmaClipboardPaste,
  onBoardImagePaste,
  onBoardIframeContextMenu,
  onBoardTextEditingStateChange,
  boardClearSelectionRequest,
  boardSelectedSelector,
  boardSelectedSelectorCandidates,
  boardSelectedSourceId,
  boardHoveredSelector,
  boardHoveredSelectorCandidates,
  boardLockedSelectors,
  boardHiddenSelectors,
  onBoardVisualStructureChange,
  onBoardVisualStyleChange,
  onBoardVisualStyleBatchChange,
  onBoardVisualDuplicateChange,
  onBoardTextContentChange,
  vectorEdit,
  gradientEditTarget,
  onDropFiles,
  cameraCommand,
  suppressLineupRecenter,
  preserveCameraOnScreenCountChange = false,
  deferLineupZoomChange = false,
  chromeInsetLeft = 0,
  chromeInsetRight = 0,
  visibleCanvasRectRef,
}: MultiScreenCanvasProps) {
  const { resolvedTheme } = useTheme();
  const t = useT();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initialCanvasFocusPendingRef = useRef(true);
  const initialCanvasFocusAttemptedRef = useRef(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const [canvasZoom, setCanvasZoom] = useState(zoom);
  const zoomRef = useRef(zoom);
  const previousControlledZoomRef = useRef(zoom);
  const controlledZoomRevisionRef = useRef(0);
  if (previousControlledZoomRef.current !== zoom) {
    previousControlledZoomRef.current = zoom;
    controlledZoomRevisionRef.current += 1;
  }
  const lastReportedZoomRef = useRef(zoom);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;
  const lineupRecenterCameraRef = useRef({
    x: panRef.current.x,
    y: panRef.current.y,
    zoom: zoomRef.current,
  });
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [crossScreenDragActive, setCrossScreenDragActive] = useState(false);
  const [boardRuntimeSurfaceActive, setBoardRuntimeSurfaceActive] = useState<
    string | null
  >(null);
  const boardCrossScreenDropPendingRef = useRef(false);
  const boardCrossScreenDropTransactionRef = useRef<string | null>(null);
  const boardCrossScreenDropTimeoutTransactionRef = useRef<string | null>(null);
  const boardCrossScreenDropTimeoutRef = useRef<number | null>(null);
  const onBoardRuntimeStructureInsertRejectedRef = useRef(
    onBoardRuntimeStructureInsertRejected,
  );
  onBoardRuntimeStructureInsertRejectedRef.current =
    onBoardRuntimeStructureInsertRejected;
  const finishBoardCrossScreenDrop = useCallback(
    (options?: { preserveTransaction?: boolean; force?: boolean }) => {
      if (!boardCrossScreenDropPendingRef.current && !options?.force) return;
      boardCrossScreenDropPendingRef.current = false;
      if (boardCrossScreenDropTimeoutRef.current !== null) {
        window.clearTimeout(boardCrossScreenDropTimeoutRef.current);
        boardCrossScreenDropTimeoutRef.current = null;
      }
      boardCrossScreenDropTimeoutTransactionRef.current = null;
      if (!options?.preserveTransaction) {
        boardCrossScreenDropTransactionRef.current = null;
      }
      setCrossScreenDragActive(false);
    },
    [],
  );
  useEffect(() => {
    const transactionId = boardRuntimeStructureInsertRequest?.transactionId;
    if (!transactionId || !boardCrossScreenDropPendingRef.current) return;
    boardCrossScreenDropTransactionRef.current = transactionId;
  }, [boardRuntimeStructureInsertRequest]);
  useEffect(
    () => () => {
      if (boardCrossScreenDropTimeoutRef.current !== null) {
        window.clearTimeout(boardCrossScreenDropTimeoutRef.current);
      }
    },
    [],
  );
  const [boardRuntimeSurfaceState, setBoardRuntimeSurfaceState] = useState<{
    boardFileId: string | null;
    requestKeys: string[];
  }>({ boardFileId: null, requestKeys: [] });
  const [frameGeometry, setFrameGeometry] = useState<FrameGeometryById>({});
  const frameGeometryRef = useRef(frameGeometry);
  const renderedScreenIdsRef = useRef<Set<string>>(new Set());
  const renderedFrameGeometryRef = useRef<FrameGeometryById>({});
  const [measuredIframeHeights, setMeasuredIframeHeights] = useState<
    Record<string, number>
  >({});
  const [measuredIframeNaturalHeights, setMeasuredIframeNaturalHeights] =
    useState<Record<string, number>>({});
  const contentSizeSamplesRef = useRef<Record<string, ContentSizeSample>>({});
  const liveFrameDragPositionsRef = useRef(
    new Map<string, { left: number; top: number }>(),
  );
  const liveFrameDragSelectionPositionRef = useRef<{
    left: number;
    top: number;
  } | null>(null);
  const onGeometryChangeRef = useRef(onGeometryChange);
  const onGeometryCommitRef = useRef(onGeometryCommit);
  const onBreakpointContentHeightChangeRef = useRef(
    onBreakpointContentHeightChange,
  );
  const onPrimaryContentHeightChangeRef = useRef(onPrimaryContentHeightChange);
  const onScreenContentNaturalHeightChangeRef = useRef(
    onScreenContentNaturalHeightChange,
  );
  const onNudgeSelectionRef = useRef(onNudgeSelection);
  const nudgeAmountsRef = useRef(nudgeAmounts);
  const layoutGridsRef = useRef(layoutGrids);
  const screensRef = useRef(screens);
  const [draftPrimitives, setDraftPrimitives] = useState<DraftPrimitive[]>([]);
  const draftPrimitivesRef = useRef(draftPrimitives);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const selectedDraftIdsRef = useRef(selectedDraftIds);
  const [creationPreview, setCreationPreview] =
    useState<DraftCreationPreview | null>(null);
  const [activePenPath, setActivePenPath] = useState<PenPath | null>(null);
  const activePenPathRef = useRef<PenPath | null>(activePenPath);
  const penContinuesVectorEditRef = useRef(false);
  const penContinuationBaseCountRef = useRef(0);
  const continuationPenPathRef = useRef<{
    frameId: string;
    nodeId: string;
    path: PenPath;
  } | null>(null);
  const seedSelectedPenContinuationRef = useRef<() => void>(() => {});
  useEffect(() => {
    const continuation = continuationPenPathRef.current;
    if (
      continuation &&
      selectedPenPathNodeId !== undefined &&
      selectedPenPathNodeId !== continuation.nodeId
    ) {
      continuationPenPathRef.current = null;
    }
  }, [selectedPenPathNodeId]);
  const [penGesturePreview, setPenGesturePreview] = useState<PenPath | null>(
    null,
  );
  const [penPointer, setPenPointer] = useState<Point | null>(null);
  const [penCloseHover, setPenCloseHover] = useState(false);
  const clearActivePenPath = useCallback(() => {
    activePenPathRef.current = null;
    setActivePenPath(null);
    setPenGesturePreview(null);
    setPenPointer(null);
    setPenCloseHover(false);
  }, []);
  const lastPenClientPointRef = useRef<{
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  } | null>(null);
  const [localActiveTool, setLocalActiveTool] =
    useState<MultiScreenCanvasTool>("move");
  const effectiveToolRef = useRef<MultiScreenCanvasTool>("move");
  const hiddenScreenIdSet = useMemo(
    () => new Set(hiddenScreenIds),
    [hiddenScreenIds],
  );
  const lockedScreenIdSet = useMemo(
    () => new Set(lockedScreenIds),
    [lockedScreenIds],
  );
  const pendingReviewScreenIdSet = useMemo(
    () => new Set(pendingReviewScreenIds),
    [pendingReviewScreenIds],
  );
  const renderedScreens = useMemo(
    () => screens.filter((screen) => !hiddenScreenIdSet.has(screen.id)),
    [hiddenScreenIdSet, screens],
  );
  const selectableScreens = useMemo(
    () => renderedScreens.filter((screen) => !lockedScreenIdSet.has(screen.id)),
    [lockedScreenIdSet, renderedScreens],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    (selectedScreenIds ?? []).filter((id) =>
      selectableScreens.some((screen) => screen.id === id),
    ),
  );
  const screenIndexById = useMemo(
    () => new Map(screens.map((screen, index) => [screen.id, index] as const)),
    [screens],
  );
  const [boardSurfaceFocusPoint, setBoardSurfaceFocusPoint] =
    useState<Point | null>(null);
  const pendingStaticBoardSelectionRef = useRef<{
    nodeId: string;
    point: Point;
  } | null>(null);
  const cancelPendingStaticBoardSelection = useCallback(() => {
    pendingStaticBoardSelectionRef.current = null;
    setBoardSurfaceFocusPoint(null);
  }, []);
  const boardSurfaceContentBounds = useMemo(
    () => getBoardSurfaceContentBounds(boardFileContent),
    [boardFileContent],
  );
  const boardViewportGeometry = useMemo((): FrameGeometry | undefined => {
    if (surfaceSize.width <= 0 || surfaceSize.height <= 0) return undefined;
    const scale = Math.max(0.0001, canvasZoom / 100);
    return {
      x: -pan.x / scale - SURFACE_PADDING,
      y: -pan.y / scale - SURFACE_PADDING,
      width: surfaceSize.width / scale,
      height: surfaceSize.height / scale,
    };
  }, [canvasZoom, pan.x, pan.y, surfaceSize.height, surfaceSize.width]);
  const boardSurfaceRenderGeometry = useMemo(() => {
    if (!boardFrameGeometry) return undefined;
    const focusGeometry = boardSurfaceFocusPoint
      ? {
          x: boardSurfaceFocusPoint.x,
          y: boardSurfaceFocusPoint.y,
          width: 1,
          height: 1,
        }
      : (boardViewportGeometry ?? boardSurfaceContentBounds);
    return getBoardSurfaceRenderGeometry({
      logicalGeometry: boardFrameGeometry,
      contentBounds: boardSurfaceContentBounds,
      screenGeometries: [
        ...Object.values(frameGeometry),
        ...(boardViewportGeometry ? [boardViewportGeometry] : []),
      ],
      focus: focusGeometry ? getFrameCenter(focusGeometry) : undefined,
    });
  }, [
    boardFrameGeometry,
    boardSurfaceContentBounds,
    boardSurfaceFocusPoint,
    boardViewportGeometry,
    frameGeometry,
  ]);
  const boardSurfaceRenderGeometryRef = useRef(boardSurfaceRenderGeometry);
  useEffect(() => {
    boardSurfaceRenderGeometryRef.current = boardSurfaceRenderGeometry;
  }, [boardSurfaceRenderGeometry]);
  const boardStaticPreviewViewport = useMemo(
    () =>
      boardFrameGeometry
        ? getBoardSurfaceStaticPreviewViewport(boardFrameGeometry)
        : null,
    [boardFrameGeometry],
  );
  const boardStaticPreviewRef = useRef<HTMLIFrameElement>(null);
  const boardFrameGeometryRef = useRef(boardFrameGeometry);
  boardFrameGeometryRef.current = boardFrameGeometry;
  const handleBoardRuntimeStructureInsertApplied = useCallback(
    (details: {
      requestId: string;
      transactionId?: string;
      routePath?: string;
      selector: string;
      sourceId?: string;
      applied?: boolean;
    }) => {
      if (details.applied !== false && details.selector && boardFileId) {
        const requestKey = details.transactionId ?? details.requestId;
        setBoardRuntimeSurfaceState((current) => {
          const base =
            current.boardFileId === boardFileId
              ? current
              : { boardFileId, requestKeys: [] };
          return base.requestKeys.includes(requestKey)
            ? base
            : { ...base, requestKeys: [...base.requestKeys, requestKey] };
        });
      }
      onBoardRuntimeStructureInsertApplied?.(details);
    },
    [boardFileId, onBoardRuntimeStructureInsertApplied],
  );
  const handleBoardRuntimeStructureRollbackResult = useCallback(
    (details: {
      requestId: string;
      transactionId?: string;
      applied: boolean;
      reason?: string;
    }) => {
      if (details.applied && details.transactionId && boardFileId) {
        setBoardRuntimeSurfaceState((current) => {
          if (current.boardFileId !== boardFileId) return current;
          const requestKeys = current.requestKeys.filter(
            (key) => key !== details.transactionId,
          );
          return requestKeys.length > 0
            ? { ...current, requestKeys }
            : { boardFileId: null, requestKeys: [] };
        });
      }
      onBoardRuntimeStructureRollbackResult?.(details);
    },
    [boardFileId, onBoardRuntimeStructureRollbackResult],
  );
  const boardSurfaceHtml = shouldMountBoardSurface({
    hasAuthoredContent: hasBoardSurfaceContent(boardFileContent),
    crossScreenDragActive,
    hasPendingRuntimeInsert: Boolean(boardRuntimeStructureInsertRequest),
    hasPendingRuntimeRollback: Boolean(boardRuntimeStructureRollbackRequest),
    runtimeContentBoardId: boardRuntimeSurfaceActive,
    boardFileId,
    hasRuntimeContent: hasBoardRuntimeSurfaceContent({
      boardFileId,
      runtimeBoardFileId: boardRuntimeSurfaceState.boardFileId,
      runtimeRequestKeys: boardRuntimeSurfaceState.requestKeys,
    }),
  })
    ? getBoardSurfaceHtml(boardFileContent)
    : undefined;
  const boardHasSurfaceContent = boardSurfaceHtml !== undefined;
  const boardReviewGeometry = boardSurfaceRenderGeometry ?? {
    x: 0,
    y: 0,
    width: 8192,
    height: 8192,
  };
  const renderEmptyBoardReviewCanvas = shouldRenderEmptyBoardReviewCanvas({
    hasSurfaceContent: boardHasSurfaceContent,
    reviewPinMode,
    reviewCommentsHidden,
    reviewTargetId,
  });
  const boardStaticPreviewContent = useMemo(() => {
    if (
      !boardFrameGeometry ||
      !boardStaticPreviewViewport ||
      !boardSurfaceHtml
    ) {
      return null;
    }
    return getBoardSurfaceStaticPreviewContent({
      darkScheme: resolvedTheme === "dark",
      html: boardSurfaceHtml,
      logicalGeometry: boardFrameGeometry,
      viewport: boardStaticPreviewViewport,
    });
  }, [
    boardSurfaceHtml,
    boardFrameGeometry,
    boardStaticPreviewViewport,
    resolvedTheme,
  ]);
  const showBoardStaticPreview = Boolean(
    boardFrameGeometry &&
    boardViewportGeometry &&
    boardSurfaceRenderGeometry &&
    boardStaticPreviewContent &&
    shouldRenderBoardSurfaceStaticPreview({
      zoom: canvasZoom,
      hasSurfaceContent: boardHasSurfaceContent,
      viewportGeometry: boardViewportGeometry,
      renderGeometry: boardSurfaceRenderGeometry,
    }),
  );
  const boardStaticPrimitives = useMemo(() => {
    if (!boardFileId || !boardFileContent) return [];
    return parsePrimitivesFromScreen({
      id: boardFileId,
      filename: "__board__.html",
      content: boardFileContent,
      codeLayerSource: boardCodeLayerSource,
    });
  }, [boardCodeLayerSource, boardFileContent, boardFileId]);
  useEffect(() => {
    cancelPendingStaticBoardSelection();
  }, [cancelPendingStaticBoardSelection, canvasZoom, pan.x, pan.y]);
  useEffect(() => {
    cancelPendingStaticBoardSelection();
  }, [
    activeTool,
    boardFileContent,
    boardFileId,
    boardFrameGeometry?.height,
    boardFrameGeometry?.width,
    boardFrameGeometry?.x,
    boardFrameGeometry?.y,
    cancelPendingStaticBoardSelection,
    localActiveTool,
  ]);
  useEffect(() => {
    if (!showBoardStaticPreview) cancelPendingStaticBoardSelection();
  }, [cancelPendingStaticBoardSelection, showBoardStaticPreview]);
  useEffect(() => {
    const pending = pendingStaticBoardSelectionRef.current;
    if (
      !pending ||
      !boardFileId ||
      !boardSurfaceRenderGeometry ||
      !geometryContainsPoint(boardSurfaceRenderGeometry, pending.point)
    ) {
      return;
    }
    const selector = `[data-agent-native-node-id="${CSS.escape(pending.nodeId)}"]`;
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (pendingStaticBoardSelectionRef.current !== pending) return;
        const iframe = findCanvasIframeForScreen(
          surfaceRef.current,
          boardFileId,
          boardFileId,
        );
        const targetWindow = iframe?.contentWindow;
        if (!targetWindow) return;
        targetWindow.postMessage(
          {
            type: "select-element",
            selector,
            selectorCandidates: [selector],
          },
          "*",
        );
        if (pendingStaticBoardSelectionRef.current === pending) {
          pendingStaticBoardSelectionRef.current = null;
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [boardFileId, boardSurfaceRenderGeometry]);
  const selectedIdsRef = useRef(selectedIds);
  const selectedElementScreenIdRef = useRef(selectedElementScreenId);
  useEffect(() => {
    selectedElementScreenIdRef.current = selectedElementScreenId;
  }, [selectedElementScreenId]);
  const marqueeHostSelectionRevisionRef = useRef("");
  marqueeHostSelectionRevisionRef.current = serializeMarqueeHostSelection(
    activeId,
    selectedElementScreenId,
    selectedLayerSelectorGroupsByScreen,
  );
  const dragState = useRef<DragState | null>(null);
  const marqueeLifecycleRef = useRef(0);
  const dragCleanup = useRef<(() => void) | null>(null);
  const boardElementResizeCancel = useRef<((pressedAt: number) => void) | null>(
    null,
  );
  const duplicateCleanup = useRef<(() => void) | null>(null);
  const duplicateBatchSequenceRef = useRef(0);
  const lineupRecenterSuppressRef = useRef<LineupRecenterDuplicateArm | null>(
    null,
  );
  const lastSuppressLineupRecenterNonceRef = useRef<number | null>(null);
  const lineupRecenterDeviceFrameRef = useRef(previewDeviceFrame);
  const lineupRecenterPrevCountRef = useRef<number | null>(null);
  const handledSelectAllRequestRef = useRef(selectAllRequest);
  const handledClearSelectionRequestRef = useRef(clearSelectionRequest);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
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
  const [proximityMeasurements, setProximityMeasurementsRaw] = useState<
    ProximityMeasurement[]
  >([]);
  const setAlignmentGuides = useCallback((next: AlignmentGuide[]) => {
    setAlignmentGuidesRaw((current) =>
      alignmentGuidesEqual(current, next) ? current : next,
    );
  }, []);
  const setProximityMeasurements = useCallback(
    (next: ProximityMeasurement[]) => {
      setProximityMeasurementsRaw((current) =>
        proximityMeasurementsEqual(current, next) ? current : next,
      );
    },
    [],
  );
  const setEqualGapGuides = useCallback((next: EqualGapGuide[]) => {
    setEqualGapGuidesRaw((current) =>
      equalGapGuidesEqual(current, next) ? current : next,
    );
  }, []);
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
  const duplicatePreviewElRef = useRef<HTMLDivElement | null>(null);
  const [transformBadge, setTransformBadge] = useState<TransformBadge | null>(
    null,
  );
  const [dragCursor, setDragCursor] = useState<string | null>(null);
  const [primitiveDropTarget, setPrimitiveDropTarget] =
    useState<PrimitiveDropTarget | null>(null);
  const primitiveDropTargetRef = useRef<PrimitiveDropTarget | null>(null);
  const onPrimitiveReparentRef = useRef(onPrimitiveReparent);
  const vectorEditRef = useRef(vectorEdit);

  interface CrossScreenDragGhost {
    boardX: number;
    boardY: number;
    width?: number;
    height?: number;
    dimmed?: boolean;
    background?: string;
    borderRadius?: string;
  }
  interface CrossScreenDragTarget {
    id: string;
    geometry: FrameGeometry;
  }
  const crossScreenClaimSentRef = useRef<{
    sourceScreenId: string;
    claimed: boolean;
  } | null>(null);
  const crossScreenProxyTraceRef = useRef<string | null>(null);
  const crossScreenResolveTraceRef = useRef<string | null>(null);
  const [crossScreenGhost, setCrossScreenGhost] =
    useState<CrossScreenDragGhost | null>(null);
  const [, setCrossScreenTarget] = useState<CrossScreenDragTarget | null>(null);
  const [fileDragOverFrameId, setFileDragOverFrameId] = useState<string | null>(
    null,
  );
  const fileDragOverFrameRef = useRef<string | null>(null);
  const fileDragDepthRef = useRef(0);
  const fileDragRafRef = useRef<number | null>(null);
  const pendingFileDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const [crossScreenDropGuide, setCrossScreenDropGuide] =
    useState<CrossScreenDropGuide | null>(null);
  const crossScreenTargetRef = useRef<CrossScreenDragTarget | null>(null);
  const crossScreenHitTestSeqRef = useRef(0);
  const crossScreenPreviewGenerationRef = useRef(0);
  const crossScreenDropSeqRef = useRef(0);
  const crossScreenEndSeenRef = useRef(false);
  const crossScreenHostCommittedRef = useRef(false);
  const crossScreenIgnoreAutoLayoutRef = useRef(false);
  const crossScreenSKeyTimesRef = useRef<{
    downAt: number | null;
    upAt: number | null;
  }>({ downAt: null, upAt: null });
  const crossScreenSKeyPressedRef = useRef(false);
  const crossScreenControlPressedRef = useRef(false);
  const canvasMountedRef = useRef(true);
  const crossScreenPreviewTargetIdRef = useRef<string | null>(null);
  const crossScreenDragMsgRef = useRef<{
    selector: string;
    sourceId?: string;
    sourceDeleteRequestId?: string;
    sourceProvenance?: SourceNodeProvenance;
    sourcePointerOffset?: Point;
    sourceElementSize?: { width: number; height: number };
    sourceComputedSize?: { width?: number; height?: number };
    modifiers?: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      ignoreAutoLayout?: boolean;
      forceNestedAutoLayout?: boolean;
    };
    sourceHtmlSnapshot?: string;
    duplicate?: boolean;
    sourceCloneHtml?: string;
    styleSnapshot?: PortableStyleSnapshot;
    styleSnapshotCaptureFailed?: boolean;
  } | null>(null);
  const crossScreenParentDragCleanupRef = useRef<(() => void) | null>(null);
  const crossScreenSourceFrameAtStartRef = useRef<{
    screenId: string;
    width: number;
    height: number;
    viewportW: number;
    viewportH: number;
  } | null>(null);
  const crossScreenLastBoardPointRef = useRef<{ x: number; y: number } | null>(
    null,
  );
  const crossScreenMoveRafRef = useRef<number | null>(null);
  const crossScreenPendingMoveRef = useRef<{
    boardPoint: Point;
    sourceScreenId: string;
  } | null>(null);
  const crossScreenLastHitResultRef = useRef<
    Map<
      string,
      {
        generation: number;
        requestSeq: number;
        result: CrossScreenHitTestResult;
      }
    >
  >(new Map());
  const onCrossScreenElementDropRef = useRef(onCrossScreenElementDrop);
  const onBoardDrawPrimitiveRef = useRef(onBoardDrawPrimitive);
  const finishDragRef = useRef<() => void>(() => {});
  const applyViewToDomRef = useRef<() => void>(() => {});
  const scheduleViewCommitRef = useRef<
    (options?: { settleChrome?: boolean }) => void
  >(() => {});
  const recomputePenPointerForViewChangeRef = useRef<() => void>(() => {});
  const suppressNextPick = useRef(false);
  const drillInTargetRef = useRef<{ screenId: string; key: string } | null>(
    null,
  );
  const drillInRequestRef = useRef(0);
  const feedbackTimerRef = useRef<number | null>(null);
  const pendingZoomGestureRef = useRef<Extract<
    PendingWheelGesture,
    { mode: "zoom" }
  > | null>(null);
  const pendingPanGestureRef = useRef<Extract<
    PendingWheelGesture,
    { mode: "pan" }
  > | null>(null);
  const zoomGestureDeviceRef = useRef<ZoomGestureDevice | null>(null);
  const wheelGestureFrameRef = useRef<number | null>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const pixelGridRef = useRef<HTMLDivElement>(null);
  const marqueeOverlayRef = useRef<HTMLSpanElement>(null);
  const viewCommitTimerRef = useRef<number | null>(null);
  const lastCameraCommandNonceRef = useRef<number | null>(null);
  const lastCameraCommandZoomRef = useRef<number | null>(null);
  const lastCameraCommandControlledZoomRef = useRef<number | null>(null);
  const pendingCameraCommandZoomRevisionRef = useRef<{
    nonce: number;
    revision: number;
  } | null>(null);
  const pendingChromeSettleRef = useRef(false);
  const chromeSettleTimerRef = useRef<number | null>(null);
  const [chromeSettling, setChromeSettling] = useState(false);
  const previousPreviewDeviceFrameRef = useRef(previewDeviceFrame);
  const hasBeenVisibleScreenIdsRef = useRef<Set<string>>(new Set());
  const liveScreenIdsRef = useRef<Set<string>>(new Set());
  const lastVisibleEpochByScreenIdRef = useRef<Map<string, number>>(new Map());
  const cullAccessEpochRef = useRef(0);
  const bootStatusByScreenIdRef = useRef<Map<string, LiveScreenBootStatus>>(
    new Map(),
  );
  const bootFrameCountByScreenIdRef = useRef<Map<string, number>>(new Map());
  const bootReadyFrameIdsByScreenIdRef = useRef<Map<string, Set<string>>>(
    new Map(),
  );
  const bootTimeoutByScreenIdRef = useRef<Map<string, number>>(new Map());
  const bootStartCallbackByFrameIdRef = useRef<Map<string, () => void>>(
    new Map(),
  );
  const bridgeReadyCallbackByFrameIdRef = useRef<Map<string, () => void>>(
    new Map(),
  );
  const [bootStatusRevision, setBootStatusRevision] = useState(0);
  const [hoverPromotedScreenId, setHoverPromotedScreenId] = useState<
    string | null
  >(null);
  const hoverPromoteTimerRef = useRef<
    { screenId: string; timer: number } | undefined
  >(undefined);
  const handleScreenHoverIntent = useCallback(
    (screenId: string, hovered: boolean) => {
      const pending = hoverPromoteTimerRef.current;
      if (!hovered) {
        if (pending?.screenId !== screenId) return;
        window.clearTimeout(pending.timer);
        hoverPromoteTimerRef.current = undefined;
        return;
      }
      if (pending) window.clearTimeout(pending.timer);
      hoverPromoteTimerRef.current = {
        screenId,
        timer: window.setTimeout(() => {
          hoverPromoteTimerRef.current = undefined;
          setHoverPromotedScreenId(screenId);
        }, SCREEN_HOVER_PROMOTE_DELAY_MS),
      };
    },
    [],
  );
  useEffect(
    () => () => window.clearTimeout(hoverPromoteTimerRef.current?.timer),
    [],
  );
  const tweakValuesRef = useRef(tweakValues);
  tweakValuesRef.current = tweakValues;
  const postStaticPreviewTweakValues = useCallback(
    (iframe: HTMLIFrameElement) => {
      iframe.contentWindow?.postMessage(
        { type: "tweak-values", values: tweakValuesRef.current },
        "*",
      );
    },
    [],
  );
  useEffect(() => {
    surfaceRef.current
      ?.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-screen-static-preview]",
      )
      .forEach(postStaticPreviewTweakValues);
  }, [postStaticPreviewTweakValues, tweakValues]);
  const markScreenBootReady = useCallback(
    (screenId: string, frameId?: string) => {
      if (!bootFrameCountByScreenIdRef.current.has(screenId)) return;
      const status = bootStatusByScreenIdRef.current.get(screenId);
      if (status === "ready") return;
      if (frameId !== undefined) {
        const readyFrameIds =
          bootReadyFrameIdsByScreenIdRef.current.get(screenId) ?? new Set();
        readyFrameIds.add(frameId);
        bootReadyFrameIdsByScreenIdRef.current.set(screenId, readyFrameIds);
        if (
          readyFrameIds.size <
          (bootFrameCountByScreenIdRef.current.get(screenId) ?? 1)
        ) {
          return;
        }
      }
      const timeoutId = bootTimeoutByScreenIdRef.current.get(screenId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      bootTimeoutByScreenIdRef.current.delete(screenId);
      bootStatusByScreenIdRef.current.set(screenId, "ready");
      setBootStatusRevision((revision) => revision + 1);
    },
    [],
  );
  const markScreenBootStart = useCallback(
    (screenId: string, frameId?: string) => {
      const status = bootStatusByScreenIdRef.current.get(screenId);
      if (!status) return;
      const readyFrameIds =
        bootReadyFrameIdsByScreenIdRef.current.get(screenId) ?? new Set();
      const frameWasReady = frameId
        ? readyFrameIds.delete(frameId)
        : readyFrameIds.size > 0;
      if (!frameId) readyFrameIds.clear();
      bootReadyFrameIdsByScreenIdRef.current.set(screenId, readyFrameIds);
      if (status === "booting" && !frameWasReady) return;
      const timeoutId = bootTimeoutByScreenIdRef.current.get(screenId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      const nextTimeoutId = window.setTimeout(
        () => markScreenBootReady(screenId),
        8_000,
      );
      bootTimeoutByScreenIdRef.current.set(screenId, nextTimeoutId);
      bootStatusByScreenIdRef.current.set(screenId, "booting");
      setBootStatusRevision((revision) => revision + 1);
    },
    [markScreenBootReady],
  );
  const getScreenBootStartCallback = useCallback(
    (screenId: string, frameId = "primary") => {
      const callbackKey = `${screenId}\0${frameId}`;
      const existing = bootStartCallbackByFrameIdRef.current.get(callbackKey);
      if (existing) return existing;
      const callback = () => markScreenBootStart(screenId, frameId);
      bootStartCallbackByFrameIdRef.current.set(callbackKey, callback);
      return callback;
    },
    [markScreenBootStart],
  );
  const getScreenBootReadyCallback = useCallback(
    (screenId: string, frameId = "primary") => {
      const callbackKey = `${screenId}\0${frameId}`;
      const existing = bridgeReadyCallbackByFrameIdRef.current.get(callbackKey);
      if (existing) return existing;
      const callback = () => markScreenBootReady(screenId, frameId);
      bridgeReadyCallbackByFrameIdRef.current.set(callbackKey, callback);
      return callback;
    },
    [markScreenBootReady],
  );
  const screenPaintCandidatesRef = useRef<ScreenPaintCandidate[]>([]);
  const screenPaintTargetsRef = useRef<ScreenPaintTarget[]>([]);
  const surfaceSizeRef = useRef({ width: 0, height: 0 });
  useEffect(() => {
    const liveScreenIds = new Set(screens.map((screen) => screen.id));
    for (const id of hasBeenVisibleScreenIdsRef.current) {
      if (!liveScreenIds.has(id)) {
        hasBeenVisibleScreenIdsRef.current.delete(id);
      }
    }
    for (const id of liveScreenIdsRef.current) {
      if (!liveScreenIds.has(id)) liveScreenIdsRef.current.delete(id);
    }
    for (const id of lastVisibleEpochByScreenIdRef.current.keys()) {
      if (!liveScreenIds.has(id)) {
        lastVisibleEpochByScreenIdRef.current.delete(id);
      }
    }
    for (const id of bootStatusByScreenIdRef.current.keys()) {
      if (liveScreenIds.has(id)) continue;
      const timeoutId = bootTimeoutByScreenIdRef.current.get(id);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      bootTimeoutByScreenIdRef.current.delete(id);
      bootStatusByScreenIdRef.current.delete(id);
      bootFrameCountByScreenIdRef.current.delete(id);
      bootReadyFrameIdsByScreenIdRef.current.delete(id);
      for (const key of bootStartCallbackByFrameIdRef.current.keys()) {
        if (key.startsWith(`${id}\0`)) {
          bootStartCallbackByFrameIdRef.current.delete(key);
        }
      }
      for (const key of bridgeReadyCallbackByFrameIdRef.current.keys()) {
        if (key.startsWith(`${id}\0`)) {
          bridgeReadyCallbackByFrameIdRef.current.delete(key);
        }
      }
    }
  }, [screens]);
  useEffect(
    () => () => {
      for (const timeoutId of bootTimeoutByScreenIdRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      bootTimeoutByScreenIdRef.current.clear();
      bootStatusByScreenIdRef.current.clear();
      bootFrameCountByScreenIdRef.current.clear();
      bootReadyFrameIdsByScreenIdRef.current.clear();
      bootStartCallbackByFrameIdRef.current.clear();
      bridgeReadyCallbackByFrameIdRef.current.clear();
    },
    [],
  );

  // Track the pannable surface's own on-screen size for culling's viewport
  // bounds (getOverscannedViewportCanvasBounds). Only the surface's *size*
  // matters here (not scroll/position), since world-space bounds are derived
  // from pan/zoom separately — a plain ResizeObserver on the fixed-position
  // surface element is sufficient and avoids reading getBoundingClientRect on
  // every render.
  // Measure before paint. A passive effect lets the initial {0,0} viewport
  // commit paint every on-screen frame as a placeholder, then swaps those
  // placeholders for live iframes one frame later — a visible cold-open flash.
  // The synchronous layout measurement keeps the first painted overview on
  // the correct culling tier while ResizeObserver owns later size changes.
  //
  // Also: when the left chrome opens/closes (or minimal mode toggles), the
  // surface's left edge moves while its width changes. Without compensating
  // pan.x by that left-edge delta, every board item appears to slide with the
  // chrome. Keep world content fixed in viewport/monitor coordinates.
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const updateSize = (width: number, height: number) => {
      surfaceSizeRef.current = { width, height };
      setSurfaceSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    const rect = surface.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    let lastLeft = rect.left;
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
      const nextLeft = surface.getBoundingClientRect().left;
      const deltaLeft = nextLeft - lastLeft;
      lastLeft = nextLeft;
      if (deltaLeft === 0) return;
      panRef.current = panAfterSurfaceLeftShift(panRef.current, deltaLeft);
      applyViewToDomRef.current();
      setPan(panRef.current);
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

  useEffect(() => {
    const markCanvasUsed = () => {
      initialCanvasFocusPendingRef.current = false;
    };
    document.addEventListener("pointerdown", markCanvasUsed, true);
    document.addEventListener("keydown", markCanvasUsed, true);
    return () => {
      document.removeEventListener("pointerdown", markCanvasUsed, true);
      document.removeEventListener("keydown", markCanvasUsed, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (
      initialCanvasFocusAttemptedRef.current ||
      !editableScreenIds?.size ||
      interactMode ||
      interactScreenId
    ) {
      return;
    }
    initialCanvasFocusAttemptedRef.current = true;
    if (!initialCanvasFocusPendingRef.current) return;
    const surface = surfaceRef.current;
    const active = document.activeElement;
    if (
      !surface ||
      (active !== document.body && isEditableHotkeyTarget(active))
    ) {
      return;
    }
    surface.focus({ preventScroll: true });
  }, [editableScreenIds?.size, interactMode, interactScreenId]);

  const restoreInitialCanvasFocus = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      if (
        !initialCanvasFocusPendingRef.current ||
        interactMode ||
        interactScreenId
      ) {
        return;
      }
      const target = event.target;
      if (
        !(target instanceof HTMLIFrameElement) ||
        !surfaceRef.current?.contains(target) ||
        target.closest('[data-screen-interact-mode="true"]')
      ) {
        return;
      }
      surfaceRef.current.focus({ preventScroll: true });
    },
    [interactMode, interactScreenId],
  );

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

  const getFrameViewportSize = useCallback(
    (screen: ScreenFile): { width: number; height: number } => {
      const iframe = findCanvasIframeForScreen(
        surfaceRef.current,
        getActiveScreenIframeId(screen),
        boardFileId,
      );
      const metadata = getResolvedMetadata(screen);
      return {
        width: iframe?.clientWidth || metadata.width,
        height: iframe?.clientHeight || metadata.height,
      };
    },
    [boardFileId, getResolvedMetadata],
  );

  const resolveBoardSnapStepForFrame = useCallback(
    (frameId: string | null | undefined): number => {
      const grids = layoutGridsRef.current;
      if (!grids || !frameId) return WHOLE_PIXEL_SNAP_STEP;
      const contentStep = resolveLayoutGridSnapStep(grids, frameId);
      if (contentStep <= WHOLE_PIXEL_SNAP_STEP) return WHOLE_PIXEL_SNAP_STEP;
      const screen = screensRef.current.find((item) => item.id === frameId);
      const geometry = frameGeometryRef.current[frameId];
      if (!screen || !geometry?.width) return contentStep;
      const viewport = getFrameViewportSize(screen);
      const boardPerContentPx = geometry.width / Math.max(1, viewport.width);
      return contentStep * boardPerContentPx;
    },
    [getFrameViewportSize],
  );

  const canvasFrameEntryCacheRef = useRef<Map<string, CanvasFrameEntry>>(
    new Map(),
  );
  const screenContentCacheRef = useRef<Map<string, ScreenContentCacheEntry>>(
    new Map(),
  );
  useEffect(() => {
    pruneScreenContentCache(
      screenContentCacheRef.current,
      new Set(screens.map((screen) => screen.id)),
    );
  }, [screens]);

  useEffect(() => {
    onGeometryChangeRef.current = onGeometryChange;
  }, [onGeometryChange]);

  useEffect(() => {
    onGeometryCommitRef.current = onGeometryCommit;
  }, [onGeometryCommit]);

  useEffect(() => {
    onBreakpointContentHeightChangeRef.current =
      onBreakpointContentHeightChange;
  }, [onBreakpointContentHeightChange]);
  useEffect(() => {
    onPrimaryContentHeightChangeRef.current = onPrimaryContentHeightChange;
  }, [onPrimaryContentHeightChange]);
  useEffect(() => {
    onScreenContentNaturalHeightChangeRef.current =
      onScreenContentNaturalHeightChange;
  }, [onScreenContentNaturalHeightChange]);

  useEffect(() => {
    onNudgeSelectionRef.current = onNudgeSelection;
  }, [onNudgeSelection]);

  useEffect(() => {
    nudgeAmountsRef.current = nudgeAmounts;
  }, [nudgeAmounts]);

  useEffect(() => {
    layoutGridsRef.current = layoutGrids;
  }, [layoutGrids]);

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
      const next = updater(frameGeometryRef.current);
      frameGeometryRef.current = next;
      setFrameGeometry(next);
      onGeometryChangeRef.current?.(next);
    },
    [],
  );

  const updateFrameGeometryPreview = useCallback(
    (updater: (current: FrameGeometryById) => FrameGeometryById) => {
      const next = updater(frameGeometryRef.current);
      frameGeometryRef.current = next;
      setFrameGeometry(next);
    },
    [],
  );

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

  const selectCompletedDuplicates = useCallback(
    (results: Array<void | Promise<string | undefined>>) => {
      void Promise.all(results).then((ids) => {
        const duplicateIds = ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        );
        if (duplicateIds.length > 0) {
          updateSelectedIds(() => duplicateIds);
        }
      });
    },
    [updateSelectedIds],
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

  useLayoutEffect(() => {
    frameGeometryRef.current = frameGeometry;
  }, [frameGeometry]);

  useLayoutEffect(() => {
    for (const [id, position] of liveFrameDragPositionsRef.current) {
      const frame = surfaceRef.current?.querySelector<HTMLElement>(
        `[data-frame-id="${CSS.escape(id)}"]`,
      );
      if (!frame) continue;
      frame.style.left = `${position.left}px`;
      frame.style.top = `${position.top}px`;
    }
    const position = liveFrameDragSelectionPositionRef.current;
    if (!position) return;
    const selectionBox = surfaceRef.current?.querySelector<HTMLElement>(
      "[data-frame-selection-box]",
    );
    if (!selectionBox) return;
    selectionBox.style.left = `${position.left}px`;
    selectionBox.style.top = `${position.top}px`;
  });

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  const propSyncedSelectionRef = useRef<string[] | null>(
    selectedScreenIds ? selectedIds : null,
  );
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
    const previousZoom = zoomRef.current;
    const pendingCameraZoom = lastCameraCommandZoomRef.current;
    const pendingCameraControlledZoom =
      lastCameraCommandControlledZoomRef.current;
    if (pendingCameraZoom !== null && zoom === pendingCameraZoom) {
      lastCameraCommandZoomRef.current = null;
      lastCameraCommandControlledZoomRef.current = null;
      if (zoom === previousZoom) return;
      setCanvasZoom(zoom);
      zoomRef.current = zoom;
      lastReportedZoomRef.current = zoom;
      recomputePenPointerForViewChangeRef.current();
      return;
    }
    if (
      pendingCameraZoom !== null &&
      cameraCommand &&
      lastCameraCommandNonceRef.current === cameraCommand.nonce &&
      zoom === pendingCameraControlledZoom
    ) {
      return;
    }
    if (pendingCameraZoom !== null) {
      lastCameraCommandZoomRef.current = null;
      lastCameraCommandControlledZoomRef.current = null;
    }
    if (zoom === previousZoom) return;
    const referenceId =
      (activeId && renderedScreens.some((screen) => screen.id === activeId)
        ? activeId
        : undefined) ??
      selectedIds[0] ??
      renderedScreens[0]?.id;
    const rect = surfaceRef.current?.getBoundingClientRect();
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
    const frameCenter = activeGeometry
      ? canvasToScreenPoint(
          {
            x: activeGeometry.x + activeGeometry.width / 2,
            y: activeGeometry.y + activeGeometry.height / 2,
          },
          { x: panRef.current.x, y: panRef.current.y, zoom: previousZoom },
          { x: 0, y: 0 },
          SURFACE_PADDING,
        )
      : null;
    const cursor = resolveExternalZoomAnchor({
      frameCenter,
      surfaceSize: { width: rect?.width ?? 0, height: rect?.height ?? 0 },
    });
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
    lastReportedZoomRef.current = zoom;
    recomputePenPointerForViewChangeRef.current();
  }, [
    activeId,
    cameraCommand,
    recomputePenPointerForViewChangeRef,
    renderedScreens,
    selectedIds,
    zoom,
  ]);

  useLayoutEffect(() => {
    const selectableIds = new Set(selectableScreens.map((screen) => screen.id));
    const { next, changed, shouldNotifyParent } = resolveFrameGeometrySync({
      screens: screens.map((screen) => ({
        id: screen.id,
        metadata: getResolvedMetadata(screen),
        breakpointWidths: screen.breakpointWidths,
        layoutGroupId: screen.layoutGroupId,
      })),
      currentGeometryById: frameGeometryRef.current,
      persistedGeometryById: geometryById,
      geometryOverridesById,
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
      const next = current.filter((id) => selectableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [
    geometryById,
    geometryOverridesById,
    getResolvedMetadata,
    screens,
    selectableScreens,
    updateFrameGeometry,
    updateFrameGeometryRefOnly,
    updateSelectedIds,
  ]);

  useLayoutEffect(() => {
    renderedScreenIdsRef.current = new Set(screens.map((screen) => screen.id));
  }, [screens]);

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
    const selectableIds = new Set(selectableScreens.map((screen) => screen.id));
    const nextSelection = selectedScreenIds.filter((id) =>
      selectableIds.has(id),
    );
    propSyncedSelectionRef.current = nextSelection;
    updateSelectedIds(() => nextSelection);
  }, [selectableScreens, selectedScreenIds, updateSelectedIds]);

  useEffect(() => {
    if (
      selectAllRequest === undefined ||
      selectAllRequest === handledSelectAllRequestRef.current
    ) {
      return;
    }
    handledSelectAllRequestRef.current = selectAllRequest;
    updateSelectedDraftIds(() => []);
    updateSelectedIds(() => selectableScreens.map((screen) => screen.id));
  }, [
    selectAllRequest,
    selectableScreens,
    updateSelectedDraftIds,
    updateSelectedIds,
  ]);

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

  useEffect(() => {
    if (
      !suppressLineupRecenter ||
      lastSuppressLineupRecenterNonceRef.current ===
        suppressLineupRecenter.nonce
    ) {
      return;
    }
    lastSuppressLineupRecenterNonceRef.current = suppressLineupRecenter.nonce;
    lineupRecenterSuppressRef.current = {
      atMs: Date.now(),
      fromCount: suppressLineupRecenter.fromCount,
      addedCount: suppressLineupRecenter.addedCount,
    };
  }, [suppressLineupRecenter]);

  useEffect(() => {
    if (preserveCameraOnScreenCountChange) return;
    const deviceFrameChanged =
      lineupRecenterDeviceFrameRef.current !== previewDeviceFrame;
    lineupRecenterDeviceFrameRef.current = previewDeviceFrame;
    const previousCount = lineupRecenterPrevCountRef.current;
    lineupRecenterPrevCountRef.current = screens.length;
    if (
      isLineupShrinkOnlyChange({
        previousCount,
        screenCount: screens.length,
        deviceFrameChanged,
      })
    ) {
      return;
    }
    const lastAutoFitCamera = lineupRecenterCameraRef.current;
    if (
      !deviceFrameChanged &&
      previousCount !== null &&
      screens.length > previousCount &&
      (lastAutoFitCamera.x !== panRef.current.x ||
        lastAutoFitCamera.y !== panRef.current.y ||
        lastAutoFitCamera.zoom !== zoomRef.current)
    ) {
      return;
    }
    if (
      shouldDeferLineupRecenterToCameraCommand({
        cameraCommandNonce: cameraCommand?.nonce,
        lastHandledCameraCommandNonce: lastCameraCommandNonceRef.current,
      })
    ) {
      return;
    }
    const armed = lineupRecenterSuppressRef.current;
    if (
      shouldSuppressLineupRecenter({
        armed,
        nowMs: Date.now(),
        screenCount: screens.length,
        deviceFrameChanged,
      })
    ) {
      if (armed && screens.length >= armed.fromCount + armed.addedCount) {
        lineupRecenterSuppressRef.current = null;
      }
      return;
    }
    if (
      !surfaceRef.current ||
      (renderedScreens.length === 0 && !boardSurfaceContentBounds)
    ) {
      return;
    }
    const rect = surfaceRef.current.getBoundingClientRect();
    const scale = zoomRef.current / 100;
    const frames = renderedScreens.map((screen) => {
      const metadata = getResolvedMetadata(screen);
      const currentGeometry =
        frameGeometryRef.current[screen.id] ??
        getInitialFrameGeometry(screenIndexById.get(screen.id) ?? 0, metadata);
      return getPreviewDeviceFrameGeometry({
        currentGeometry,
        metadata,
        previewDeviceFrame,
      });
    });
    const bounds = getFrameGroupBounds(
      frames
        .map((geometry, index) => ({
          id: renderedScreens[index]?.id ?? String(index),
          geometry,
        }))
        .concat(
          renderedScreens.length === 0 && boardSurfaceContentBounds
            ? [
                {
                  id: boardFileId ?? "__board__",
                  geometry: boardSurfaceContentBounds,
                },
              ]
            : [],
        ),
    );
    const totalWidth = bounds?.width ?? SCREEN_WIDTH;
    const totalHeight = bounds?.height ?? SCREEN_CARD_HEIGHT;
    const boundsLeft = bounds?.left ?? 0;
    const boundsTop = bounds?.top ?? 0;
    const minFitScale = AUTOFIT_MIN_ZOOM / 100;
    const availableWidth = Math.max(
      0,
      rect.width - chromeInsetLeft - chromeInsetRight,
    );
    const widthFitScale =
      renderedScreens.length > 1 && totalWidth > 0
        ? Math.max(minFitScale, (availableWidth - 180) / totalWidth)
        : scale;
    const heightFitScale =
      totalHeight > 0
        ? Math.max(minFitScale, (rect.height - 96) / totalHeight)
        : scale;
    const nextScale = deferLineupZoomChange
      ? scale
      : Math.min(scale, widthFitScale, heightFitScale);
    if (!deferLineupZoomChange && nextScale < scale) {
      const nextZoom = nextScale * 100;
      zoomRef.current = nextZoom;
      setCanvasZoom(nextZoom);
      lastReportedZoomRef.current = nextZoom;
      onZoomChange?.(nextZoom);
    }
    const visualLeft =
      chromeInsetLeft + (availableWidth - totalWidth * nextScale) / 2;
    const visualTop = (rect.height - totalHeight * nextScale) / 2;
    const nextPan = {
      x: visualLeft - (SURFACE_PADDING + boundsLeft) * nextScale,
      y: visualTop - (SURFACE_PADDING + boundsTop) * nextScale,
    };
    panRef.current = nextPan;
    setPan(nextPan);
    lineupRecenterCameraRef.current = {
      x: nextPan.x,
      y: nextPan.y,
      zoom: zoomRef.current,
    };
    // Only on mount, screen-count or chrome-inset changes, or device-preview changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chromeInsetLeft,
    chromeInsetRight,
    preserveCameraOnScreenCountChange,
    deferLineupZoomChange,
    previewDeviceFrame,
    screens.length,
  ]);

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
      setWheelCameraGestureActive(false);
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

  const readVisibleCanvasRect = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const left = rect.left + Math.min(rect.width, Math.max(0, chromeInsetLeft));
    const right =
      rect.right - Math.min(rect.width, Math.max(0, chromeInsetRight));
    if (right <= left) return null;
    const topLeft = getCanvasPoint(left, rect.top);
    const bottomRight = getCanvasPoint(right, rect.bottom);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }, [chromeInsetLeft, chromeInsetRight, getCanvasPoint]);
  if (visibleCanvasRectRef) {
    visibleCanvasRectRef.current = readVisibleCanvasRect;
  }

  const getCurrentFrameEntries = useCallback(
    () =>
      renderedScreens.map((screen) => {
        const metadata = getResolvedMetadata(screen);
        return {
          id: screen.id,
          geometry:
            frameGeometryRef.current[screen.id] ??
            getInitialFrameGeometry(
              screenIndexById.get(screen.id) ?? 0,
              metadata,
            ),
        };
      }),
    [getResolvedMetadata, renderedScreens, screenIndexById],
  );

  const getSelectableFrameEntries = useCallback(
    () =>
      getCurrentFrameEntries()
        .filter((entry) => !lockedScreenIdSet.has(entry.id))
        // Hit-testing (drop targets, marquee) must agree with what's on
        // screen, not the persisted geometry: content-fit auto-height (see
        // canvasFrames) renders a screen's card taller than its saved
        // geometry until the user resizes it, so a pointer visually over the
        // card would otherwise miss every frame here. Mirrors the same
        // rendered-geometry override beginResize applies to its origin rects.
        .map((entry) => ({
          ...entry,
          geometry:
            renderedFrameGeometryRef.current[entry.id] ?? entry.geometry,
        })),
    [getCurrentFrameEntries, lockedScreenIdSet],
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

  const snapViewportRef = useRef<OverscannedViewportBounds | null>(null);

  const beginSnapGesture = useCallback(() => {
    const size = surfaceSizeRef.current;
    snapViewportRef.current = size
      ? getOverscannedViewportCanvasBounds(
          size,
          panRef.current,
          zoomRef.current,
          0,
        )
      : null;
  }, []);

  const invalidateSnapGesture = useCallback(() => {
    snapViewportRef.current = null;
  }, []);

  const getSnapCandidateEntries = useCallback(
    (excludeIds: string[], entries = getCurrentCanvasEntries()) => {
      const viewport = snapViewportRef.current;
      return entries.filter(
        (entry) =>
          !excludeIds.includes(entry.id) &&
          (!viewport ||
            isFrameWithinOverscannedViewport(entry.geometry, viewport)),
      );
    },
    [getCurrentCanvasEntries],
  );

  const getFrameEntryAtPoint = useCallback(
    (point: Point, options?: { excludeId?: string }) =>
      findTopFrameEntryAtPoint(
        options?.excludeId
          ? getSelectableFrameEntries().filter(
              (entry) => entry.id !== options.excludeId,
            )
          : getSelectableFrameEntries(),
        point,
        {
          foregroundId: resolveHitTestForegroundId({
            selectedIds: selectedIdsRef.current,
            hasGeometry: (id) => frameGeometryRef.current[id] !== undefined,
            activeId,
            firstScreenId: screensRef.current[0]?.id,
          }),
        },
      ),
    [activeId, getSelectableFrameEntries],
  );

  const frameGeometryCenter = useCallback(
    (geometry: FrameGeometry | undefined): Point => ({
      x: (geometry?.x ?? 0) + (geometry?.width ?? 0) / 2,
      y: (geometry?.y ?? 0) + (geometry?.height ?? 0) / 2,
    }),
    [],
  );

  const resolveSnapStepForTargets = useCallback(
    (targetIds: readonly string[], center: Point): number => {
      if (!layoutGridsRef.current) return WHOLE_PIXEL_SNAP_STEP;
      const movesAFrame = targetIds.some(
        (targetId) => frameGeometryRef.current[targetId] !== undefined,
      );
      if (movesAFrame) return WHOLE_PIXEL_SNAP_STEP;
      return resolveBoardSnapStepForFrame(
        getFrameEntryAtPoint(center)?.id ?? null,
      );
    },
    [getFrameEntryAtPoint, resolveBoardSnapStepForFrame],
  );

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

  useEffect(() => {
    canvasMountedRef.current = true;
    return () => {
      canvasMountedRef.current = false;
    };
  }, []);

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
      const targetIframe = findCanvasIframeForScreen(
        surfaceRef.current,
        iframeId,
        boardFileId,
      );
      targetIframe?.contentWindow?.postMessage(
        { type: "agent-native:hit-test-preview-clear" },
        "*",
      );
    };

    const clearCrossScreenPreviewGuide = (targetId?: string | null) => {
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

    const postCrossScreenClaim = (sourceScreenId: string, claimed: boolean) => {
      const sourceScreen = screensRef.current.find(
        (item) => item.id === sourceScreenId,
      );
      const iframeId = sourceScreen
        ? getActiveScreenIframeId(sourceScreen)
        : sourceScreenId;
      findCanvasIframeForScreen(
        surfaceRef.current,
        iframeId,
        boardFileId,
      )?.contentWindow?.postMessage(
        { type: "agent-native:cross-screen-claim", claimed },
        "*",
      );
    };

    const clearCrossScreenDrag = (options?: { keepBoardMounted?: boolean }) => {
      crossScreenPreviewGenerationRef.current += 1;
      stopParentCrossScreenDrag();
      crossScreenIgnoreAutoLayoutRef.current = false;
      crossScreenControlPressedRef.current = false;
      clearCrossScreenPreviewGuide();
      const previousClaim = crossScreenClaimSentRef.current;
      if (previousClaim?.claimed) {
        postCrossScreenClaim(previousClaim.sourceScreenId, false);
      }
      crossScreenClaimSentRef.current = null;
      crossScreenProxyTraceRef.current = null;
      crossScreenResolveTraceRef.current = null;
      setCrossScreenGhost(null);
      setCrossScreenTarget(null);
      clearCrossScreenDropGuide();
      crossScreenTargetRef.current = null;
      crossScreenDragMsgRef.current = null;
      crossScreenSourceFrameAtStartRef.current = null;
      if (!options?.keepBoardMounted) {
        finishBoardCrossScreenDrop();
        setCrossScreenDragActive(false);
      }
      crossScreenLastBoardPointRef.current = null;
      crossScreenLastHitResultRef.current.clear();
    };

    const getTargetViewportMetadata = (
      targetScreen: (typeof screensRef.current)[number],
      targetIframe: HTMLIFrameElement | null | undefined,
    ): { width: number; height: number } =>
      targetIframe?.clientWidth && targetIframe.clientHeight
        ? { width: targetIframe.clientWidth, height: targetIframe.clientHeight }
        : getFrameViewportSize(targetScreen);

    const runHitTest = (
      candidate: CrossScreenDragTarget,
      boardPoint: Point,
      options: {
        preview?: boolean;
        timeoutMs?: number;
        previewGeneration?: number;
        previewRequestSeq?: number;
        sourceElementSize?: { width: number; height: number };
        modifiers?: {
          metaKey?: boolean;
          ctrlKey?: boolean;
          ignoreAutoLayout?: boolean;
          forceNestedAutoLayout?: boolean;
        };
      } = {},
    ): Promise<CrossScreenHitTestResult> => {
      const targetScreen = screensRef.current.find(
        (s) => s.id === candidate.id,
      );
      const targetIsBoard = candidate.id === boardFileId;
      if (!targetScreen && !targetIsBoard) return Promise.resolve({});
      if (targetIsBoard && !boardSurfaceRenderGeometry) {
        return Promise.resolve({});
      }
      const targetIframe = targetIsBoard
        ? findCanvasIframeForScreen(
            surfaceRef.current,
            candidate.id,
            boardFileId,
          )
        : surfaceRef.current?.querySelector<HTMLIFrameElement>(
            `[data-screen-iframe-id="${CSS.escape(
              getActiveScreenIframeId(targetScreen!),
            )}"]`,
          );
      const targetContentWindow = targetIframe?.contentWindow;
      if (!targetContentWindow) return Promise.resolve({});
      const localPoint =
        targetIsBoard && boardSurfaceRenderGeometry
          ? boardPointToBoardSurfaceLocalPoint(
              boardPoint,
              boardSurfaceRenderGeometry,
            )
          : (() => {
              const {
                width: targetViewportWidth,
                height: targetViewportHeight,
              } = getTargetViewportMetadata(targetScreen!, targetIframe);
              return boardPointToScreenLocalPoint(
                boardPoint,
                candidate.geometry,
                {
                  width: targetViewportWidth,
                  height: targetViewportHeight,
                },
              );
            })();

      const correlationId = `hit-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const modifiers = {
        ...options.modifiers,
        ignoreAutoLayout:
          options.modifiers?.ignoreAutoLayout === true ||
          crossScreenIgnoreAutoLayoutRef.current,
      };

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", hitListener);
          resolve(
            options.preview &&
              crossScreenLastHitResultRef.current.get(candidate.id)
                ?.generation === crossScreenPreviewGenerationRef.current
              ? (crossScreenLastHitResultRef.current.get(candidate.id)
                  ?.result ?? {})
              : {},
          );
        }, options.timeoutMs ?? HIT_TEST_PREVIEW_TIMEOUT_MS);

        const hitListener = (ev: MessageEvent) => {
          if (
            !ev.data ||
            ev.data.type !== "agent-native:hit-test-result" ||
            ev.data.correlationId !== correlationId ||
            ev.source !== targetContentWindow
          ) {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener("message", hitListener);
          const result: CrossScreenHitTestResult = {
            targetAnchorProvenance: readSourceNodeProvenance(
              ev.data.targetAnchorProvenance,
            ),
            anchorNodeId:
              typeof ev.data.anchorNodeId === "string"
                ? ev.data.anchorNodeId
                : undefined,
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
          if (
            options.preview &&
            options.previewGeneration ===
              crossScreenPreviewGenerationRef.current &&
            options.previewRequestSeq !== undefined
          ) {
            const previous = crossScreenLastHitResultRef.current.get(
              candidate.id,
            );
            if (!previous || options.previewRequestSeq > previous.requestSeq) {
              crossScreenLastHitResultRef.current.set(candidate.id, {
                generation: options.previewGeneration,
                requestSeq: options.previewRequestSeq,
                result,
              });
            }
          }
          resolve(result);
        };
        window.addEventListener("message", hitListener);

        targetContentWindow.postMessage(
          {
            type: "agent-native:hit-test",
            correlationId,
            x: localPoint.x,
            y: localPoint.y,
            preview: options.preview === true,
            sourceElementSize: options.sourceElementSize,
            modifiers,
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
      return boardPointToScreenLocalPoint(boardPoint, candidate.geometry, {
        width: targetViewportWidth,
        height: targetViewportHeight,
      });
    };

    const requestCrossScreenDropGuide = (
      candidate: CrossScreenDragTarget,
      boardPoint: Point,
    ) => {
      const previewGeneration = crossScreenPreviewGenerationRef.current;
      const requestSeq = ++crossScreenHitTestSeqRef.current;
      void runHitTest(candidate, boardPoint, {
        preview: true,
        previewGeneration,
        previewRequestSeq: requestSeq,
        sourceElementSize: crossScreenDragMsgRef.current?.sourceElementSize,
        modifiers: crossScreenDragMsgRef.current?.modifiers,
      }).then((hit) => {
        if (crossScreenPreviewGenerationRef.current !== previewGeneration) {
          return;
        }
        if (crossScreenHitTestSeqRef.current !== requestSeq) return;
        if (crossScreenTargetRef.current?.id !== candidate.id) return;
        const targetScreen = screensRef.current.find(
          (s) => s.id === candidate.id,
        );
        const targetIsBoard = candidate.id === boardFileId;
        const targetIframe = targetScreen
          ? surfaceRef.current?.querySelector<HTMLIFrameElement>(
              `[data-screen-iframe-id="${CSS.escape(
                getActiveScreenIframeId(targetScreen),
              )}"]`,
            )
          : targetIsBoard
            ? findCanvasIframeForScreen(
                surfaceRef.current,
                candidate.id,
                boardFileId,
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
          : targetIsBoard && boardSurfaceRenderGeometry
            ? getCrossScreenDropGuideForHitTest({
                hit,
                targetGeometry: boardSurfaceRenderGeometry,
                targetMetadata: {
                  width:
                    targetIframe?.clientWidth ||
                    boardSurfaceRenderGeometry.width,
                  height:
                    targetIframe?.clientHeight ||
                    boardSurfaceRenderGeometry.height,
                },
              })
            : null;
        setCrossScreenDropGuide(guide);
      });
    };

    const boardPointFromDragMessage = (
      sourceScreenId: string,
      iframeX: number,
      iframeY: number,
      viewportW: number,
      viewportH: number,
    ): Point | null => {
      if (sourceScreenId === boardFileId) {
        if (!boardSurfaceRenderGeometry) return null;
        return boardSurfaceLocalPointToBoardPoint(
          { x: iframeX, y: iframeY },
          boardSurfaceRenderGeometry,
        );
      }
      const sourceScreen = screensRef.current.find(
        (s) => s.id === sourceScreenId,
      );
      const sourceGeometry =
        renderedFrameGeometryRef.current[sourceScreenId] ??
        frameGeometryRef.current[sourceScreenId];
      if (!sourceScreen || !sourceGeometry) return null;
      return screenLocalPointToBoardPoint(
        { x: iframeX, y: iframeY },
        sourceGeometry,
        { width: viewportW, height: viewportH },
      );
    };

    const sourceContentScale = (sourceScreenId: string): number => {
      if (sourceScreenId === boardFileId) return 1;
      const geometry = frameGeometryRef.current[sourceScreenId];
      const sourceScreen = screensRef.current.find(
        (item) => item.id === sourceScreenId,
      );
      const iframeId = sourceScreen
        ? getActiveScreenIframeId(sourceScreen)
        : sourceScreenId;
      const iframe = surfaceRef.current?.querySelector<HTMLIFrameElement>(
        `[data-screen-iframe-id="${CSS.escape(iframeId)}"]`,
      );
      const viewportWidth = iframe?.clientWidth || geometry?.width || 0;
      if (!geometry || viewportWidth <= 0) return 1;
      return geometry.width / viewportWidth;
    };

    const buildCrossScreenGhost = (
      boardPoint: Point,
      sourceScreenId: string,
    ): CrossScreenDragGhost | null => {
      const payload = crossScreenDragMsgRef.current;
      const size = payload?.sourceElementSize;
      const grab = payload?.sourcePointerOffset;
      if (!size || !grab) {
        traceOnce(
          crossScreenProxyTraceRef,
          "drag",
          "proxy-sizeless",
          `source=${sourceScreenId} — no size to draw`,
        );
        return sourceScreenId === boardFileId
          ? null
          : { boardX: boardPoint.x, boardY: boardPoint.y };
      }
      const scale = sourceContentScale(sourceScreenId);
      traceOnce(
        crossScreenProxyTraceRef,
        "drag",
        "proxy",
        `source=${sourceScreenId} size=${Math.round(size.width)}x${Math.round(size.height)}` +
          ` grab=${Math.round(grab.x)},${Math.round(grab.y)} scale=${scale.toFixed(3)}`,
      );
      const fill = payload?.styleSnapshot?.nodes?.[0]?.styles;
      return {
        boardX: boardPoint.x - grab.x * scale,
        boardY: boardPoint.y - grab.y * scale,
        width: size.width * scale,
        height: size.height * scale,
        dimmed: true,
        background: cssColorValue(fill?.backgroundColor),
        borderRadius: cssLengthValue(fill?.borderRadius),
      };
    };

    const claimCrossScreenDrop = (sourceScreenId: string, claimed: boolean) => {
      const previousClaim = crossScreenClaimSentRef.current;
      if (
        previousClaim?.sourceScreenId === sourceScreenId &&
        previousClaim.claimed === claimed
      ) {
        return;
      }
      crossScreenClaimSentRef.current = { sourceScreenId, claimed };
      postCrossScreenClaim(sourceScreenId, claimed);
    };

    const isPointerInsideCrossScreenSource = (
      sourceScreenId: string,
      iframeX: number,
      iframeY: number,
      viewportW: number,
      viewportH: number,
    ) => {
      const atStart = crossScreenSourceFrameAtStartRef.current;
      if (atStart?.screenId === sourceScreenId) {
        return isPointerInsideSourceIframe({
          iframeX,
          iframeY,
          viewportW: atStart.viewportW,
          viewportH: atStart.viewportH,
          frameWidth: atStart.width,
          frameHeight: atStart.height,
        });
      }
      return isPointerInsideSourceIframe({
        iframeX,
        iframeY,
        viewportW,
        viewportH,
        frameWidth:
          renderedFrameGeometryRef.current[sourceScreenId]?.width ??
          frameGeometryRef.current[sourceScreenId]?.width,
        frameHeight:
          renderedFrameGeometryRef.current[sourceScreenId]?.height ??
          frameGeometryRef.current[sourceScreenId]?.height,
      });
    };

    const updateCrossScreenTargetFromBoardPoint = (
      boardPoint: Point,
      sourceScreenId: string,
    ) => {
      crossScreenLastBoardPointRef.current = boardPoint;
      const target = getFrameEntryAtPoint(boardPoint, {
        excludeId: sourceScreenId,
      });
      traceOnce(
        crossScreenResolveTraceRef,
        "drop",
        "resolve-target",
        `pointer=${Math.round(boardPoint.x)},${Math.round(boardPoint.y)}` +
          ` hit=${target?.id?.slice(0, 6) ?? "NONE"}` +
          ` source=${sourceScreenId.slice(0, 6)}` +
          ` verdict=${
            !target
              ? "no-frame-under-pointer"
              : target.id === sourceScreenId
                ? "source-frame-so-no-cross-screen-move"
                : "will-drop-into-that-frame"
          }`,
      );
      if (target && target.id !== sourceScreenId) {
        const nextTarget = { id: target.id, geometry: target.geometry };
        if (crossScreenTargetRef.current?.id !== nextTarget.id) {
          clearCrossScreenPreviewGuide();
        }
        crossScreenTargetRef.current = nextTarget;
        setCrossScreenTarget(nextTarget);
        claimCrossScreenDrop(sourceScreenId, nextTarget.id !== sourceScreenId);
        setCrossScreenGhost(buildCrossScreenGhost(boardPoint, sourceScreenId));
        requestCrossScreenDropGuide(nextTarget, boardPoint);
      } else if (
        sourceScreenId !== boardFileId &&
        boardFileId &&
        boardFrameGeometry &&
        boardSurfaceRenderGeometry &&
        geometryContainsPoint(boardSurfaceRenderGeometry, boardPoint)
      ) {
        const nextTarget = { id: boardFileId, geometry: boardFrameGeometry };
        if (crossScreenTargetRef.current?.id !== boardFileId) {
          clearCrossScreenPreviewGuide();
        }
        crossScreenTargetRef.current = nextTarget;
        setCrossScreenTarget(nextTarget);
        claimCrossScreenDrop(sourceScreenId, nextTarget.id !== sourceScreenId);
        setCrossScreenGhost(buildCrossScreenGhost(boardPoint, sourceScreenId));
        requestCrossScreenDropGuide(nextTarget, boardPoint);
      } else {
        clearCrossScreenPreviewGuide();
        crossScreenTargetRef.current = null;
        setCrossScreenTarget(null);
        claimCrossScreenDrop(sourceScreenId, false);
        setCrossScreenGhost(buildCrossScreenGhost(boardPoint, sourceScreenId));
        clearCrossScreenDropGuide();
      }
    };

    const finalizeCrossScreenDrop = (
      sourceScreenId: string,
      candidate: CrossScreenDragTarget | null,
      payload: {
        selector: string;
        sourceId?: string;
        sourceDeleteRequestId?: string;
        sourceProvenance?: SourceNodeProvenance;
        sourcePointerOffset?: Point;
        sourceElementSize?: { width: number; height: number };
        sourceComputedSize?: { width?: number; height?: number };
        modifiers?: {
          metaKey?: boolean;
          ctrlKey?: boolean;
          ignoreAutoLayout?: boolean;
          forceNestedAutoLayout?: boolean;
        };
        sourceHtmlSnapshot?: string;
        duplicate?: boolean;
        sourceCloneHtml?: string;
        styleSnapshot?: PortableStyleSnapshot;
        styleSnapshotCaptureFailed?: boolean;
      },
      lastBoardPoint: Point | null,
      releasedAt?: number,
    ) => {
      dndHostLog("overview:finalize", {
        sourceScreenId,
        candidate: candidate?.id ?? null,
        lastBoardPoint,
        selector: payload.selector,
      });
      const sKeyTimes = crossScreenSKeyTimesRef.current;
      const ignoreAutoLayoutAtRelease =
        isCrossScreenIgnoreAutoLayoutHeldAtRelease(
          releasedAt,
          sKeyTimes,
          payload.modifiers?.ignoreAutoLayout === true,
        );
      payload.modifiers = {
        ...payload.modifiers,
        ignoreAutoLayout: ignoreAutoLayoutAtRelease,
      };
      crossScreenEndSeenRef.current = true;
      const dropSeq = crossScreenDropSeqRef.current;
      const isCurrentDrop = () =>
        canvasMountedRef.current && crossScreenDropSeqRef.current === dropSeq;
      crossScreenLastBoardPointRef.current = null;
      const hasIdentifier = !!(payload.selector || payload.sourceId);
      const sourceDeleteCandidates = [
        payload.selector,
        payload.sourceId
          ? `[data-agent-native-node-id="${CSS.escape(payload.sourceId)}"]`
          : "",
      ].filter(Boolean);
      const cancelPendingSourceDelete = () => {
        if (!payload.sourceDeleteRequestId) return;
        sendLinkedScreenPreviewCancelPendingDelete(sourceScreenId, {
          selector: payload.selector,
          selectorCandidates: sourceDeleteCandidates,
          requestId: payload.sourceDeleteRequestId,
        });
      };
      if (!hasIdentifier || !sourceScreenId) {
        cancelPendingSourceDelete();
        clearCrossScreenDrag();
        return;
      }
      if (!lastBoardPoint) {
        cancelPendingSourceDelete();
        clearCrossScreenDrag();
        return;
      }
      const sourceFrameGeometry = frameGeometryRef.current?.[sourceScreenId];
      const droppedInsideSourceScreen =
        !candidate &&
        !!sourceFrameGeometry &&
        lastBoardPoint.x >= sourceFrameGeometry.x &&
        lastBoardPoint.x <= sourceFrameGeometry.x + sourceFrameGeometry.width &&
        lastBoardPoint.y >= sourceFrameGeometry.y &&
        lastBoardPoint.y <= sourceFrameGeometry.y + sourceFrameGeometry.height;
      if (droppedInsideSourceScreen) {
        cancelPendingSourceDelete();
        clearCrossScreenDrag();
        return;
      }
      trace("drop", "finalize", {
        candidate: candidate?.id ?? null,
        sourceScreen: sourceScreenId,
        droppedInsideSourceScreen,
        outcome: droppedInsideSourceScreen
          ? "discarded — pointer never left the source screen"
          : candidate
            ? "moving into candidate"
            : "no candidate — refused unless over the board surface",
      });
      const boardSurfaceHit =
        !!boardFileId &&
        sourceScreenId !== boardFileId &&
        !!boardFrameGeometry &&
        !!boardSurfaceRenderGeometry &&
        geometryContainsPoint(boardSurfaceRenderGeometry, lastBoardPoint);
      const targetCandidate =
        candidate ??
        (boardSurfaceHit && boardFileId && boardFrameGeometry
          ? { id: boardFileId, geometry: boardFrameGeometry }
          : null);
      if (!targetCandidate) {
        trace("drop", "refused", {
          reason: "no screen under the pointer and not over the board surface",
          sourceScreen: sourceScreenId,
          lastBoardPoint,
        });
        cancelPendingSourceDelete();
        clearCrossScreenDrag();
        return;
      }
      crossScreenHostCommittedRef.current = true;
      if (targetCandidate.id === boardFileId) {
        boardCrossScreenDropTransactionRef.current = null;
        boardCrossScreenDropPendingRef.current = true;
        boardCrossScreenDropTimeoutTransactionRef.current = null;
        if (boardCrossScreenDropTimeoutRef.current !== null) {
          window.clearTimeout(boardCrossScreenDropTimeoutRef.current);
        }
        const expireBoardCrossScreenDrop = () => {
          if (!boardCrossScreenDropPendingRef.current) return;
          crossScreenDropSeqRef.current += 1;
          const transactionId =
            boardCrossScreenDropTimeoutTransactionRef.current;
          if (
            transactionId &&
            boardCrossScreenDropTransactionRef.current === transactionId
          ) {
            onBoardRuntimeStructureInsertRejectedRef.current?.(
              "board-drop-timeout",
              transactionId,
            );
            return;
          }
          finishBoardCrossScreenDrop();
        };
        boardCrossScreenDropTimeoutRef.current = window.setTimeout(() => {
          expireBoardCrossScreenDrop();
        }, CROSS_SCREEN_INSERT_ACK_TIMEOUT_MS);
      }
      clearCrossScreenDrag({
        keepBoardMounted: targetCandidate.id === boardFileId,
      });

      if (targetCandidate.id === boardFileId) {
        void runHitTest(targetCandidate, lastBoardPoint, {
          timeoutMs: HIT_TEST_COMMIT_TIMEOUT_MS,
          sourceElementSize: payload.sourceElementSize,
          modifiers: payload.modifiers,
        }).then(
          ({
            anchorNodeId,
            targetAnchorProvenance,
            pendingNodeId,
            anchorSelector,
            placement,
            dropMode,
            anchorRect,
          }) => {
            if (!isCurrentDrop()) {
              cancelPendingSourceDelete();
              return;
            }
            const hasAnchor = Boolean(
              anchorNodeId || pendingNodeId || anchorSelector,
            );
            const transactionBeforeDrop =
              runtimeStructurePendingTransactionRef?.current ?? null;
            onCrossScreenElementDropRef.current?.({
              sourceSelector: payload.selector,
              sourceNodeId: payload.sourceId,
              sourceDeleteRequestId: payload.sourceDeleteRequestId,
              sourceProvenance: payload.sourceProvenance,
              targetAnchorProvenance,
              sourceScreenId,
              targetScreenId: targetCandidate.id,
              targetAnchorNodeId: anchorNodeId,
              targetAnchorPendingNodeId: pendingNodeId,
              targetAnchorSelector: anchorSelector,
              targetAnchorPlacement: placement,
              targetDropMode: dropMode,
              targetAnchorRect: anchorRect,
              targetCanvasPoint: lastBoardPoint,
              targetLocalPoint:
                hasAnchor && boardSurfaceRenderGeometry
                  ? boardPointToBoardSurfaceLocalPoint(
                      lastBoardPoint,
                      boardSurfaceRenderGeometry,
                    )
                  : lastBoardPoint,
              sourcePointerOffset: payload.sourcePointerOffset,
              sourceComputedSize: payload.sourceComputedSize,
              sourceHtmlSnapshot: payload.sourceHtmlSnapshot,
              duplicate: payload.duplicate,
              sourceCloneHtml: payload.sourceCloneHtml,
              styleSnapshot: payload.styleSnapshot,
              styleSnapshotCaptureFailed: payload.styleSnapshotCaptureFailed,
            });
            const transactionAfterDrop =
              runtimeStructurePendingTransactionRef?.current ?? null;
            if (
              transactionAfterDrop &&
              transactionAfterDrop !== transactionBeforeDrop
            ) {
              boardCrossScreenDropTransactionRef.current = transactionAfterDrop;
              boardCrossScreenDropTimeoutTransactionRef.current =
                transactionAfterDrop;
            } else {
              finishBoardCrossScreenDrop({
                preserveTransaction: transactionBeforeDrop !== null,
              });
              cancelPendingSourceDelete();
            }
          },
          () => cancelPendingSourceDelete(),
        );
        return;
      }

      void runHitTest(targetCandidate, lastBoardPoint, {
        timeoutMs: HIT_TEST_COMMIT_TIMEOUT_MS,
        sourceElementSize: payload.sourceElementSize,
        modifiers: payload.modifiers,
      }).then(
        ({
          anchorNodeId,
          targetAnchorProvenance,
          pendingNodeId,
          anchorSelector,
          placement,
          dropMode,
          anchorRect,
        }) => {
          if (!isCurrentDrop()) {
            cancelPendingSourceDelete();
            return;
          }
          const targetAnchorPlacement = isCrossScreenDropPlacement(placement)
            ? placement
            : undefined;
          const targetLocalPoint = getTargetLocalPoint(
            targetCandidate,
            lastBoardPoint,
          );
          const transactionBeforeDrop =
            runtimeStructurePendingTransactionRef?.current ?? null;
          onCrossScreenElementDropRef.current?.({
            sourceSelector: payload.selector,
            sourceNodeId: payload.sourceId,
            sourceDeleteRequestId: payload.sourceDeleteRequestId,
            sourceProvenance: payload.sourceProvenance,
            targetAnchorProvenance,
            sourceScreenId,
            targetScreenId: targetCandidate.id,
            targetAnchorNodeId: anchorNodeId,
            targetAnchorPendingNodeId: pendingNodeId,
            targetAnchorSelector: anchorSelector,
            targetAnchorPlacement,
            targetDropMode: dropMode,
            targetAnchorRect: anchorRect,
            targetCanvasPoint: lastBoardPoint,
            targetLocalPoint: targetLocalPoint ?? undefined,
            sourcePointerOffset: payload.sourcePointerOffset,
            sourceComputedSize: payload.sourceComputedSize,
            sourceHtmlSnapshot: payload.sourceHtmlSnapshot,
            duplicate: payload.duplicate,
            sourceCloneHtml: payload.sourceCloneHtml,
            styleSnapshot: payload.styleSnapshot,
            styleSnapshotCaptureFailed: payload.styleSnapshotCaptureFailed,
          });
          const transactionAfterDrop =
            runtimeStructurePendingTransactionRef?.current ?? null;
          if (
            !transactionAfterDrop ||
            transactionAfterDrop === transactionBeforeDrop
          ) {
            cancelPendingSourceDelete();
          }
        },
        () => cancelPendingSourceDelete(),
      );
    };

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== "agent-native:cross-screen-drag") {
        return;
      }
      const surfaceForSourceCheck = surfaceRef.current;
      const sourcePreviewIframe = surfaceForSourceCheck
        ? Array.from(
            surfaceForSourceCheck.querySelectorAll<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            ),
          ).find((iframe) => iframe.contentWindow === event.source)
        : undefined;
      if (!sourcePreviewIframe) return;
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
        sourceDeleteRequestId?: string;
        sourceProvenance?: unknown;
        iframeX?: number;
        iframeY?: number;
        viewportW?: number;
        viewportH?: number;
        elementRect?: CrossScreenDragElementRect;
        pointerOffset?: Point;
        modifiers?: {
          metaKey?: boolean;
          ctrlKey?: boolean;
          ignoreAutoLayout?: boolean;
          forceNestedAutoLayout?: boolean;
        };
        styleSnapshot?: unknown;
        styleSnapshotCaptureFailed?: boolean;
        sourceComputedSize?: { width?: number; height?: number };
        releasedAt?: number;
        duplicate?: boolean;
        sourceCloneHtml?: string;
      };
      const sourceProvenance = readSourceNodeProvenance(msg.sourceProvenance);
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
      const sourceComputedSize =
        msg.sourceComputedSize &&
        [msg.sourceComputedSize.width, msg.sourceComputedSize.height].some(
          (value) =>
            typeof value === "number" && Number.isFinite(value) && value >= 0,
        )
          ? {
              width:
                typeof msg.sourceComputedSize.width === "number" &&
                Number.isFinite(msg.sourceComputedSize.width) &&
                msg.sourceComputedSize.width >= 0
                  ? msg.sourceComputedSize.width
                  : undefined,
              height:
                typeof msg.sourceComputedSize.height === "number" &&
                Number.isFinite(msg.sourceComputedSize.height) &&
                msg.sourceComputedSize.height >= 0
                  ? msg.sourceComputedSize.height
                  : undefined,
            }
          : undefined;
      const sourceModifiers = msg.modifiers
        ? {
            metaKey: msg.modifiers.metaKey === true,
            ctrlKey: msg.modifiers.ctrlKey === true,
            ignoreAutoLayout:
              msg.modifiers.ignoreAutoLayout === true ||
              crossScreenIgnoreAutoLayoutRef.current,
            forceNestedAutoLayout: msg.modifiers.forceNestedAutoLayout === true,
          }
        : undefined;
      const styleSnapshot = isPortableStyleSnapshot(msg.styleSnapshot)
        ? msg.styleSnapshot
        : undefined;
      const styleSnapshotCaptureFailed =
        msg.styleSnapshotCaptureFailed === true;

      if (msg.phase === "cancel") {
        if (!crossScreenEndSeenRef.current) {
          crossScreenDropSeqRef.current += 1;
        }
        clearCrossScreenDrag({
          keepBoardMounted: boardCrossScreenDropPendingRef.current,
        });
        return;
      }

      const sourceScreenId =
        domScreenId &&
        (domScreenId === boardFileId || frameGeometryRef.current[domScreenId])
          ? domScreenId
          : activeId;
      if (!sourceScreenId) {
        clearCrossScreenDrag();
        return;
      }
      const sourceHtmlSnapshot =
        sourceScreenId === boardFileId
          ? captureCrossScreenSourceHtmlSnapshot(
              sourcePreviewIframe.contentDocument,
              msg.sourceId,
            )
          : undefined;
      const boardPointFromParentPointer = (
        iframeX: number,
        iframeY: number,
        viewportW: number,
        viewportH: number,
      ): Point | null => {
        if (sourceScreenId === boardFileId) return null;
        const iframeRect = sourcePreviewIframe.getBoundingClientRect();
        if (iframeRect.width <= 0 || iframeRect.height <= 0) return null;
        return getCanvasPoint(
          iframeRect.left +
            iframeX * (iframeRect.width / Math.max(1, viewportW)),
          iframeRect.top +
            iframeY * (iframeRect.height / Math.max(1, viewportH)),
        );
      };

      if (msg.phase !== "move") {
        dndHostLog("overview:cross-screen", {
          phase: msg.phase,
          source: sourceScreenId,
          selector: msg.selector,
        });
      }
      if (msg.phase === "start") {
        setCrossScreenDragActive(true);
        const startFrame =
          renderedFrameGeometryRef.current[sourceScreenId] ??
          frameGeometryRef.current[sourceScreenId];
        crossScreenSourceFrameAtStartRef.current =
          startFrame &&
          Number.isFinite(msg.viewportW) &&
          Number.isFinite(msg.viewportH)
            ? {
                screenId: sourceScreenId,
                width: startFrame.width,
                height: startFrame.height,
                viewportW: msg.viewportW!,
                viewportH: msg.viewportH!,
              }
            : null;
        crossScreenPreviewGenerationRef.current += 1;
        crossScreenDropSeqRef.current += 1;
        crossScreenEndSeenRef.current = false;
        crossScreenHostCommittedRef.current = false;
        crossScreenIgnoreAutoLayoutRef.current =
          crossScreenSKeyPressedRef.current;
        if (sourceModifiers?.ignoreAutoLayout === true) {
          crossScreenSKeyTimesRef.current = seedCrossScreenSKeyTimesAtStart(
            true,
            crossScreenSKeyTimesRef.current,
            performance.timeOrigin + performance.now(),
          );
        }
        if (!crossScreenSKeyPressedRef.current) {
          if (sourceModifiers?.ignoreAutoLayout !== true) {
            crossScreenSKeyTimesRef.current = { downAt: null, upAt: null };
          }
        }
        crossScreenLastBoardPointRef.current = null;
        crossScreenDragMsgRef.current = {
          selector: msg.selector ?? "",
          sourceId: msg.sourceId,
          sourceDeleteRequestId: msg.sourceDeleteRequestId,
          sourceProvenance,
          sourcePointerOffset,
          sourceElementSize,
          sourceComputedSize,
          modifiers: {
            ...sourceModifiers,
            ignoreAutoLayout:
              sourceModifiers?.ignoreAutoLayout === true ||
              crossScreenIgnoreAutoLayoutRef.current,
          },
          sourceHtmlSnapshot,
          duplicate: msg.duplicate === true,
          sourceCloneHtml:
            typeof msg.sourceCloneHtml === "string"
              ? msg.sourceCloneHtml
              : undefined,
          styleSnapshot,
          styleSnapshotCaptureFailed,
        };
        stopParentCrossScreenDrag();
        const restorePreviewPointerEvents = mutePreviewIframePointerEvents(
          surfaceRef.current,
          sourcePreviewIframe,
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
          cancelPendingParentDrag();
          activateParentDrag(ev);
          const candidate = crossScreenTargetRef.current;
          const payload = crossScreenDragMsgRef.current ?? {
            selector: msg.selector ?? "",
            sourceId: msg.sourceId,
            sourceDeleteRequestId: msg.sourceDeleteRequestId,
            sourceProvenance,
            sourcePointerOffset,
            sourceElementSize,
            sourceComputedSize,
            modifiers: sourceModifiers,
            sourceHtmlSnapshot,
            duplicate: msg.duplicate === true,
            sourceCloneHtml: msg.sourceCloneHtml,
            styleSnapshot,
            styleSnapshotCaptureFailed,
          };
          const lastBoardPoint = crossScreenLastBoardPointRef.current;
          const releasedAt = eventEpochMilliseconds(ev.timeStamp);
          finalizeCrossScreenDrop(
            sourceScreenId,
            candidate,
            payload,
            lastBoardPoint,
            releasedAt,
          );
          sourcePreviewIframe.contentWindow?.postMessage(
            { type: "agent-native:cancel-active-drag", pressedAt: releasedAt },
            "*",
          );
        };
        const handleParentWindowBlur = () => {
          cancelPendingParentDrag();
          if (
            shouldClearCrossScreenSKeyTimesOnWindowBlur(document.hasFocus())
          ) {
            crossScreenIgnoreAutoLayoutRef.current = false;
            crossScreenControlPressedRef.current = false;
            crossScreenSKeyTimesRef.current = { downAt: null, upAt: null };
          }
          clearCrossScreenDrag();
        };
        const hostUsesSForIgnoreAutoLayout = () => !isApplePlatform();
        const syncHostIgnoreAutoLayout = (
          pressed: boolean,
          eventTimeStamp: number,
        ) => {
          crossScreenIgnoreAutoLayoutRef.current = pressed;
          if (pressed) {
            crossScreenSKeyTimesRef.current = {
              downAt: eventEpochMilliseconds(eventTimeStamp),
              upAt: null,
            };
          } else {
            crossScreenSKeyTimesRef.current = {
              ...crossScreenSKeyTimesRef.current,
              upAt: eventEpochMilliseconds(eventTimeStamp),
            };
          }
        };
        const handleParentKeyDown = (ev: KeyboardEvent) => {
          if (isApplePlatform() && ev.key === "Control") {
            crossScreenControlPressedRef.current = true;
          }
          if (hostUsesSForIgnoreAutoLayout() && ev.key.toLowerCase() === "s") {
            syncHostIgnoreAutoLayout(true, ev.timeStamp);
            ev.preventDefault();
            return;
          }
          if (ev.key !== "Escape") return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          cancelPendingParentDrag();
          crossScreenDropSeqRef.current += 1;
          crossScreenEndSeenRef.current = true;
          sourcePreviewIframe.contentWindow?.postMessage(
            {
              type: "agent-native:cancel-active-drag",
              pressedAt: eventEpochMilliseconds(ev.timeStamp),
            },
            "*",
          );
          clearCrossScreenDrag();
        };
        const handleParentKeyUp = (ev: KeyboardEvent) => {
          if (isApplePlatform() && ev.key === "Control") {
            crossScreenControlPressedRef.current = false;
          }
          if (hostUsesSForIgnoreAutoLayout() && ev.key.toLowerCase() === "s") {
            syncHostIgnoreAutoLayout(false, ev.timeStamp);
            ev.preventDefault();
          }
        };
        const cleanup = () => {
          if (didCleanup) return;
          didCleanup = true;
          cancelPendingParentDrag();
          window.removeEventListener("mousemove", handleParentMouseMove, true);
          window.removeEventListener("mouseup", handleParentMouseUp, true);
          window.removeEventListener("blur", handleParentWindowBlur, true);
          window.removeEventListener("keydown", handleParentKeyDown, true);
          window.removeEventListener("keyup", handleParentKeyUp, true);
          crossScreenControlPressedRef.current = false;
          restorePreviewPointerEvents();
          if (crossScreenParentDragCleanupRef.current === cleanup) {
            crossScreenParentDragCleanupRef.current = null;
          }
        };
        crossScreenParentDragCleanupRef.current = cleanup;
        window.addEventListener("mousemove", handleParentMouseMove, true);
        window.addEventListener("mouseup", handleParentMouseUp, true);
        window.addEventListener("blur", handleParentWindowBlur, true);
        window.addEventListener("keydown", handleParentKeyDown, true);
        window.addEventListener("keyup", handleParentKeyUp, true);
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

        const localPointerInside = isPointerInsideCrossScreenSource(
          sourceScreenId,
          iframeX,
          iframeY,
          viewportW,
          viewportH,
        );
        if (sourceScreenId !== boardFileId && !localPointerInside) {
          const previewPoint =
            boardPointFromParentPointer(
              iframeX,
              iframeY,
              viewportW,
              viewportH,
            ) ?? crossScreenLastBoardPointRef.current;
          if (previewPoint) {
            updateCrossScreenTargetFromBoardPoint(previewPoint, sourceScreenId);
          }
          return;
        }

        crossScreenDragMsgRef.current = {
          selector: crossScreenDragMsgRef.current?.selector ?? selector ?? "",
          sourceId: crossScreenDragMsgRef.current
            ? crossScreenDragMsgRef.current.sourceId
            : sourceId,
          sourceDeleteRequestId:
            crossScreenDragMsgRef.current?.sourceDeleteRequestId ??
            msg.sourceDeleteRequestId,
          sourceProvenance: crossScreenDragMsgRef.current
            ? crossScreenDragMsgRef.current.sourceProvenance
            : sourceProvenance,
          sourcePointerOffset:
            crossScreenDragMsgRef.current?.sourcePointerOffset ??
            sourcePointerOffset,
          sourceElementSize:
            sourceElementSize ??
            crossScreenDragMsgRef.current?.sourceElementSize,
          sourceComputedSize:
            sourceComputedSize ??
            crossScreenDragMsgRef.current?.sourceComputedSize,
          modifiers:
            sourceModifiers ?? crossScreenDragMsgRef.current?.modifiers,
          sourceHtmlSnapshot:
            sourceHtmlSnapshot ??
            crossScreenDragMsgRef.current?.sourceHtmlSnapshot,
          duplicate:
            msg.duplicate === true ||
            crossScreenDragMsgRef.current?.duplicate === true,
          sourceCloneHtml:
            typeof msg.sourceCloneHtml === "string"
              ? msg.sourceCloneHtml
              : crossScreenDragMsgRef.current?.sourceCloneHtml,
          styleSnapshot:
            styleSnapshot ?? crossScreenDragMsgRef.current?.styleSnapshot,
          styleSnapshotCaptureFailed:
            styleSnapshotCaptureFailed ||
            crossScreenDragMsgRef.current?.styleSnapshotCaptureFailed === true,
        };

        const pointerInsideSourceIframe =
          sourceScreenId === boardFileId || localPointerInside;
        const sourceIsBoard = sourceScreenId === boardFileId;
        if (pointerInsideSourceIframe && !sourceIsBoard) {
          claimCrossScreenDrop(sourceScreenId, false);
          clearCrossScreenPreviewGuide();
          setCrossScreenGhost(null);
          setCrossScreenTarget(null);
          crossScreenTargetRef.current = null;
          crossScreenLastBoardPointRef.current = null;
          clearCrossScreenDropGuide();
          return;
        }

        const boardPoint = boardPointFromDragMessage(
          sourceScreenId,
          iframeX,
          iframeY,
          viewportW,
          viewportH,
        );
        if (!boardPoint) {
          clearCrossScreenDrag();
          return;
        }
        updateCrossScreenTargetFromBoardPoint(boardPoint, sourceScreenId);
        return;
      }

      if (msg.phase === "end") {
        if (crossScreenEndSeenRef.current) {
          clearCrossScreenDrag();
          return;
        }
        const cachedPayload = crossScreenDragMsgRef.current;
        const payload = cachedPayload
          ? {
              ...cachedPayload,
              sourceCloneHtml:
                typeof msg.sourceCloneHtml === "string"
                  ? msg.sourceCloneHtml
                  : cachedPayload.sourceCloneHtml,
              modifiers: mergeCrossScreenReleaseModifiers(
                cachedPayload.modifiers,
                sourceModifiers,
              ),
            }
          : {
              selector: msg.selector ?? "",
              sourceId: msg.sourceId,
              sourceDeleteRequestId: msg.sourceDeleteRequestId,
              sourceProvenance,
              sourcePointerOffset,
              sourceElementSize,
              sourceComputedSize,
              modifiers: sourceModifiers,
              sourceHtmlSnapshot,
              duplicate: msg.duplicate === true,
              sourceCloneHtml: msg.sourceCloneHtml,
              styleSnapshot,
              styleSnapshotCaptureFailed,
            };
        const endPointOutsideSource =
          sourceScreenId !== boardFileId &&
          Number.isFinite(msg.iframeX) &&
          Number.isFinite(msg.iframeY) &&
          Number.isFinite(msg.viewportW) &&
          Number.isFinite(msg.viewportH) &&
          !isPointerInsideCrossScreenSource(
            sourceScreenId,
            msg.iframeX!,
            msg.iframeY!,
            msg.viewportW!,
            msg.viewportH!,
          );
        const lastBoardPoint =
          (endPointOutsideSource
            ? boardPointFromParentPointer(
                msg.iframeX!,
                msg.iframeY!,
                msg.viewportW!,
                msg.viewportH!,
              )
            : boardPointFromDragMessage(
                sourceScreenId,
                msg.iframeX ?? 0,
                msg.iframeY ?? 0,
                msg.viewportW ?? 0,
                msg.viewportH ?? 0,
              )) ?? crossScreenLastBoardPointRef.current;
        const targetAtRelease = lastBoardPoint
          ? getFrameEntryAtPoint(lastBoardPoint, { excludeId: sourceScreenId })
          : null;
        const candidate = targetAtRelease
          ? { id: targetAtRelease.id, geometry: targetAtRelease.geometry }
          : crossScreenTargetRef.current;
        finalizeCrossScreenDrop(
          sourceScreenId,
          candidate,
          payload,
          lastBoardPoint,
          typeof msg.releasedAt === "number" ? msg.releasedAt : undefined,
        );
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
    boardSurfaceRenderGeometry,
    finishBoardCrossScreenDrop,
    getFrameEntryAtPoint,
    getFrameViewportSize,
    getCanvasPoint,
    getResolvedMetadata,
    onCrossScreenElementDrop,
    runtimeStructurePendingTransactionRef,
  ]);

  useEffect(
    () => () => {
      crossScreenParentDragCleanupRef.current?.();
      crossScreenParentDragCleanupRef.current = null;
    },
    [],
  );

  const [boardSelectionRect, setBoardSelectionRect] = useState<{
    rect: { left: number; top: number; width: number; height: number };
    rotationDeg: number;
    sourceId: string;
  } | null>(null);
  const [boardTextEditing, setBoardTextEditing] = useState(false);
  const handleBoardTextEditingStateChange = useCallback(
    (
      state: Parameters<NonNullable<typeof onBoardTextEditingStateChange>>[0],
    ) => {
      setBoardTextEditing(state.active);
      onBoardTextEditingStateChange?.(state);
    },
    [onBoardTextEditingStateChange],
  );
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const isBoundsOnly =
        event.data?.type === "agent-native:board-selection-bounds";
      if (
        !event.data ||
        (event.data.type !== "agent-native:board-selection-rect" &&
          !isBoundsOnly)
      ) {
        return;
      }
      const boardPreviewIframe = boardFileId
        ? findCanvasIframeForScreen(
            surfaceRef.current,
            boardFileId,
            boardFileId,
          )
        : null;
      if (
        !boardPreviewIframe ||
        boardPreviewIframe.contentWindow !== event.source
      ) {
        return;
      }
      const msg = event.data as {
        screenId?: string;
        selector?: string;
        sourceId?: string;
        memberSelectors?: unknown;
        memberSourceIds?: unknown;
        contentOffsetX?: number;
        contentOffsetY?: number;
        rect: {
          left: number;
          top: number;
          width: number;
          height: number;
        } | null;
        rotationDeg?: number;
      };
      if (!isBoundsOnly) {
        setBoardSelectionRect(
          msg.rect && msg.sourceId
            ? {
                rect: msg.rect,
                rotationDeg: msg.rotationDeg ?? 0,
                sourceId: msg.sourceId,
              }
            : null,
        );
      }
      if (!msg.rect) {
        onBoardSelectionWorldBoundsChange?.(null);
        return;
      }
      const rectValues = [
        msg.rect.left,
        msg.rect.top,
        msg.rect.width,
        msg.rect.height,
        msg.rotationDeg ?? 0,
        msg.contentOffsetX,
        msg.contentOffsetY,
      ];
      const memberSelectors = isBoundsOnly
        ? Array.isArray(msg.memberSelectors) &&
          msg.memberSelectors.length > 0 &&
          msg.memberSelectors.every(
            (selector) => typeof selector === "string" && selector.length > 0,
          )
          ? (msg.memberSelectors as string[])
          : null
        : undefined;
      const memberSourceIds = isBoundsOnly
        ? Array.isArray(msg.memberSourceIds) &&
          msg.memberSourceIds.length > 0 &&
          msg.memberSourceIds.every(
            (sourceId) => typeof sourceId === "string" && sourceId.length > 0,
          )
          ? (msg.memberSourceIds as string[])
          : null
        : undefined;
      if (
        !boardFileId ||
        msg.screenId !== boardFileId ||
        !msg.selector ||
        (isBoundsOnly &&
          (!memberSelectors ||
            !memberSourceIds ||
            memberSelectors.length !== memberSourceIds.length)) ||
        !rectValues.every(Number.isFinite) ||
        msg.rect.width <= 0 ||
        msg.rect.height <= 0
      ) {
        onBoardSelectionWorldBoundsChange?.(null);
        return;
      }
      onBoardSelectionWorldBoundsChange?.({
        screenId: boardFileId,
        selector: msg.selector,
        ...(memberSelectors ? { memberSelectors } : {}),
        ...(memberSourceIds ? { memberSourceIds } : {}),
        worldBounds: getBoardSelectionWorldBounds({
          rect: msg.rect,
          rotationDeg: msg.rotationDeg,
          contentOffsetX: msg.contentOffsetX!,
          contentOffsetY: msg.contentOffsetY!,
        }),
      });
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      onBoardSelectionWorldBoundsChange?.(null);
    };
  }, [boardFileId, onBoardSelectionWorldBoundsChange]);

  const deleteSelectedItems = useCallback(() => {
    if (readOnly) return false;
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
    readOnly,
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

  type SelectableRectsReply =
    | { status: "ok"; infos: ElementInfo[] }
    | { status: "unanswered"; reason: "no-iframe" | "timeout" };

  const requestSelectableElementInfos = useCallback(
    async (
      screenId: string,
      deep: boolean,
      atPoint?: Point | null,
      includePortableStyleSnapshot = true,
    ): Promise<SelectableRectsReply> => {
      while (bootStatusByScreenIdRef.current.get(screenId) === "booting") {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      const targetScreen = screensRef.current.find((s) => s.id === screenId);
      const iframeId = targetScreen
        ? getActiveScreenIframeId(targetScreen)
        : screenId;
      const targetIframe = findCanvasIframeForScreen(
        surfaceRef.current,
        iframeId,
        boardFileId,
      );
      const targetContentWindow = targetIframe?.contentWindow;
      if (!targetContentWindow) {
        return { status: "unanswered", reason: "no-iframe" };
      }
      const correlationId = `rects-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", listener);
          resolve({ status: "unanswered", reason: "timeout" });
        }, SELECTABLE_RECTS_REPLY_TIMEOUT_MS);
        const listener = (event: MessageEvent) => {
          if (
            !event.data ||
            event.data.type !== "agent-native:selectable-rects-result" ||
            event.data.correlationId !== correlationId ||
            event.source !== targetContentWindow
          ) {
            return;
          }
          window.clearTimeout(timer);
          window.removeEventListener("message", listener);
          const payload: unknown[] = Array.isArray(event.data.payload)
            ? event.data.payload
            : [];
          resolve({
            status: "ok",
            infos: payload.filter((item): item is ElementInfo => {
              if (!item || typeof item !== "object") return false;
              const candidate = item as Partial<ElementInfo>;
              return (
                typeof candidate.tagName === "string" &&
                !!candidate.boundingRect &&
                typeof candidate.boundingRect.width === "number" &&
                typeof candidate.boundingRect.height === "number"
              );
            }),
          });
        };
        window.addEventListener("message", listener);
        targetContentWindow.postMessage(
          {
            type: "agent-native:collect-selectable-rects",
            correlationId,
            deep,
            includePortableStyleSnapshot,
            ...(atPoint ? { atPoint } : {}),
          },
          "*",
        );
      });
    },
    [boardFileId],
  );

  /** Collects marquee-selectable layer candidates. Each screen requires an
   *  async postMessage round-trip into its iframe (requestSelectableElementInfos),
   *  so collecting for every screen on the board unconditionally at marquee
   *  mousedown (PF20) is expensive for boards with many screens — most of
   *  which the marquee rect will never touch. `screenIds`, when given, scopes
   *  collection to just those frame entries (plus the board, which spans the
   *  whole surface so it's included whenever explicitly requested); omit it
   *  to collect every screen.
   *
   *  `deep` mirrors the in-iframe marquee/click's own Cmd/Ctrl semantics
   *  (container-first-selection.bridge.spec.ts, marquee-container-first.bridge.spec.ts):
   *  false collects only the direct children of each screen's current
   *  selection-container scope (matching Figma's plain marquee), true
   *  reaches into nested descendants. Double-click drill-in and click-to-pick
   *  (`drillIntoScreenAtPoint`) always pass true — they need the full
   *  descendant list to walk one level deeper per repeat click/click. The
   *  overview marquee passes `includePortableStyleSnapshot: false` because
   *  it needs hit geometry first; direct selection and drill-in keep the full
   *  snapshot contract for copy/paste. */
  const collectLayerMarqueeCandidates = useCallback(
    async (
      screenIds?: Set<string>,
      deep = false,
      atBoardPoint?: Point | null,
      includePortableStyleSnapshot = true,
    ) => {
      const unanswered: Array<{
        screenId: string;
        reason: "no-iframe" | "timeout";
      }> = [];
      const frameEntries = getSelectableFrameEntries().filter(
        (entry) => !screenIds || screenIds.has(entry.id),
      );
      const frameCandidatesPromise = Promise.all(
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
          const contentScale =
            entry.geometry.width / Math.max(1, viewportWidth);
          const renderedFrame = {
            ...entry.geometry,
            height: viewportHeight * contentScale,
          };
          const reply = await requestSelectableElementInfos(
            entry.id,
            deep,
            atBoardPoint
              ? boardPointToScreenLocalPoint(atBoardPoint, renderedFrame, {
                  width: viewportWidth,
                  height: viewportHeight,
                })
              : null,
            includePortableStyleSnapshot,
          );
          if (reply.status !== "ok") {
            unanswered.push({ screenId: entry.id, reason: reply.reason });
            return [] as CanvasLayerMarqueeCandidate[];
          }
          const infos = reply.infos;
          return infos.map((info) => ({
            screenId: entry.id,
            info,
            geometry: screenLocalRectToBoardGeometry(
              {
                left: info.boundingRect.x,
                top: info.boundingRect.y,
                width: info.boundingRect.width,
                height: info.boundingRect.height,
              },
              renderedFrame,
              { width: viewportWidth, height: viewportHeight },
            ),
            frameGeometry: entry.geometry,
          }));
        }),
      );
      const boardCandidatesPromise =
        boardFileId &&
        boardSurfaceRenderGeometry &&
        (!screenIds || screenIds.has(boardFileId))
          ? (async () => {
              const reply = await requestSelectableElementInfos(
                boardFileId,
                deep,
                atBoardPoint
                  ? boardPointToScreenLocalPoint(
                      atBoardPoint,
                      boardSurfaceRenderGeometry,
                      {
                        width: boardSurfaceRenderGeometry.width,
                        height: boardSurfaceRenderGeometry.height,
                      },
                    )
                  : null,
                includePortableStyleSnapshot,
              );
              if (reply.status !== "ok") {
                unanswered.push({
                  screenId: boardFileId,
                  reason: reply.reason,
                });
                return [] as CanvasLayerMarqueeCandidate[];
              }
              return reply.infos.map((info) => ({
                screenId: boardFileId,
                info,
                geometry: screenLocalRectToBoardGeometry(
                  {
                    left: info.boundingRect.x,
                    top: info.boundingRect.y,
                    width: info.boundingRect.width,
                    height: info.boundingRect.height,
                  },
                  boardSurfaceRenderGeometry,
                  {
                    width: boardSurfaceRenderGeometry.width,
                    height: boardSurfaceRenderGeometry.height,
                  },
                ),
                frameGeometry: boardSurfaceRenderGeometry,
              }));
            })()
          : Promise.resolve([] as CanvasLayerMarqueeCandidate[]);
      const [frameCandidates, boardCandidates] = await Promise.all([
        frameCandidatesPromise,
        boardCandidatesPromise,
      ]);
      if (unanswered.length > 0) {
        dndHostLog("overview:selectable-rects-unanswered", { unanswered });
      }
      return {
        candidates: [...frameCandidates.flat(), ...boardCandidates],
        unanswered,
      };
    },
    [
      boardFileId,
      boardSurfaceRenderGeometry,
      getSelectableFrameEntries,
      getResolvedMetadata,
      requestSelectableElementInfos,
    ],
  );

  const drillIntoScreenAtPoint = useCallback(
    (
      id: string,
      clientX: number,
      clientY: number,
      mode: "drill" | "pick" = "drill",
      modifierKeys?: Pick<
        ElementSelectionIntent,
        "shiftKey" | "metaKey" | "ctrlKey"
      >,
    ) => {
      const point = getCanvasPoint(clientX, clientY);
      const previousKey =
        drillInTargetRef.current?.screenId === id
          ? drillInTargetRef.current.key
          : null;
      const requestId = drillInRequestRef.current + 1;
      drillInRequestRef.current = requestId;
      // Deep: drill-in/pick must see nested descendants to walk one level
      // further per repeat click — unlike a marquee, which stops at the
      // current container scope's direct children by default.
      void collectLayerMarqueeCandidates(new Set([id]), true, point).then(
        (result) => {
          if (drillInRequestRef.current !== requestId) return;
          if (result.unanswered.length > 0) {
            return;
          }
          const candidates = result.candidates;
          const target =
            mode === "pick"
              ? resolvePickTargetAtPoint({ candidates, screenId: id, point })
              : resolveDrillInTarget({
                  candidates,
                  screenId: id,
                  point,
                  previousKey,
                });
          if (!target) {
            drillInTargetRef.current = null;
            return;
          }
          drillInTargetRef.current = {
            screenId: id,
            key: drillInCandidateKey(target),
          };
          updateSelectedDraftIds(() => []);
          updateSelectedIds(() => []);
          onLayerMarqueeSelectionChange?.(
            [{ screenId: target.screenId, info: target.info }],
            {
              additive: Boolean(modifierKeys?.shiftKey),
              ctrlKey: Boolean(modifierKeys?.ctrlKey),
              metaKey: Boolean(modifierKeys?.metaKey),
              shiftKey: Boolean(modifierKeys?.shiftKey),
              source: "pointer",
            },
          );
        },
      );
    },
    [
      collectLayerMarqueeCandidates,
      getCanvasPoint,
      onLayerMarqueeSelectionChange,
      updateSelectedDraftIds,
      updateSelectedIds,
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
                codeLayerSource: boardCodeLayerSource,
              },
            ]
          : screensRef.current;
      const renderedFrameGeometryById = {
        ...frameGeometryRef.current,
        ...renderedFrameGeometryRef.current,
      };
      const frameGeometryForPrimitiveHitTest =
        boardFileId && boardFrameGeometry
          ? {
              ...renderedFrameGeometryById,
              [boardFileId]: boardFrameGeometry,
            }
          : renderedFrameGeometryById;
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
          backgroundScreenIds: boardFileId ? new Set([boardFileId]) : undefined,
          foregroundScreenId:
            selectedIdsRef.current.find(
              (id) => frameGeometryRef.current[id] !== undefined,
            ) ??
            (activeId && frameGeometryRef.current[activeId]
              ? activeId
              : screensRef.current[0]?.id),
        },
      );
    },
    [
      activeId,
      boardFileContent,
      boardFileId,
      boardCodeLayerSource,
      boardFrameGeometry,
      getResolvedMetadata,
    ],
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
                codeLayerSource: boardCodeLayerSource,
              },
            ]
          : screensRef.current;
      return resolveNodeScreenId(nodeId, screensForPrimitiveLookup);
    },
    [boardCodeLayerSource, boardFileContent, boardFileId],
  );

  const finishDrag = useCallback(() => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    dragState.current = null;
    liveFrameDragPositionsRef.current.clear();
    liveFrameDragSelectionPositionRef.current = null;
    setIsDragging(false);
    setIsPanning(false);
    setMarquee(null);
    setCreationPreview(null);
    setAlignmentGuides([]);
    setEqualGapGuides([]);
    setProximityMeasurements([]);
    setTransformBadge(null);
    setDragCursor(null);
    primitiveDropTargetRef.current = null;
    setPrimitiveDropTarget(null);
    boardElementResizeCancel.current = null;
    dragCleanup.current?.();
  }, []);

  const scaleScreenContents = useCallback(
    (
      screenId: string,
      factor: number,
      phase: "begin" | "preview" | "commit" | "cancel" | "accept",
    ): KScaleStyleChange[] | null => {
      const screen = screensRef.current.find((entry) => entry.id === screenId);
      if (!screen) return null;
      const iframe = findCanvasIframeForScreen(
        surfaceRef.current,
        getActiveScreenIframeId(screen),
        boardFileId,
      );
      const targetWindow = iframe?.contentWindow as
        | (Window & {
            __designCanvasScaleContents?: (
              scale: number,
              operation: "begin" | "preview" | "commit" | "cancel" | "accept",
            ) => KScaleStyleChange[];
          })
        | null
        | undefined;
      if (!targetWindow) return null;
      try {
        return typeof targetWindow.__designCanvasScaleContents === "function"
          ? targetWindow.__designCanvasScaleContents(factor, phase)
          : null;
      } catch (error) {
        if (error instanceof DOMException && error.name === "SecurityError") {
          return null;
        }
        throw error;
      }
    },
    [boardFileId],
  );

  finishDragRef.current = finishDrag;

  // oxfmt-ignore
  const cancelActiveDrag = useCallback((pressedAt?: number) => {
    let cancelled = false;
    const state = dragState.current;

    const restoreImperativeMoveDom = (
      originById: Record<string, FrameGeometry | DraftPrimitive>,
      targetIds: string[],
      kind: "frame" | "draft",
    ) => {
      const originGeometries: FrameGeometry[] = [];
      targetIds.forEach((targetId) => {
        const origin = originById[targetId];
        const geometry =
          origin && "geometry" in origin ? origin.geometry : origin;
        if (!geometry) return;
        originGeometries.push(geometry);
        const selector =
          kind === "frame"
            ? `[data-frame-id="${CSS.escape(targetId)}"]`
            : `[data-draft-id="${CSS.escape(targetId)}"]`;
        const element =
          surfaceRef.current?.querySelector<HTMLElement>(selector);
        if (!element) return;
        const labelHeight =
          kind === "frame"
            ? FRAME_LABEL_HEIGHT * chromeScaleFromZoom(zoomRef.current)
            : 0;
        const position = frameStyleLeftTop(geometry, labelHeight);
        element.style.left = `${position.left}px`;
        element.style.top = `${position.top}px`;
        if (kind !== "frame") {
          if ("kind" in origin) {
            applyDraftPrimitiveToDom(element, origin);
          }
          return;
        }
        element.style.width = `${geometry.width}px`;
        element.style.transform = geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : "";
        element.style.transformOrigin = `${geometry.width / 2}px ${
          labelHeight + geometry.height / 2
        }px`;
        const cardEl = element.querySelector<HTMLElement>("[data-screen-card]");
        if (cardEl) {
          cardEl.style.width = `${geometry.width}px`;
          cardEl.style.height = `${geometry.height}px`;
        }
        const iframeEl = element.querySelector<HTMLIFrameElement>(
          `[data-screen-iframe-id="${CSS.escape(targetId)}"]`,
        );
        const screen = screensRef.current.find((s) => s.id === targetId);
        if (iframeEl && screen) {
          const viewport = getScreenPreviewViewport(
            getResolvedMetadata(screen),
            geometry,
          );
          iframeEl.style.width = `${viewport.viewportWidth}px`;
          iframeEl.style.height = `${viewport.viewportHeight}px`;
          iframeEl.style.transform =
            viewport.scale === 1 ? "" : `scale(${viewport.scale})`;
        }
      });

      const selectionBox = surfaceRef.current?.querySelector<HTMLElement>(
        "[data-frame-selection-box]",
      );
      if (!selectionBox || originGeometries.length === 0) return;
      const bounds =
        originGeometries.length === 1
          ? originGeometries[0]
          : (() => {
              const group = getFrameGroupBounds(
                originGeometries.map((geometry) => ({ id: "", geometry })),
              );
              return group
                ? {
                    x: group.left,
                    y: group.top,
                    width: group.width,
                    height: group.height,
                  }
                : null;
            })();
      if (!bounds) return;
      const position = frameStyleLeftTop(bounds);
      selectionBox.style.left = `${position.left}px`;
      selectionBox.style.top = `${position.top}px`;
      selectionBox.style.width = `${bounds.width}px`;
      selectionBox.style.height = `${bounds.height}px`;
      const boxRotation =
        originGeometries.length === 1 ? (originGeometries[0].rotation ?? 0) : 0;
      selectionBox.style.transform = boxRotation
        ? `rotate(${boxRotation}deg)`
        : "";
      selectionBox.style.transformOrigin = `${bounds.width / 2}px ${bounds.height / 2}px`;
    };

    if (state) {
      cancelled = true;
      if (state.type === "resize" && state.scaleContents) {
        state.targetIds.forEach((screenId) => {
          scaleScreenContents(screenId, 1, "cancel");
        });
      }
      if (
        state.type === "move" ||
        state.type === "resize" ||
        state.type === "group-rotate"
      ) {
        restoreImperativeMoveDom(state.originFrames, state.targetIds, "frame");
        updateFrameGeometry((current) =>
          frameGeometryWithOverrides(current, state.originFrames),
        );
      } else if (state.type === "rotate") {
        restoreImperativeMoveDom(
          { [state.frameId]: state.originFrame },
          [state.frameId],
          "frame",
        );
        updateFrameGeometry((current) => ({
          ...current,
          [state.frameId]: { ...state.originFrame },
        }));
      } else if (state.type === "draft-move" || state.type === "draft-resize") {
        restoreImperativeMoveDom(state.originDrafts, state.targetIds, "draft");
        updateDraftPrimitives((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            return origin ? cloneDraftPrimitive(origin) : draft;
          }),
        );
      } else if (state.type === "pan") {
        panRef.current = { ...state.originPan };
        setPan(panRef.current);
        applyViewToDomRef.current();
        recomputePenPointerForViewChangeRef.current();
      } else if (state.type === "marquee") {
        marqueeLifecycleRef.current += 1;
        onLayerMarqueeSelectionChange?.([], {
          source: "marquee",
          cancelled: true,
          restoreHostSelection: true,
        });
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
        state.type === "vector-handle" ||
        state.type === "vector-segment"
      ) {
        vectorEdit?.onChange(clonePenPath(state.pathBefore), "commit");
      }
    }

    if (duplicateCleanup.current) {
      cancelled = true;
      duplicateCleanup.current();
    }

    if (!cancelled && boardElementResizeCancel.current) {
      cancelled = true;
      boardElementResizeCancel.current(
        pressedAt ?? performance.timeOrigin + performance.now(),
      );
    }

    if (cancelled || dragCleanup.current) {
      finishDrag();
      return true;
    }
    return false;
  }, [
    finishDrag,
    getResolvedMetadata,
    scaleScreenContents,
    onLayerMarqueeSelectionChange,
    updateDraftPrimitives,
    updateFrameGeometry,
    updateSelectedDraftIds,
    updateSelectedIds,
    vectorEdit,
  ]);

  useEffect(() => {
    const hostUsesSForIgnoreAutoLayout = () => !isApplePlatform();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (hostUsesSForIgnoreAutoLayout() && event.key.toLowerCase() === "s") {
        crossScreenSKeyPressedRef.current = true;
        crossScreenSKeyTimesRef.current = {
          downAt: eventEpochMilliseconds(event.timeStamp),
          upAt: null,
        };
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (hostUsesSForIgnoreAutoLayout() && event.key.toLowerCase() === "s") {
        crossScreenSKeyPressedRef.current = false;
        crossScreenSKeyTimesRef.current = {
          ...crossScreenSKeyTimesRef.current,
          upAt: eventEpochMilliseconds(event.timeStamp),
        };
      }
    };
    const handleBlur = () => {
      crossScreenSKeyPressedRef.current = false;
      if (shouldClearCrossScreenSKeyTimesOnWindowBlur(document.hasFocus())) {
        crossScreenSKeyTimesRef.current = { downAt: null, upAt: null };
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur, true);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const cancelled = cancelActiveDrag(
        eventEpochMilliseconds(event.timeStamp),
      );
      if (cancelled) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      if (activePenPathRef.current) return;
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
      cancelPendingStaticBoardSelection();
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
        applyViewToDomRef.current();
        scheduleViewCommitRef.current();
      };

      const handlePanEnd = () => {
        setPan(panRef.current);
        recomputePenPointerForViewChangeRef.current();
        finishDrag();
      };

      installDragListeners(handleMouseMove, handlePanEnd);
    },
    [cancelPendingStaticBoardSelection, finishDrag, installDragListeners],
  );

  const beginMarquee = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      drillInRequestRef.current += 1;
      const cachedSurfaceRect = surfaceRef.current?.getBoundingClientRect();
      const getCanvasPointFromCachedRect = (clientX: number, clientY: number) =>
        cachedSurfaceRect
          ? screenToCanvasPoint(
              { x: clientX, y: clientY },
              { ...panRef.current, zoom: zoomRef.current },
              { x: cachedSurfaceRect.left, y: cachedSurfaceRect.top },
              SURFACE_PADDING,
            )
          : getCanvasPoint(clientX, clientY);
      const originCanvas = getCanvasPointFromCachedRect(e.clientX, e.clientY);
      const deepSelect = e.metaKey || e.ctrlKey;
      const marqueeToken = ++marqueeLifecycleRef.current;
      let latestRect = normalizeRectFromPoints(originCanvas, originCanvas);
      let layerCandidates: CanvasLayerMarqueeCandidate[] = [];
      let lastLayerSelectionSignature: string | null = null;
      let latestFullyEnclosedScreenIds = new Set<string>();
      const marqueeState: MarqueeDragState = {
        type: "marquee",
        originClient: { x: e.clientX, y: e.clientY },
        originCanvas,
        baseSelectedIds: selectedIdsRef.current,
        baseSelectedDraftIds: selectedDraftIdsRef.current,
        additive: e.shiftKey,
        hasMoved: false,
      };
      const collectedScreenIds = new Set<string>();
      const collectingScreenIds = new Set<string>();
      const timedOutScreenIds = new Set<string>();
      const pendingMarqueeCollections: Array<Promise<void>> = [];
      let marqueeReleased = false;
      const reportLayerSelection = (rect: MarqueeRect, final?: boolean) => {
        const state = dragState.current;
        if (
          state !== marqueeState ||
          marqueeLifecycleRef.current !== marqueeToken
        )
          return;
        const selection = layerCandidates
          .filter(
            (candidate) =>
              deepSelect ||
              !latestFullyEnclosedScreenIds.has(candidate.screenId),
          )
          .filter((candidate) => !enclosesMarqueeRect(candidate.geometry, rect))
          .filter((candidate) =>
            rotatedRectIntersects(
              rect,
              getLayerSelectableBounds(candidate.geometry),
              getFrameCenter(candidate.geometry),
              candidate.geometry.rotation ?? 0,
            ),
          )
          .map((candidate) => ({
            screenId: candidate.screenId,
            info: candidate.info,
          }));
        const signature = selection
          .map(
            (item) =>
              `${item.screenId}:${item.info.sourceId ?? item.info.pendingNodeId ?? item.info.selector ?? item.info.id ?? ""}`,
          )
          .join("|");
        if (!final && signature === lastLayerSelectionSignature) return;
        lastLayerSelectionSignature = signature;
        onLayerMarqueeSelectionChange?.(selection, {
          source: "marquee",
          additive: state.additive,
          shiftKey: state.additive,
          final: final === true,
        });
      };
      const collectForIntersectedScreens = (hitIds: string[]) => {
        const newIds = hitIds.filter(
          (id) =>
            !collectedScreenIds.has(id) &&
            !collectingScreenIds.has(id) &&
            !timedOutScreenIds.has(id),
        );
        if (
          boardFileId &&
          boardFrameGeometry &&
          !collectedScreenIds.has(boardFileId) &&
          !collectingScreenIds.has(boardFileId) &&
          !timedOutScreenIds.has(boardFileId)
        ) {
          newIds.push(boardFileId);
        }
        if (newIds.length === 0) return;
        const requestIds = new Set(newIds);
        newIds.forEach((id) => collectingScreenIds.add(id));
        const collection = collectLayerMarqueeCandidates(
          requestIds,
          deepSelect,
          null,
          false,
        ).then((result) => {
          const unanswered = new Set(
            result.unanswered.map((entry) => entry.screenId),
          );
          result.unanswered.forEach((entry) => {
            if (entry.reason === "timeout")
              timedOutScreenIds.add(entry.screenId);
          });
          newIds.forEach((id) => {
            collectingScreenIds.delete(id);
            if (!unanswered.has(id)) collectedScreenIds.add(id);
          });
          if (
            dragState.current !== marqueeState ||
            marqueeLifecycleRef.current !== marqueeToken
          )
            return;
          layerCandidates = [...layerCandidates, ...result.candidates];
          if (!marqueeReleased) reportLayerSelection(latestRect);
        });
        pendingMarqueeCollections.push(collection);
      };
      dragState.current = marqueeState;
      setMarquee({ ...originCanvas, width: 0, height: 0 });
      if (!e.shiftKey) {
        updateSelectedIds(() => []);
        updateSelectedDraftIds(() => []);
        onLayerMarqueeSelectionChange?.([], {
          source: "marquee",
          additive: false,
          shiftKey: false,
          resetHistory: true,
        });
        lastLayerSelectionSignature = "";
      } else {
        onLayerMarqueeSelectionChange?.([], {
          source: "marquee",
          additive: true,
          shiftKey: true,
          cancelled: true,
          resetHistory: true,
        });
      }
      setIsDragging(true);
      collectForIntersectedScreens([]);

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "marquee") return;
        if (marqueeReleased) return;
        const nextPoint = getCanvasPointFromCachedRect(ev.clientX, ev.clientY);
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

        if (!state.hasMoved) return;

        setMarquee(rect);

        const chromeScale = chromeScaleFromZoom(zoomRef.current);
        const screenEntries = getSelectableFrameEntries();
        const intersectedScreenIds = screenEntries
          .filter((entry) =>
            rotatedRectIntersects(
              rect,
              getSelectableBounds(entry.geometry, chromeScale),
              getFrameCenter(entry.geometry),
              entry.geometry.rotation ?? 0,
            ),
          )
          .map((entry) => entry.id);
        const hitIds = screenEntries
          .filter((entry) =>
            marqueeFullyEnclosesBounds(
              rect,
              getSelectableBounds(entry.geometry, chromeScale),
            ),
          )
          .map((entry) => entry.id);
        latestFullyEnclosedScreenIds = new Set(hitIds);
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

        collectForIntersectedScreens(intersectedScreenIds);

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
        if (state?.type === "marquee") {
          marqueeReleased = true;
          if (shouldClearSelectionOnEmptyCanvasClick(state)) {
            updateSelectedIds(() => []);
            updateSelectedDraftIds(() => []);
            onLayerMarqueeSelectionChange?.([], {
              source: "marquee",
              additive: false,
              shiftKey: false,
              final: true,
            });
            finishDrag();
          } else {
            const finalRect = latestRect;
            const releasedSelectionRevision = `${selectedIdsRef.current.join(",")}\u001e${selectedDraftIdsRef.current.join(",")}\u001e${marqueeHostSelectionRevisionRef.current}`;
            void Promise.allSettled(pendingMarqueeCollections).then(
              async () => {
                if (
                  dragState.current !== marqueeState ||
                  marqueeLifecycleRef.current !== marqueeToken
                )
                  return;
                const currentSelectionRevision = `${selectedIdsRef.current.join(",")}\u001e${selectedDraftIdsRef.current.join(",")}\u001e${marqueeHostSelectionRevisionRef.current}`;
                if (currentSelectionRevision !== releasedSelectionRevision) {
                  onLayerMarqueeSelectionChange?.([], {
                    source: "marquee",
                    cancelled: true,
                  });
                  finishDrag();
                  return;
                }
                const selectedScreenIds = new Set(
                  layerCandidates
                    .filter(
                      (candidate) =>
                        (deepSelect ||
                          !latestFullyEnclosedScreenIds.has(
                            candidate.screenId,
                          )) &&
                        !enclosesMarqueeRect(candidate.geometry, finalRect) &&
                        rotatedRectIntersects(
                          finalRect,
                          getLayerSelectableBounds(candidate.geometry),
                          getFrameCenter(candidate.geometry),
                          candidate.geometry.rotation ?? 0,
                        ),
                    )
                    .map((candidate) => candidate.screenId),
                );
                if (selectedScreenIds.size > 0) {
                  const full = await collectLayerMarqueeCandidates(
                    selectedScreenIds,
                    deepSelect,
                  );
                  const fullByIdentity = new Map(
                    full.candidates.map((candidate) => [
                      `${candidate.screenId}:${candidate.info.sourceId ?? candidate.info.pendingNodeId ?? candidate.info.selector ?? candidate.info.id ?? ""}`,
                      candidate,
                    ]),
                  );
                  layerCandidates = layerCandidates.map((candidate) => {
                    const key = `${candidate.screenId}:${candidate.info.sourceId ?? candidate.info.pendingNodeId ?? candidate.info.selector ?? candidate.info.id ?? ""}`;
                    return fullByIdentity.get(key) ?? candidate;
                  });
                }
                if (
                  dragState.current !== marqueeState ||
                  marqueeLifecycleRef.current !== marqueeToken
                ) {
                  return;
                }
                const refreshedSelectionRevision = `${selectedIdsRef.current.join(",")}\u001e${selectedDraftIdsRef.current.join(",")}\u001e${marqueeHostSelectionRevisionRef.current}`;
                if (refreshedSelectionRevision !== releasedSelectionRevision) {
                  onLayerMarqueeSelectionChange?.([], {
                    source: "marquee",
                    cancelled: true,
                  });
                  finishDrag();
                  return;
                }
                reportLayerSelection(finalRect, true);
                finishDrag();
              },
            );
          }
          return;
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
      getSelectableFrameEntries,
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

      const containing = getFrameEntryAtPoint(draftCenter);

      if (containing) return containing;

      return getOutsideFrameDraftFallback(entries, {
        hasBoardDrawHandler: Boolean(onBoardDrawPrimitiveRef.current),
      });
    },
    [getCurrentFrameEntries, getFrameEntryAtPoint],
  );

  const persistDraftPrimitive = useCallback(
    (
      draft: DraftPrimitive,
      preferredFrameId?: string,
      options?: {
        nextTool?: "move" | "pen";
        reparentTargetIdentity?: ScreenProjectionNodeIdentity;
        updateNodeId?: string;
      },
    ): PersistedDraftPrimitive | null => {
      const targetFrame =
        options?.updateNodeId && preferredFrameId === boardFileId
          ? undefined
          : getTargetFrameForDraft(draft, preferredFrameId);
      if (
        options?.updateNodeId &&
        preferredFrameId &&
        targetFrame?.id !== preferredFrameId &&
        preferredFrameId !== boardFileId
      ) {
        return null;
      }

      if (!targetFrame) {
        const handler = onBoardDrawPrimitiveRef.current;
        if (handler) {
          const boardPrimitive = draftPrimitiveToInsert(draft, {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          });
          if (options?.updateNodeId) {
            const updated = Boolean(
              boardFileId &&
              boardPrimitive.penPath &&
              onUpdatePenPath?.(
                boardFileId,
                options.updateNodeId,
                boardPrimitive.penPath,
              ),
            );
            return updated
              ? { frameId: boardFileId!, nodeId: options.updateNodeId }
              : null;
          }
          const persisted = persistBoardDraftPrimitive({
            boardFileId,
            draftId: draft.id,
            primitive: boardPrimitive,
            handler,
            options,
          });
          return persisted
            ? {
                ...persisted,
                sourceNodeId: boardPrimitive.nodeId ?? draft.id,
              }
            : null;
        }
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
      const targetIframe = targetScreen
        ? surfaceRef.current?.querySelector<HTMLIFrameElement>(
            `[data-screen-iframe-id="${CSS.escape(getActiveScreenIframeId(targetScreen))}"]`,
          )
        : null;
      const measuredMetadata =
        targetMetadata && targetIframe?.clientWidth && targetIframe.clientHeight
          ? {
              ...targetMetadata,
              width: targetIframe.clientWidth,
              height: targetIframe.clientHeight,
            }
          : targetMetadata;

      const localPrimitive = draftPrimitiveToInsert(
        draft,
        targetFrame.geometry,
        measuredMetadata,
      );
      if (options?.updateNodeId) {
        const updated = Boolean(
          localPrimitive.penPath &&
          onUpdatePenPath?.(
            targetFrame.id,
            options.updateNodeId,
            localPrimitive.penPath,
          ),
        );
        return updated
          ? { frameId: targetFrame.id, nodeId: options.updateNodeId }
          : null;
      }
      const persisted = onCreatePrimitive?.(
        targetFrame.id,
        localPrimitive,
        options?.reparentTargetIdentity
          ? { reparentTargetIdentity: options.reparentTargetIdentity }
          : undefined,
      );
      if (!persisted) {
        return null;
      }
      const persistedNodeId =
        typeof persisted === "string"
          ? persisted
          : typeof persisted === "object"
            ? persisted.nodeId
            : localPrimitive.nodeId;
      return {
        frameId: targetFrame.id,
        nodeId: persistedNodeId ?? draft.id,
        sourceNodeId: localPrimitive.nodeId ?? draft.id,
        ...(typeof persisted === "object"
          ? {
              preparedTargetNodeId: persisted.preparedTargetNodeId,
              preparedTargetIdentity: persisted.preparedTargetIdentity,
            }
          : {}),
      };
    },
    [
      boardFileId,
      getScreenMetadata,
      getTargetFrameForDraft,
      metadataById,
      onCreatePrimitive,
      onUpdatePenPath,
      screens,
    ],
  );

  const commitDraftPrimitive = useCallback(
    (
      nextDraft: DraftPrimitive,
      preferredFrameId?: string,
      options?: { nextTool?: "move" | "pen" },
    ): PersistedDraftPrimitive | null => {
      const persisted = persistDraftPrimitive(
        nextDraft,
        preferredFrameId,
        options,
      );
      if (persisted) {
        updateDraftPrimitives((current) =>
          current.filter((draft) => draft.id !== nextDraft.id),
        );
        updateSelectedDraftIds(() => []);
        updateSelectedIds(() => []);
        if (
          persisted.frameId !== boardFileId &&
          persisted.frameId !== "__board__"
        ) {
          onPrimitiveCreated?.(persisted.frameId, persisted.nodeId, {
            nextTool: options?.nextTool,
          });
        }
        return persisted;
      }

      updateDraftPrimitives((current) => [...current, nextDraft]);
      updateSelectedIds(() => []);
      updateSelectedDraftIds(() => [nextDraft.id]);
      return null;
    },
    [
      persistDraftPrimitive,
      boardFileId,
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
    if (lastPersisted && lastPersisted.frameId !== "__board__") {
      onPrimitiveCreated?.(lastPersisted.frameId, lastPersisted.nodeId, {
        preserveActiveTool: true,
      });
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

  const finishPenPath = useCallback(
    (
      path = activePenPathRef.current,
      options?: {
        continueAfterCommit?: boolean;
        nextTool?: "move" | "pen";
      },
    ) => {
      let nextTool: "move" | "pen" = options?.nextTool ?? "pen";
      clearActivePenPath();
      if (!path || path.nodes.length < 2) {
        penContinuesVectorEditRef.current = false;
        return;
      }

      if (penContinuesVectorEditRef.current) {
        const active = vectorEditRef.current;
        const baseCount = penContinuationBaseCountRef.current;
        const changed =
          path.nodes.length > baseCount || path.closed !== active?.path.closed;
        const accepted =
          !changed ||
          Boolean(
            active &&
            active.onChange(
              {
                closed: path.closed,
                nodes: path.nodes.map((node) => ({
                  ...node,
                  point: {
                    x: node.point.x - active.originCanvas.x,
                    y: node.point.y - active.originCanvas.y,
                  },
                  handleIn: node.handleIn
                    ? {
                        x: node.handleIn.x - active.originCanvas.x,
                        y: node.handleIn.y - active.originCanvas.y,
                      }
                    : undefined,
                  handleOut: node.handleOut
                    ? {
                        x: node.handleOut.x - active.originCanvas.x,
                        y: node.handleOut.y - active.originCanvas.y,
                      }
                    : undefined,
                })),
              },
              "commit",
            ),
          );
        if (!accepted) {
          activePenPathRef.current = path;
          setActivePenPath(path);
          return;
        }
        penContinuesVectorEditRef.current = false;
        penContinuationBaseCountRef.current = 0;
        if (nextTool === "move") active?.onExit();
        onActiveToolChange?.(nextTool);
        return;
      }

      const draft = createPenDraftPrimitive(path, {
        stroke: toolProps?.stroke,
        strokeWidth: toolProps?.strokeWidth,
      });
      const continuation = continuationPenPathRef.current;
      if (continuation) {
        const persisted = persistDraftPrimitive(draft, continuation.frameId, {
          updateNodeId: continuation.nodeId,
        });
        if (!persisted) {
          activePenPathRef.current = path;
          setActivePenPath(path);
          return;
        }
        continuationPenPathRef.current =
          path.closed || !options?.continueAfterCommit
            ? null
            : { ...continuation, path: clonePenPath(path) };
      } else {
        const persisted = commitDraftPrimitive(draft, undefined, {
          nextTool,
        });
        if (!persisted) nextTool = "pen";
        continuationPenPathRef.current =
          persisted && !path.closed && options?.continueAfterCommit
            ? {
                frameId: persisted.frameId,
                nodeId: persisted.sourceNodeId ?? persisted.nodeId,
                path: clonePenPath(path),
              }
            : null;
      }
      onActiveToolChange?.(nextTool);
    },
    [
      clearActivePenPath,
      commitDraftPrimitive,
      onActiveToolChange,
      persistDraftPrimitive,
      toolProps,
    ],
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
      if (e.detail > 1) {
        finishPenPath();
        return;
      }
      suppressNextPick.current = true;
      seedSelectedPenContinuationRef.current();

      let pathBefore = activePenPathRef.current?.closed
        ? null
        : activePenPathRef.current;
      const rawPoint = getCanvasPoint(e.clientX, e.clientY);
      if (!pathBefore && continuationPenPathRef.current) {
        const continuation = continuationPenPathRef.current;
        const resumed =
          selectedPenPathNodeId === undefined ||
          selectedPenPathNodeId === continuation.nodeId
            ? resumePenPathAtEnd(
                continuation.path,
                rawPoint,
                PEN_CLOSE_HIT_RADIUS_SCREEN_PX / (zoomRef.current / 100),
              )
            : null;
        if (resumed) {
          suppressNextPick.current = true;
          activePenPathRef.current = resumed;
          setActivePenPath(resumed);
          setPenGesturePreview(null);
          setPenPointer(null);
          setPenCloseHover(false);
          return;
        }
        continuationPenPathRef.current = null;
      }
      const closing = Boolean(
        pathBefore &&
        isPenCloseTarget(
          pathBefore,
          rawPoint,
          PEN_CLOSE_HIT_RADIUS_SCREEN_PX / (zoomRef.current / 100),
        ),
      );

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
        cuspLatch: createPenCuspLatch(),
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
          const closedPreviewPath = shapeClosingHandles(
            state.pathBefore as PenPath,
            state.hasMoved ? handleOut : null,
          );
          setPenGesturePreview(closedPreviewPath);
          return;
        }

        const node = state.hasMoved
          ? createPenDragNode(
              state.anchor,
              handleOut,
              state.cuspLatch,
              ev.altKey,
            )
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
          ? createPenDragNode(
              state.anchor,
              handleOut,
              state.cuspLatch,
              ev.altKey,
            )
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
      selectedPenPathNodeId,
    ],
  );

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
        if (!state.hasMoved) {
          if (
            Math.hypot(
              ev.clientX - state.originClient.x,
              ev.clientY - state.originClient.y,
            ) < DRAG_THRESHOLD
          ) {
            return;
          }
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
        active.onSelectedAnchorChange(state.nodeIndex);
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          active.originCanvas,
        );
        const nextPath = state.hasMoved
          ? movePenAnchor(state.pathBefore, state.nodeIndex, localPoint)
          : state.pathBefore;
        const changed =
          serializePenNodes(nextPath) !== serializePenNodes(state.pathBefore);
        if (changed) {
          active.onChange(nextPath, "commit");
        } else if (state.hasMoved) {
          active.onChange(nextPath, "preview");
        }
        finishDrag();
      };

      const cancelGesture = () => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (state?.type === "vector-anchor" && state.hasMoved && active) {
          active.onChange(clonePenPath(state.pathBefore), "preview");
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
        symmetryBroken: false,
      };
      setIsDragging(true);
      setDragCursor("crosshair");

      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "vector-handle") return;
        const active = vectorEditRef.current;
        if (!active) return;
        if (!state.hasMoved) {
          if (
            Math.hypot(
              ev.clientX - state.originClient.x,
              ev.clientY - state.originClient.y,
            ) < DRAG_THRESHOLD
          ) {
            return;
          }
          state.hasMoved = true;
        }
        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          active.originCanvas,
        );
        if (ev.altKey) state.symmetryBroken = true;
        const nextPath = movePenHandle(
          state.pathBefore,
          state.nodeIndex,
          state.which,
          localPoint,
          { breakSymmetry: state.symmetryBroken },
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
        if (ev.altKey) state.symmetryBroken = true;
        const nextPath = state.hasMoved
          ? movePenHandle(
              state.pathBefore,
              state.nodeIndex,
              state.which,
              localPoint,
              { breakSymmetry: state.symmetryBroken },
            )
          : state.pathBefore;
        const changed =
          serializePenNodes(nextPath) !== serializePenNodes(state.pathBefore);
        if (changed) {
          active.onChange(nextPath, "commit");
        } else if (state.hasMoved) {
          active.onChange(nextPath, "preview");
        }
        finishDrag();
      };

      const cancelGesture = () => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (state?.type === "vector-handle" && state.hasMoved && active) {
          active.onChange(clonePenPath(state.pathBefore), "preview");
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

  const beginVectorSegmentBend = useCallback(
    (segmentIndex: number, t: number, e: React.MouseEvent) => {
      if (!vectorEdit || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      claimKeyboardFocus();
      dragState.current = {
        type: "vector-segment",
        originClient: { x: e.clientX, y: e.clientY },
        originLocal: vectorEditCanvasToLocalPoint(
          getCanvasPoint(e.clientX, e.clientY),
          vectorEdit.originCanvas,
        ),
        segmentIndex,
        t,
        pathBefore: clonePenPath(vectorEdit.path),
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor("move");

      const pathAtPointer = (ev: MouseEvent) => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (!state || state.type !== "vector-segment" || !active) return null;
        const local = vectorEditCanvasToLocalPoint(
          getCanvasPoint(ev.clientX, ev.clientY),
          active.originCanvas,
        );
        return bendPenSegment(state.pathBefore, state.segmentIndex, state.t, {
          x: local.x - state.originLocal.x,
          y: local.y - state.originLocal.y,
        });
      };
      const handleMouseMove = (ev: MouseEvent) => {
        const state = dragState.current;
        if (!state || state.type !== "vector-segment") return;
        if (
          !state.hasMoved &&
          Math.hypot(
            ev.clientX - state.originClient.x,
            ev.clientY - state.originClient.y,
          ) >= DRAG_THRESHOLD
        ) {
          state.hasMoved = true;
        }
        const next = state.hasMoved ? pathAtPointer(ev) : null;
        if (next) vectorEditRef.current?.onChange(next, "preview");
      };
      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (state?.type === "vector-segment" && active && state.hasMoved) {
          const next = pathAtPointer(ev);
          if (next) active.onChange(next, "commit");
        }
        finishDrag();
      };
      const cancelGesture = () => {
        const state = dragState.current;
        const active = vectorEditRef.current;
        if (state?.type === "vector-segment" && state.hasMoved && active) {
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

      const rawOriginCanvas = getCanvasPoint(e.clientX, e.clientY);
      const originFrameId = getFrameEntryAtPoint(rawOriginCanvas)?.id;
      const creationSnapStep = resolveBoardSnapStepForFrame(originFrameId);
      const originCanvas = quantizeCanvasPoint(
        rawOriginCanvas,
        creationSnapStep,
      );
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
        const nextCanvas = quantizeCanvasPoint(
          getCanvasPoint(ev.clientX, ev.clientY),
          creationSnapStep,
        );
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

        const endCanvas = quantizeCanvasPoint(
          getCanvasPoint(ev.clientX, ev.clientY),
          creationSnapStep,
        );
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
        if (
          state.tool === "frame" &&
          frameToolDraws === "screen" &&
          !state.originFrameId &&
          onCreateScreenFrame
        ) {
          const draftGeometry = getDraftGeometryForTool(
            state.tool,
            state.originCanvas,
            endCanvas,
            modifiers,
          );
          const surfaceRect = surfaceRef.current?.getBoundingClientRect();
          const viewportBounds = surfaceRect
            ? getOverscannedViewportCanvasBounds(
                { width: surfaceRect.width, height: surfaceRect.height },
                panRef.current,
                zoomRef.current,
                0,
              )
            : null;
          const screenGeometry = clampFrameGeometryToViewport(
            draftGeometry,
            viewportBounds,
          );
          trace("screen", "create-from-frame-tool", {
            why: "frame tool started on empty canvas, so it becomes a SCREEN",
            drawn: roundGeo(draftGeometry),
            committed: roundGeo(screenGeometry),
            clamped:
              Math.round(draftGeometry.x) !== Math.round(screenGeometry.x) ||
              Math.round(draftGeometry.y) !== Math.round(screenGeometry.y),
          });
          onCreateScreenFrame(screenGeometry);
          if (activeTool === undefined) {
            setLocalActiveTool("move");
          }
          onActiveToolChange?.("move");
          finishDrag();
          return;
        }
        trace("draw", "commit-primitive", {
          tool: state.tool,
          startedInScreen: state.originFrameId ?? "(empty canvas → board)",
        });
        const nextDraft = createDraftPrimitive({
          tool: state.tool,
          start: state.originCanvas,
          end: endCanvas,
          moved: releaseMoved,
          toolProps,
          modifiers,
        });
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
      frameToolDraws,
      getCanvasPoint,
      getFrameEntryAtPoint,
      installDragListeners,
      onActiveToolChange,
      onCreateScreenFrame,
      resolveBoardSnapStepForFrame,
      toolProps,
    ],
  );

  const beginDraftDrag = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (readOnly) return;
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

      beginSnapGesture();
      dragState.current = {
        type: "draft-move",
        originClient: { x: e.clientX, y: e.clientY },
        originDrafts,
        targetIds,
        primaryId: id,
        hasMoved: false,
      };
      setIsDragging(true);

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

        if (!state.hasMoved) return;

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
        const stationaryEntries = getSnapCandidateEntries(state.targetIds);
        const snap = computeDragSnap(movingEntries, stationaryEntries, {
          thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
          zoom: zoomRef.current,
          bypass: ev.metaKey || ev.ctrlKey,
          snapStep: resolveSnapStepForTargets(
            state.targetIds,
            frameGeometryCenter(movingEntries[0]?.geometry),
          ),
          lockedAxes: ev.shiftKey ? { x: dx === 0, y: dy === 0 } : undefined,
        });

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
        setEqualGapGuides(snap.spacingGuides);
        setProximityMeasurements(snap.measurements);

        const canvasPoint = getCanvasPoint(ev.clientX, ev.clientY);
        const primitiveTarget = findPrimitiveDropTarget(canvasPoint, null);
        updatePrimitiveDropTarget(primitiveTarget);
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        const dropTarget = primitiveDropTargetRef.current;
        if (state?.type === "draft-move" && state.hasMoved) {
          updateDraftPrimitives(() => draftPrimitivesRef.current);
          if (dropTarget) {
            const persisted: Array<{
              draftId: string;
              frameId: string;
              nodeId: string;
              preparedTargetNodeId?: string;
              preparedTargetIdentity?: ScreenProjectionNodeIdentity;
            }> = [];
            let preparedReparentTargetIdentity = dropTarget.targetIdentity;
            draftPrimitivesRef.current.forEach((draft) => {
              if (!state.targetIds.includes(draft.id)) return;
              const result = persistDraftPrimitive(draft, dropTarget.screenId, {
                reparentTargetIdentity: preparedReparentTargetIdentity,
              });
              if (result) {
                persisted.push({
                  draftId: draft.id,
                  frameId: result.frameId,
                  nodeId: result.nodeId,
                  preparedTargetNodeId: result.preparedTargetNodeId,
                  preparedTargetIdentity: result.preparedTargetIdentity,
                });
                preparedReparentTargetIdentity =
                  result.preparedTargetIdentity ??
                  preparedReparentTargetIdentity;
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
              persisted.forEach((entry) => {
                onPrimitiveReparentRef.current?.({
                  sourceNodeId: entry.nodeId,
                  sourceScreenId: entry.frameId,
                  targetNodeId:
                    entry.preparedTargetNodeId ??
                    dropTarget.anchorNodeId ??
                    dropTarget.nodeId,
                  targetScreenId: dropTarget.screenId,
                  targetIdentity:
                    entry.preparedTargetIdentity ?? dropTarget.targetIdentity,
                  preparedTargetNodeId: entry.preparedTargetNodeId,
                  placement: dropTarget.placement ?? "inside",
                });
              });
              const lastPersisted = persisted[persisted.length - 1];
              if (lastPersisted) {
                updateSelectedIds(() =>
                  screensRef.current.some(
                    (screen) => screen.id === lastPersisted.frameId,
                  )
                    ? [lastPersisted.frameId]
                    : [],
                );
                if (
                  lastPersisted.frameId !== boardFileId &&
                  lastPersisted.frameId !== "__board__"
                ) {
                  onPrimitiveCreated?.(
                    lastPersisted.frameId,
                    lastPersisted.nodeId,
                  );
                }
              }
            }
          } else {
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
              const lastPersisted = persisted[persisted.length - 1];
              if (lastPersisted) {
                updateSelectedIds(() =>
                  screensRef.current.some(
                    (screen) => screen.id === lastPersisted.frameId,
                  )
                    ? [lastPersisted.frameId]
                    : [],
                );
                if (
                  lastPersisted.frameId !== boardFileId &&
                  lastPersisted.frameId !== "__board__"
                ) {
                  onPrimitiveCreated?.(
                    lastPersisted.frameId,
                    lastPersisted.nodeId,
                  );
                }
              }
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
      boardFileId,
      onPrimitiveCreated,
      persistDraftPrimitive,
      updateDraftPrimitives,
      updateDraftPrimitivesRefOnly,
      updatePrimitiveDropTarget,
      updateSelectedDraftIds,
      updateSelectedIds,
      frameGeometryCenter,
      resolveSnapStepForTargets,
    ],
  );

  const beginDraftResize = useCallback(
    (id: string, handle: ResizeHandle, e: React.MouseEvent) => {
      if (readOnly) return;
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

      const resizedDraftEls = new Map<string, HTMLElement>();
      targetIds.forEach((targetId) => {
        const el = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-draft-id="${CSS.escape(targetId)}"]`,
        );
        if (el) resizedDraftEls.set(targetId, el);
      });
      const selectionBoxEl = surfaceRef.current?.querySelector<HTMLElement>(
        "[data-frame-selection-box]",
      );

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

        if (!state.hasMoved) return;

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
            snapStep: resolveSnapStepForTargets(
              state.targetIds,
              frameGeometryCenter(resized.bounds),
            ),
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
        const scaleK = effectiveToolRef.current === "scale";

        updateDraftPrimitivesRefOnly((current) =>
          current.map((draft) => {
            const origin = state.originDrafts[draft.id];
            const geometry = resizedById[draft.id];
            if (!origin || !geometry) return draft;
            return applyDraftGeometry(origin, geometry, scaleK);
          }),
        );
        state.targetIds.forEach((targetId) => {
          const draft = draftPrimitivesRef.current.find(
            (candidate) => candidate.id === targetId,
          );
          const el = resizedDraftEls.get(targetId);
          if (draft && el) applyDraftPrimitiveToDom(el, draft);
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
            selectionBoxEl.style.width = `${bounds.width}px`;
            selectionBoxEl.style.height = `${bounds.height}px`;
            const rotation =
              targetGeometries.length === 1
                ? (targetGeometries[0].rotation ?? 0)
                : 0;
            selectionBoxEl.style.transform = rotation
              ? `rotate(${rotation}deg)`
              : "";
            selectionBoxEl.style.transformOrigin = `${bounds.width / 2}px ${bounds.height / 2}px`;
          }
        }
        setAlignmentGuides(snap.guides);
        showTransformFeedback(
          `${Math.round(snap.frame.width)} x ${Math.round(snap.frame.height)}`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "draft-resize" && state.hasMoved) {
          updateDraftPrimitives(() => draftPrimitivesRef.current);
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      finishDrag,
      getCurrentCanvasEntries,
      installDragListeners,
      showTransformFeedback,
      updateDraftPrimitives,
      updateDraftPrimitivesRefOnly,
      updateSelectedDraftIds,
      updateSelectedIds,
      frameGeometryCenter,
      resolveSnapStepForTargets,
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

  const beginDuplicateGesture = useCallback(
    (id: string, e: React.MouseEvent) => {
      const entries = getCurrentFrameEntries();
      const selection = selectedIdsRef.current;
      const targets = (selection.includes(id) ? selection : [id])
        .filter((targetId) => !lockedScreenIdSet.has(targetId))
        .flatMap((targetId) => {
          const target = screensRef.current.find((s) => s.id === targetId);
          const geometry = entries.find(
            (entry) => entry.id === targetId,
          )?.geometry;
          return target && geometry ? [{ screen: target, geometry }] : [];
        });
      const source = targets.find((target) => target.screen.id === id);
      if (!source) return;
      e.preventDefault();
      e.stopPropagation();
      duplicateCleanup.current?.();

      const display = screenDisplayName(
        source.screen,
        getResolvedMetadata(source.screen),
      );
      const surfaceRect = surfaceRef.current?.getBoundingClientRect();
      const origin = { x: e.clientX, y: e.clientY };
      const originCanvas = canvasPointFromClient(e.clientX, e.clientY);
      const previewPoint = {
        x: surfaceRect ? e.clientX - surfaceRect.left + 16 : e.clientX,
        y: surfaceRect ? e.clientY - surfaceRect.top + 16 : e.clientY,
      };

      const previewWidth = source.geometry.width;
      const previewHeight = source.geometry.height;

      setDuplicatePreview({
        display,
        count: targets.length,
        x: previewPoint.x,
        y: previewPoint.y,
        width: previewWidth,
        height: previewHeight,
        canDuplicate: !!onDuplicate,
        moved: false,
      });
      setIsDragging(true);
      setDragCursor(e.altKey ? "copy" : null);

      let lastCanDuplicate = !!onDuplicate;
      let lastMoved = false;
      let lastCursor: string | null = e.altKey ? "copy" : null;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - origin.x;
        const dy = ev.clientY - origin.y;
        const moved = Math.hypot(dx, dy) >= DUPLICATE_DRAG_THRESHOLD;
        const rect = surfaceRef.current?.getBoundingClientRect();
        const x = rect ? ev.clientX - rect.left + 16 : ev.clientX;
        const y = rect ? ev.clientY - rect.top + 16 : ev.clientY;
        const canDuplicate = !!onDuplicate && ev.altKey;

        const el = duplicatePreviewElRef.current;
        if (el) {
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        }

        if (!el || canDuplicate !== lastCanDuplicate || moved !== lastMoved) {
          lastCanDuplicate = canDuplicate;
          lastMoved = moved;
          setDuplicatePreview({
            display,
            count: targets.length,
            x,
            y,
            width: previewWidth,
            height: previewHeight,
            canDuplicate,
            moved,
          });
        }

        const cursor = ev.altKey ? "copy" : null;
        if (cursor !== lastCursor) {
          lastCursor = cursor;
          setDragCursor(cursor);
        }
      };

      const cleanupDuplicateGesture = () => {
        setDuplicatePreview(null);
        duplicateCleanup.current = null;
        finishDrag();
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const moved =
          Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) >=
          DUPLICATE_DRAG_THRESHOLD;
        const shouldDuplicate = moved && ev.altKey;

        if (onDuplicate && shouldDuplicate) {
          suppressNextPick.current = true;
          const dropCanvasPosition = canvasPointFromClient(
            ev.clientX,
            ev.clientY,
          );
          const delta = {
            x: dropCanvasPosition.x - originCanvas.x,
            y: dropCanvasPosition.y - originCanvas.y,
          };
          lineupRecenterSuppressRef.current = {
            atMs: Date.now(),
            fromCount: screensRef.current.length,
            addedCount: targets.length,
          };
          const historyBatchId = `duplicate-${++duplicateBatchSequenceRef.current}`;
          const duplicateTargets = targets
            .map((target, index) => ({ target, index }))
            .sort(
              (left, right) =>
                (left.target.geometry.z ?? 0) -
                  (right.target.geometry.z ?? 0) || left.index - right.index,
            );
          const duplicateResults = duplicateTargets.map(({ target }, index) => {
            const canvasPosition = {
              x: target.geometry.x + delta.x,
              y: target.geometry.y + delta.y,
            };
            return onDuplicate(target.screen.id, {
              mode: "alt-drag",
              screen: target.screen,
              canvasPosition,
              preserveCamera: true,
              historyBatchId,
              duplicateStackIndex: index,
              canvasOffset: {
                x: dropCanvasPosition.x - canvasPosition.x,
                y: dropCanvasPosition.y - canvasPosition.y,
              },
              dropCanvasPosition,
            });
          });
          selectCompletedDuplicates(duplicateResults);
        } else if (!moved) {
          onPick(id);
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
      getResolvedMetadata,
      installDragListeners,
      lockedScreenIdSet,
      onDuplicate,
      onPick,
      selectCompletedDuplicates,
    ],
  );

  const handleFrameClick = useCallback(
    (id: string, e: React.MouseEvent<HTMLElement> | MouseEvent) => {
      e.stopPropagation();
      if (lockedScreenIdSet.has(id)) return;
      if (suppressNextPick.current) {
        suppressNextPick.current = false;
        return;
      }
      drillInRequestRef.current += 1;

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
    [
      activeId,
      lockedScreenIdSet,
      onPick,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const beginFrameDrag = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (readOnly) return;
      if (e.button !== 0 || lockedScreenIdSet.has(id)) return;
      if (e.altKey) {
        beginDuplicateGesture(id, e);
        return;
      }
      if (e.shiftKey && !selectedIdsRef.current.includes(id)) return;
      e.preventDefault();
      e.stopPropagation();
      suppressNextPick.current = false;

      const currentSelectedIds = selectedIdsRef.current;
      const targetIds = currentSelectedIds.includes(id)
        ? currentSelectedIds
        : [id];
      const wasAlreadySelected = currentSelectedIds.includes(id);
      if (e.shiftKey && !wasAlreadySelected) return;
      if (!e.shiftKey) {
        if (activeId !== id) {
          onPick(id);
        }
        if (!currentSelectedIds.includes(id)) {
          updateSelectedIds(() => [id]);
        }
      }
      updateSelectedDraftIds(() => []);

      const entries = getCurrentFrameEntries();
      const originFrames = Object.fromEntries(
        entries
          .filter((entry) => targetIds.includes(entry.id))
          .map((entry) => [entry.id, entry.geometry]),
      ) as FrameGeometryById;
      if (!originFrames[id]) return;

      beginSnapGesture();
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

      // The surface itself never moves mid-gesture, so its bounding rect is
      // invariant for the whole drag. Cache it once instead of letting the
      // allCommitted/getCanvasPoint branch below call getBoundingClientRect
      // on every tick — that read would force a synchronous layout reflow
      // right after this same tick's direct style writes (a classic
      // write-then-read thrash), scoped to primitive/layer drags specifically
      // (the only path that reaches that branch).
      const cachedSurfaceRect = surfaceRef.current?.getBoundingClientRect();
      const getCanvasPointFromCachedRect = (clientX: number, clientY: number) =>
        cachedSurfaceRect
          ? screenToCanvasPoint(
              { x: clientX, y: clientY },
              { ...panRef.current, zoom: zoomRef.current },
              { x: cachedSurfaceRect.left, y: cachedSurfaceRect.top },
              SURFACE_PADDING,
            )
          : getCanvasPoint(clientX, clientY);

      const frameLabelHeight =
        FRAME_LABEL_HEIGHT * chromeScaleFromZoom(zoomRef.current);
      const draggedFrameEls = new Map<string, HTMLElement>();
      const draggedFrameOriginPositions = new Map<
        string,
        { left: number; top: number }
      >();
      targetIds.forEach((targetId) => {
        const el = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-frame-id="${CSS.escape(targetId)}"]`,
        );
        if (!el) return;
        draggedFrameEls.set(targetId, el);
      });
      let selectionBoxEl: HTMLElement | null = null;
      let selectionBoxOriginPosition: { left: number; top: number } | null =
        null;

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

        if (!state.hasMoved) return;

        ({ x: dx, y: dy } = constrainCanvasDragDelta(
          { x: dx, y: dy },
          ev.shiftKey,
        ));

        const movingEntries = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: {
            ...state.originFrames[targetId],
            x: state.originFrames[targetId].x + dx,
            y: state.originFrames[targetId].y + dy,
          },
        }));
        const stationaryEntries = getSnapCandidateEntries(
          state.targetIds,
          getCurrentFrameEntries(),
        );
        const snap = computeDragSnap(movingEntries, stationaryEntries, {
          thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
          zoom: zoomRef.current,
          bypass: ev.metaKey || ev.ctrlKey,
          snapStep: resolveSnapStepForTargets(
            state.targetIds,
            frameGeometryCenter(movingEntries[0]?.geometry),
          ),
          lockedAxes: ev.shiftKey ? { x: dx === 0, y: dy === 0 } : undefined,
        });

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
            let originPosition = draggedFrameOriginPositions.get(targetId);
            if (!originPosition) {
              const fallback = frameStyleLeftTop(
                state.originFrames[targetId],
                frameLabelHeight,
              );
              const renderedLeft = Number.parseFloat(el.style.left);
              const renderedTop = Number.parseFloat(el.style.top);
              originPosition = {
                left: Number.isFinite(renderedLeft)
                  ? renderedLeft
                  : fallback.left,
                top: Number.isFinite(renderedTop) ? renderedTop : fallback.top,
              };
              draggedFrameOriginPositions.set(targetId, originPosition);
            }
            if (!originPosition) return;
            const moveX = dx + snap.dx;
            const moveY = dy + snap.dy;
            const nextPosition = {
              left: originPosition.left + moveX,
              top: originPosition.top + moveY,
            };
            liveFrameDragPositionsRef.current.set(targetId, nextPosition);
            el.style.left = `${nextPosition.left}px`;
            el.style.top = `${nextPosition.top}px`;
          });
          if (!selectionBoxEl) {
            selectionBoxEl =
              surfaceRef.current?.querySelector<HTMLElement>(
                "[data-frame-selection-box]",
              ) ?? null;
          }
          if (selectionBoxEl) {
            if (!selectionBoxOriginPosition) {
              const left = Number.parseFloat(selectionBoxEl.style.left);
              const top = Number.parseFloat(selectionBoxEl.style.top);
              if (Number.isFinite(left) && Number.isFinite(top)) {
                selectionBoxOriginPosition = { left, top };
              }
            }
            if (selectionBoxOriginPosition) {
              const nextPosition = {
                left: selectionBoxOriginPosition.left + dx + snap.dx,
                top: selectionBoxOriginPosition.top + dy + snap.dy,
              };
              liveFrameDragSelectionPositionRef.current = nextPosition;
              selectionBoxEl.style.left = `${nextPosition.left}px`;
              selectionBoxEl.style.top = `${nextPosition.top}px`;
            }
          }
        }
        setAlignmentGuides(snap.guides);
        setEqualGapGuides(snap.spacingGuides);
        setProximityMeasurements(snap.measurements);

        const currentFrameIds = Object.keys(frameGeometryRef.current);
        const allCommitted = state.targetIds.every(
          (targetId) => !currentFrameIds.includes(targetId),
        );
        if (allCommitted) {
          const canvasPoint = getCanvasPointFromCachedRect(
            ev.clientX,
            ev.clientY,
          );
          updatePrimitiveDropTarget(
            findPrimitiveDropTarget(canvasPoint, state.primaryId),
          );
        }
      };

      const handleMouseUp = (ev: MouseEvent) => {
        const state = dragState.current;
        const dropTarget = primitiveDropTargetRef.current;
        if (state?.type === "move" && !state.hasMoved) {
          updateFrameGeometry((current) =>
            frameGeometryWithOverrides(current, state.originFrames),
          );
          if (ev.shiftKey) {
            handleFrameClick(id, ev);
            suppressNextPick.current = true;
          } else if (wasAlreadySelected) {
            drillIntoScreenAtPoint(id, ev.clientX, ev.clientY, "pick", ev);
          }
        }
        if (state?.type === "move" && state.hasMoved) {
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
                targetNodeId: dropTarget.anchorNodeId ?? dropTarget.nodeId,
                targetScreenId: dropTarget.screenId,
                targetIdentity: dropTarget.targetIdentity,
                placement: dropTarget.placement ?? "inside",
              });
              suppressNextPick.current = true;
              finishDrag();
              return;
            }
          }

          const after = cloneFrameGeometryById(frameGeometryRef.current);
          setFrameGeometry(after);
          onGeometryChangeRef.current?.(after);
          onGeometryCommitRef.current?.(
            frameGeometryWithOverrides(after, state.originFrames),
            after,
          );
          dndHostLog("overview:frame-commit", { ids: state.targetIds });
          suppressNextPick.current = true;
        }
        finishDrag();
      };

      installDragListeners(handleMouseMove, handleMouseUp);
    },
    [
      activeId,
      beginDuplicateGesture,
      drillIntoScreenAtPoint,
      findPrimitiveDropTarget,
      finishDrag,
      getCanvasPoint,
      getCurrentFrameEntries,
      handleFrameClick,
      installDragListeners,
      lockedScreenIdSet,
      onPick,
      readOnly,
      resolvePrimitiveScreenId,
      updateFrameGeometry,
      updateFrameGeometryRefOnly,
      updatePrimitiveDropTarget,
      updateSelectedDraftIds,
      updateSelectedIds,
      frameGeometryCenter,
      resolveSnapStepForTargets,
    ],
  );

  const beginResize = useCallback(
    (id: string, handle: ResizeHandle, e: React.MouseEvent) => {
      if (readOnly) return;
      if (e.button !== 0 || lockedScreenIdSet.has(id)) return;
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
      const originEntries = getCurrentFrameEntries()
        .filter((entry) => targetIds.includes(entry.id))
        .map((entry) => ({
          ...entry,
          geometry:
            renderedFrameGeometryRef.current[entry.id] ?? entry.geometry,
        }));
      const originBounds = getFrameGroupBounds(originEntries);
      if (!originBounds || originEntries.length === 0) return;
      updateSelectedIds((current) => (current.includes(id) ? current : [id]));

      let scaleContents = effectiveToolRef.current === "scale";
      const scaleContentTargets: string[] = [];
      if (scaleContents) {
        for (const entry of originEntries) {
          if (scaleScreenContents(entry.id, 1, "begin") === null) {
            scaleContents = false;
            break;
          }
          scaleContentTargets.push(entry.id);
        }
        if (!scaleContents) {
          scaleContentTargets.forEach((screenId) => {
            scaleScreenContents(screenId, 1, "cancel");
          });
        }
      }

      dragState.current = {
        type: "resize",
        originClient: { x: e.clientX, y: e.clientY },
        originFrames: Object.fromEntries(
          originEntries.map((entry) => [entry.id, entry.geometry]),
        ) as FrameGeometryById,
        originBounds: frameBoundsToGeometry(originBounds),
        targetIds: originEntries.map((entry) => entry.id),
        handle,
        scaleContents,
        hasMoved: false,
      };
      setIsDragging(true);
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

        if (!state.hasMoved) return;

        const originEntries = state.targetIds.map((targetId) => ({
          id: targetId,
          geometry: state.originFrames[targetId],
        }));
        const frameSizeBoundsById = Object.fromEntries(
          originEntries.map((entry) => [
            entry.id,
            screenSizeConstraintsToFrameBounds(
              readScreenSizeConstraints(
                screenRootComputedStylesById?.[entry.id],
              ),
            ),
          ]),
        );
        const scaleK = state.scaleContents;
        const lockAspectRatio = ev.shiftKey || scaleK;
        const resizeOptions = {
          preserveAspectRatio: lockAspectRatio,
          resizeFromCenter: ev.altKey,
          minWidth: 1,
          minHeight: 1,
          frameSizeBoundsById,
        };

        const singleRotatedFrame =
          originEntries.length === 1 &&
          (originEntries[0].geometry.rotation ?? 0)
            ? originEntries[0]
            : null;

        if (singleRotatedFrame) {
          const { frame: resizedGeometry, guides: rotatedSnapGuides } =
            resizeRotatedFrameFromDeltaWithSnap(
              singleRotatedFrame.geometry,
              state.handle,
              dx,
              dy,
              getCurrentFrameEntries().filter(
                (entry) => !state.targetIds.includes(entry.id),
              ),
              {
                thresholdScreenPx: DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
                zoom: zoomRef.current,
                bypass: ev.metaKey || ev.ctrlKey,
                preserveAspectRatio: lockAspectRatio,
                ...frameSizeBoundsById[singleRotatedFrame.id],
                resizeFromCenter: ev.altKey,
              },
              {
                ...resizeOptions,
                ...frameSizeBoundsById[singleRotatedFrame.id],
              },
            );
          updateFrameGeometryPreview((current) => ({
            ...current,
            [singleRotatedFrame.id]: {
              ...state.originFrames[singleRotatedFrame.id],
              ...resizedGeometry,
            },
          }));
          if (state.scaleContents) {
            scaleScreenContents(
              singleRotatedFrame.id,
              resizedGeometry.width /
                Math.max(1, singleRotatedFrame.geometry.width),
              "preview",
            );
          }
          setAlignmentGuides(rotatedSnapGuides);
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
          resizeOptions,
        );
        const groupSizeBounds = getFrameGroupSizeBounds(
          originEntries,
          state.originBounds,
          resizeOptions,
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
            ...groupSizeBounds,
            resizeFromCenter: ev.altKey,
            preserveAspectRatio: lockAspectRatio,
            snapStep: resolveSnapStepForTargets(
              state.targetIds,
              frameGeometryCenter(resized.bounds),
            ),
          },
        );
        const resizedEntries = resizeFrameGroupToBounds(
          originEntries,
          state.originBounds,
          snap.frame,
        );
        if (state.scaleContents) {
          resizedEntries.forEach((entry) => {
            scaleScreenContents(
              entry.id,
              entry.geometry.width /
                Math.max(1, state.originFrames[entry.id].width),
              "preview",
            );
          });
        }
        updateFrameGeometryPreview((current) => {
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
          updateFrameGeometryPreview((current) =>
            frameGeometryWithOverrides(current, state.originFrames),
          );
        }
        if (state?.type === "resize" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          const kScaleStyleChangesByFrameId: KScaleStyleChangesByFrameId = {};
          let missingKScaleTarget = false;
          if (state.scaleContents) {
            state.targetIds.forEach((screenId) => {
              const origin = state.originFrames[screenId];
              const finalGeometry = after[screenId];
              if (!origin || !finalGeometry) {
                missingKScaleTarget = true;
                return;
              }
              const changes = scaleScreenContents(
                screenId,
                finalGeometry.width / Math.max(1, origin.width),
                "commit",
              );
              if (changes === null) {
                missingKScaleTarget = true;
                return;
              }
              kScaleStyleChangesByFrameId[screenId] = changes;
            });
          }
          const before = frameGeometryWithOverrides(after, state.originFrames);
          const committed = missingKScaleTarget
            ? false
            : onGeometryCommitRef.current?.(
                before,
                after,
                Object.keys(kScaleStyleChangesByFrameId).length > 0
                  ? { kScaleStyleChangesByFrameId }
                  : undefined,
              );
          if (committed === false) {
            if (state.scaleContents) {
              state.targetIds.forEach((screenId) =>
                scaleScreenContents(screenId, 1, "cancel"),
              );
            }
            setFrameGeometry(before);
            onGeometryChangeRef.current?.(before);
            updateFrameGeometryPreview((current) =>
              frameGeometryWithOverrides(current, state.originFrames),
            );
          } else {
            setFrameGeometry(after);
            onGeometryChangeRef.current?.(after);
            if (state.scaleContents) {
              state.targetIds.forEach((screenId) =>
                scaleScreenContents(screenId, 1, "accept"),
              );
            }
          }
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
      lockedScreenIdSet,
      onPick,
      showTransformFeedback,
      updateFrameGeometryPreview,
      updateSelectedIds,
      frameGeometryCenter,
      resolveSnapStepForTargets,
      screenRootComputedStylesById,
      scaleScreenContents,
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

  const beginBoardElementResize = useCallback(
    (handle: ResizeHandle, e: React.MouseEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      if (!boardFileId || !boardSurfaceRenderGeometry) return;
      const iframe = findCanvasIframeForScreen(
        surfaceRef.current,
        boardFileId,
        boardFileId,
      );
      const iframeDoc = iframe?.contentWindow?.document;
      if (!iframeDoc) {
        dndHostLog("board-resize:no-iframe", { boardFileId });
        return;
      }
      const handleEl =
        iframeDoc.querySelector<HTMLElement>(
          `[data-agent-native-edge-handle="${handle}"]`,
        ) ??
        iframeDoc.querySelector<HTMLElement>(
          `[data-agent-native-edit-handle="${handle}"]`,
        );
      if (!handleEl) {
        dndHostLog("board-resize:no-handle-el", { handle });
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const toIframePoint = (clientX: number, clientY: number) =>
        boardPointToBoardSurfaceLocalPoint(
          getCanvasPoint(clientX, clientY),
          boardSurfaceRenderGeometryRef.current ?? boardSurfaceRenderGeometry,
        );
      const dispatchAt = (
        target: EventTarget,
        type: string,
        point: { x: number; y: number },
        source: { shiftKey: boolean; altKey: boolean },
        buttons: number,
      ) => {
        target.dispatchEvent(
          new MouseEvent(type, {
            clientX: point.x,
            clientY: point.y,
            shiftKey: source.shiftKey,
            altKey: source.altKey,
            buttons,
            bubbles: true,
            cancelable: true,
          }),
        );
      };

      setIsDragging(true);
      dispatchAt(
        handleEl,
        "mousedown",
        toIframePoint(e.clientX, e.clientY),
        e,
        1,
      );

      const handleMouseMove = (ev: MouseEvent) => {
        dispatchAt(
          iframeDoc,
          "mousemove",
          toIframePoint(ev.clientX, ev.clientY),
          ev,
          1,
        );
      };
      const handleMouseUp = (ev: MouseEvent) => {
        dispatchAt(
          iframeDoc,
          "mouseup",
          toIframePoint(ev.clientX, ev.clientY),
          ev,
          0,
        );
        finishDrag();
      };
      const cancelResize = (pressedAt: number) => {
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt },
          "*",
        );
        crossScreenControlPressedRef.current = false;
      };
      boardElementResizeCancel.current = cancelResize;
      installDragListeners(handleMouseMove, handleMouseUp, () => {
        cancelResize(performance.timeOrigin + performance.now());
        finishDrag();
      });
    },
    [
      boardFileId,
      boardSurfaceRenderGeometry,
      finishDrag,
      getCanvasPoint,
      installDragListeners,
      readOnly,
    ],
  );

  const beginBoardElementDrag = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
      if (e.button !== 0) return;
      if (!boardFileId || !boardSurfaceRenderGeometry) return;
      const iframe = findCanvasIframeForScreen(
        surfaceRef.current,
        boardFileId,
        boardFileId,
      );
      const iframeDoc = iframe?.contentWindow?.document;
      if (!iframeDoc) {
        dndHostLog("board-move:no-iframe", { boardFileId });
        return;
      }
      const selectionOverlay = iframeDoc.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="selection"]',
      );
      if (!selectionOverlay) {
        dndHostLog("board-move:no-selection-overlay", { boardFileId });
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const toIframePoint = (clientX: number, clientY: number) =>
        boardPointToBoardSurfaceLocalPoint(
          getCanvasPoint(clientX, clientY),
          boardSurfaceRenderGeometryRef.current ?? boardSurfaceRenderGeometry,
        );
      const dispatchAt = (
        target: EventTarget,
        type: string,
        point: { x: number; y: number },
        source: {
          shiftKey: boolean;
          altKey: boolean;
          metaKey: boolean;
          ctrlKey: boolean;
          ignoreAutoLayout?: boolean;
        },
        buttons: number,
      ) => {
        const event = new MouseEvent(type, {
          clientX: point.x,
          clientY: point.y,
          shiftKey: source.shiftKey,
          altKey: source.altKey,
          metaKey: source.metaKey,
          ctrlKey: source.ctrlKey,
          buttons,
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "__agentNativeIgnoreAutoLayout", {
          configurable: true,
          value: source.ignoreAutoLayout === true,
        });
        target.dispatchEvent(event);
      };

      const pressModifiers = {
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
      };
      let bridgeDragStarted = false;
      const startBridgeDrag = () => {
        if (bridgeDragStarted) return;
        bridgeDragStarted = true;
        const ignoreAutoLayout =
          crossScreenIgnoreAutoLayoutRef.current ||
          crossScreenControlPressedRef.current ||
          (isApplePlatform() &&
            pressModifiers.ctrlKey &&
            !pressModifiers.metaKey);
        iframe.contentWindow?.postMessage(
          {
            type: "agent-native:drag-modifiers",
            ignoreAutoLayout,
          },
          "*",
        );
        dispatchAt(
          selectionOverlay,
          "mousedown",
          toIframePoint(e.clientX, e.clientY),
          { ...pressModifiers, ignoreAutoLayout },
          1,
        );
      };

      setIsDragging(true);

      const handleMouseMove = (ev: MouseEvent) => {
        if (
          !bridgeDragStarted &&
          Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) <= 3
        ) {
          return;
        }
        startBridgeDrag();
        dispatchAt(
          iframeDoc,
          "mousemove",
          toIframePoint(ev.clientX, ev.clientY),
          ev,
          1,
        );
      };
      const cancelMove = (pressedAt: number) => {
        crossScreenIgnoreAutoLayoutRef.current = false;
        crossScreenControlPressedRef.current = false;
        if (!bridgeDragStarted) return;
        iframe.contentWindow?.postMessage(
          { type: "agent-native:cancel-active-drag", pressedAt },
          "*",
        );
        iframe.contentWindow?.postMessage(
          { type: "agent-native:drag-modifiers", ignoreAutoLayout: false },
          "*",
        );
        crossScreenControlPressedRef.current = false;
      };
      const handleMouseUp = (ev: MouseEvent) => {
        if (!bridgeDragStarted) {
          const frameRect = iframe.getBoundingClientRect();
          const frameScale = frameRect.width / (iframe.offsetWidth || 1);
          const point = {
            x: (ev.clientX - frameRect.left) / frameScale,
            y: (ev.clientY - frameRect.top) / frameScale,
          };
          const pressTarget = iframeDoc.querySelector(
            '[data-agent-native-edit-overlay="shield"]',
          );
          if (pressTarget) {
            dispatchAt(pressTarget, "mousedown", point, ev, 1);
            dispatchAt(pressTarget, "mouseup", point, ev, 0);
            if (ev.detail >= 2) {
              dispatchAt(pressTarget, "dblclick", point, ev, 0);
            }
          }
          finishDrag();
          return;
        }
        const droppedOnScreen = Boolean(
          getFrameEntryAtPoint(getCanvasPoint(ev.clientX, ev.clientY)),
        );
        if (droppedOnScreen || crossScreenHostCommittedRef.current) {
          cancelMove(performance.timeOrigin + performance.now());
        } else {
          iframe.contentWindow?.postMessage(
            { type: "agent-native:cross-screen-claim", claimed: false },
            "*",
          );
          dispatchAt(
            iframeDoc,
            "mouseup",
            toIframePoint(ev.clientX, ev.clientY),
            ev,
            0,
          );
          iframe.contentWindow?.postMessage(
            { type: "agent-native:drag-modifiers", ignoreAutoLayout: false },
            "*",
          );
        }
        finishDrag();
      };
      boardElementResizeCancel.current = cancelMove;
      installDragListeners(handleMouseMove, handleMouseUp, () => {
        cancelMove(performance.timeOrigin + performance.now());
        finishDrag();
      });
    },
    [
      boardFileId,
      boardSurfaceRenderGeometry,
      finishDrag,
      getCanvasPoint,
      getFrameEntryAtPoint,
      installDragListeners,
      readOnly,
    ],
  );

  const beginRotate = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (readOnly) return;
      if (e.button !== 0 || lockedScreenIdSet.has(id)) return;
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
      setDragCursor(
        rotateCursorDataUri(quantizeAngleTo8Buckets(originPointerAngle)),
      );

      const rotateFrameEl = surfaceRef.current?.querySelector<HTMLElement>(
        `[data-frame-id="${CSS.escape(id)}"]`,
      );
      const rotateSelectionBoxEl =
        surfaceRef.current?.querySelector<HTMLElement>(
          "[data-frame-selection-box]",
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
        if (!state.hasMoved) return;

        const pointer = getCanvasPoint(ev.clientX, ev.clientY);
        const center = getFrameCenter(state.originFrame);
        const pointerAngle = angleBetween(center, pointer);
        const raw =
          state.originRotation + pointerAngle - state.originPointerAngle;
        const rotation = ev.shiftKey ? Math.round(raw / 15) * 15 : raw;
        const roundedRotation = Math.round(rotation * 10) / 10;
        updateFrameGeometryRefOnly((current) => ({
          ...current,
          [state.frameId]: {
            ...state.originFrame,
            rotation: roundedRotation,
          },
        }));
        const rotateTransform = `rotate(${roundedRotation}deg)`;
        if (rotateFrameEl) rotateFrameEl.style.transform = rotateTransform;
        if (rotateSelectionBoxEl) {
          rotateSelectionBoxEl.style.transform = rotateTransform;
        }
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
          updateFrameGeometry((current) => ({
            ...current,
            [state.frameId]: { ...state.originFrame },
          }));
        }
        if (state?.type === "rotate" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          setFrameGeometry(after);
          onGeometryChangeRef.current?.(after);
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
      lockedScreenIdSet,
      onPick,
      showTransformFeedback,
      updateFrameGeometry,
      updateFrameGeometryRefOnly,
      updateSelectedIds,
    ],
  );

  const beginGroupRotate = useCallback(
    (e: React.MouseEvent) => {
      if (readOnly) return;
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
      setDragCursor(
        rotateCursorDataUri(quantizeAngleTo8Buckets(originPointerAngle)),
      );

      const groupRotateFrameEls = new Map<string, HTMLElement>();
      originEntries.forEach((entry) => {
        const frameEl = surfaceRef.current?.querySelector<HTMLElement>(
          `[data-frame-id="${CSS.escape(entry.id)}"]`,
        );
        if (frameEl) groupRotateFrameEls.set(entry.id, frameEl);
      });
      const groupRotateSelectionBoxEl =
        surfaceRef.current?.querySelector<HTMLElement>(
          "[data-frame-selection-box]",
        );
      const groupFrameLabelHeight =
        FRAME_LABEL_HEIGHT * chromeScaleFromZoom(zoomRef.current);

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
        let nextGeometryById: FrameGeometryById | null = null;
        updateFrameGeometryRefOnly((current) => {
          const next = { ...current };
          rotated.forEach((entry) => {
            next[entry.id] = {
              ...state.originFrames[entry.id],
              ...entry.geometry,
            };
          });
          nextGeometryById = next;
          return next;
        });
        if (nextGeometryById) {
          rotated.forEach((entry) => {
            const geometry = nextGeometryById![entry.id];
            const frameEl = groupRotateFrameEls.get(entry.id);
            if (!geometry || !frameEl) return;
            const { left, top } = frameStyleLeftTop(
              geometry,
              groupFrameLabelHeight,
            );
            frameEl.style.left = `${left}px`;
            frameEl.style.top = `${top}px`;
            frameEl.style.transform = geometry.rotation
              ? `rotate(${geometry.rotation}deg)`
              : "";
          });
          if (groupRotateSelectionBoxEl) {
            const groupBoundsNow = getFrameGroupBounds(rotated);
            if (groupBoundsNow) {
              const { left, top } = frameStyleLeftTop({
                x: groupBoundsNow.left,
                y: groupBoundsNow.top,
              });
              groupRotateSelectionBoxEl.style.left = `${left}px`;
              groupRotateSelectionBoxEl.style.top = `${top}px`;
              groupRotateSelectionBoxEl.style.width = `${groupBoundsNow.width}px`;
              groupRotateSelectionBoxEl.style.height = `${groupBoundsNow.height}px`;
            }
          }
        }
        showTransformFeedback(
          `${Math.round(delta)}deg`,
          ev.clientX,
          ev.clientY,
        );
      };

      const handleMouseUp = () => {
        const state = dragState.current;
        if (state?.type === "group-rotate" && !state.hasMoved) {
          updateFrameGeometry((current) =>
            frameGeometryWithOverrides(current, state.originFrames),
          );
        }
        if (state?.type === "group-rotate" && state.hasMoved) {
          const after = cloneFrameGeometryById(frameGeometryRef.current);
          setFrameGeometry(after);
          onGeometryChangeRef.current?.(after);
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
      updateFrameGeometryRefOnly,
    ],
  );

  const handleFrameInteract = useCallback(
    (id: string, e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (lockedScreenIdSet.has(id)) {
        onEdit?.(id);
        return;
      }
      updateSelectedDraftIds(() => []);
      updateSelectedIds(() => [id]);
      onPick(id);
      onEdit?.(id);
    },
    [
      lockedScreenIdSet,
      onEdit,
      onPick,
      updateSelectedDraftIds,
      updateSelectedIds,
    ],
  );

  const handleFrameEnter = useCallback(
    (id: string, e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (lockedScreenIdSet.has(id)) {
        onEdit?.(id);
        return;
      }
      drillIntoScreenAtPoint(id, e.clientX, e.clientY, "drill", e);
    },
    [drillIntoScreenAtPoint, lockedScreenIdSet, onEdit],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isCanvasOverlayInteractionTarget(e.target)) return;
      claimKeyboardFocus();
      suppressNextPick.current = false;
      setAltHoverMeasurement(null);
      const target = e.target as HTMLElement;
      const onFrame = !!target.closest("[data-frame-shell]");
      const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
      if (shouldBeginCanvasPan({ button: e.button, tool })) {
        beginPan(e);
        return;
      }
      if (e.button === 0 && tool === "comment") {
        const canvasPoint = getCanvasPoint(e.clientX, e.clientY);
        const frameAtPoint = getFrameEntryAtPoint(canvasPoint);
        if (!onFrame && !frameAtPoint) {
          e.preventDefault();
          e.stopPropagation();
          onCommentPin?.(canvasPoint);
        }
        return;
      }
      if (vectorEdit) {
        if (e.button !== 0) return;
        const canvasPoint = getCanvasPoint(e.clientX, e.clientY);
        const localPoint = vectorEditCanvasToLocalPoint(
          canvasPoint,
          vectorEdit.originCanvas,
        );
        const hitRadius = screenPxToCanvasPx(
          VECTOR_EDIT_HIT_RADIUS_SCREEN_PX,
          zoomRef.current,
        );
        if (tool === "pen") {
          if (penContinuesVectorEditRef.current) {
            beginPenNodeCreation(e);
            return;
          }
          const continued = continuePenPathFromEndpoint(
            vectorEdit.path,
            localPoint,
            hitRadius,
          );
          if (continued) {
            e.preventDefault();
            e.stopPropagation();
            suppressNextPick.current = true;
            penContinuesVectorEditRef.current = true;
            penContinuationBaseCountRef.current = continued.nodes.length;
            const canvasPath = translatePenPath(
              continued,
              vectorEdit.originCanvas.x,
              vectorEdit.originCanvas.y,
            );
            activePenPathRef.current = canvasPath;
            setActivePenPath(canvasPath);
            setPenPointer(null);
            return;
          }
          vectorEdit.onExit();
          beginPenNodeCreation(e);
          return;
        }
        e.preventDefault();
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
        const segmentHit = hitTestPenSegment(
          vectorEdit.path,
          localPoint,
          hitRadius,
        );
        if (segmentHit) {
          beginVectorSegmentBend(segmentHit.segmentIndex, segmentHit.t, e);
          return;
        }
        vectorEdit.onExit();
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
      if (
        e.button === 0 &&
        tool === "move" &&
        !onFrame &&
        showBoardStaticPreview &&
        boardSurfaceRenderGeometry
      ) {
        const point = getCanvasPoint(e.clientX, e.clientY);
        if (!geometryContainsPoint(boardSurfaceRenderGeometry, point)) {
          const hit = [...boardStaticPrimitives]
            .reverse()
            .find((primitive) =>
              geometryContainsPoint(
                getPrimitiveLowZoomHitRect(primitive, zoomRef.current),
                point,
              ),
            );
          if (hit) {
            e.preventDefault();
            e.stopPropagation();
            pendingStaticBoardSelectionRef.current = {
              nodeId: hit.nodeId,
              point,
            };
            setBoardSurfaceFocusPoint(point);
            return;
          }
        }
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
      beginVectorSegmentBend,
      beginPenNodeCreation,
      boardStaticPrimitives,
      boardSurfaceRenderGeometry,
      claimKeyboardFocus,
      getCanvasPoint,
      getFrameEntryAtPoint,
      localActiveTool,
      onCommentPin,
      setAltHoverMeasurement,
      showBoardStaticPreview,
      toggleVectorNodeType,
      vectorEdit,
    ],
  );

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
      const hoveredCandidates = [
        hoveredFrame && !selectedFrameIds.has(hoveredFrame.id)
          ? hoveredFrame
          : null,
        hoveredDraft && !selectedDraftIdsSet.has(hoveredDraft.id)
          ? hoveredDraft
          : null,
      ].filter((entry): entry is NonNullable<typeof entry> => !!entry);
      const hovered = hoveredCandidates
        .map((entry, index) => ({ entry, index }))
        .sort(
          (a, b) =>
            (b.entry.geometry.z ?? 0) - (a.entry.geometry.z ?? 0) ||
            b.index - a.index,
        )[0]?.entry;

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

  const syncScreenPaintSuppression = useCallback(() => {
    applyScreenPaintSuppression(
      screenPaintTargetsRef.current,
      resolveSuppressedScreenIds(
        screenPaintCandidatesRef.current,
        getOverscannedViewportCanvasBounds(
          surfaceSizeRef.current,
          panRef.current,
          zoomRef.current,
          0,
        ),
      ),
      { relaxOnly: isWheelCameraGestureActive() },
    );
  }, []);

  const applyViewToDom = useCallback(() => {
    const nextScale = zoomRef.current / 100;
    const p = panRef.current;
    const world = worldRef.current;
    if (world) {
      world.style.transform = `translate(${p.x}px, ${p.y}px) scale(${nextScale})`;
      world.style.setProperty(
        CHROME_SCALE_CSS_VAR,
        String(nextScale > 0 ? 1 / nextScale : 1),
      );
    }
    const replica = boardStaticPreviewRef.current;
    const boardGeometry = boardFrameGeometryRef.current;
    if (replica && boardGeometry) {
      const viewport = getBoardSurfaceStaticPreviewViewport(boardGeometry);
      replica.style.transform = getBoardSurfaceStaticPreviewTransform({
        logicalGeometry: boardGeometry,
        viewport,
        pan: p,
        zoom: zoomRef.current,
      });
      Object.assign(
        replica.style,
        getIframePaintRetentionStyle({
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          effectiveScale: (boardGeometry.width / viewport.width) * nextScale,
          effectiveScaleY: (boardGeometry.height / viewport.height) * nextScale,
        }),
      );
    }
    const grid = pixelGridRef.current;
    if (grid) {
      grid.style.backgroundPosition = `${p.x}px ${p.y}px`;
      grid.style.backgroundSize = `${nextScale}px ${nextScale}px`;
    }
    const marqueeOverlay = marqueeOverlayRef.current;
    const activeMarquee = marqueeRef.current;
    if (marqueeOverlay && activeMarquee) {
      marqueeOverlay.style.left = `${p.x + (SURFACE_PADDING + activeMarquee.x) * nextScale}px`;
      marqueeOverlay.style.top = `${p.y + (SURFACE_PADDING + activeMarquee.y) * nextScale}px`;
      marqueeOverlay.style.width = `${Math.max(1, activeMarquee.width * nextScale)}px`;
      marqueeOverlay.style.height = `${Math.max(1, activeMarquee.height * nextScale)}px`;
    }
    syncScreenPaintSuppression();
  }, [syncScreenPaintSuppression]);

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
    if (wheelGestureActiveRef.current) {
      wheelGestureActiveRef.current = false;
      setWheelCameraGestureActive(false);
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
    if (lastReportedZoomRef.current !== zoomRef.current) {
      lastReportedZoomRef.current = zoomRef.current;
      onZoomChangeRef.current?.(zoomRef.current);
    }
    recomputePenPointerForViewChange();
  }, [recomputePenPointerForViewChange, startChromeSettle]);

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

  const focusBoardReviewPoint = useCallback(
    (point: Point): boolean => {
      const surface = surfaceRef.current;
      const rect = surface?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const scale = Math.max(0.0001, canvasZoom / 100);
      const leftInset = Math.min(rect.width, Math.max(0, chromeInsetLeft));
      const rightInset = Math.min(rect.width, Math.max(0, chromeInsetRight));
      const centerX = (leftInset + rect.width - rightInset) / 2;
      const centerY = rect.height / 2;
      const next = {
        x: centerX - (SURFACE_PADDING + point.x) * scale,
        y: centerY - (SURFACE_PADDING + point.y) * scale,
      };
      panRef.current = next;
      lineupRecenterCameraRef.current = {
        x: next.x,
        y: next.y,
        zoom: canvasZoom,
      };
      setPan(next);
      applyViewToDomRef.current();
      scheduleViewCommitRef.current();
      return true;
    },
    [canvasZoom, chromeInsetLeft, chromeInsetRight],
  );

  useEffect(() => {
    if (!cameraCommand) {
      pendingCameraCommandZoomRevisionRef.current = null;
      return;
    }
    if (lastCameraCommandNonceRef.current === cameraCommand.nonce) return;

    const pendingCommandRevision =
      pendingCameraCommandZoomRevisionRef.current?.nonce === cameraCommand.nonce
        ? pendingCameraCommandZoomRevisionRef.current.revision
        : controlledZoomRevisionRef.current;
    pendingCameraCommandZoomRevisionRef.current = {
      nonce: cameraCommand.nonce,
      revision: pendingCommandRevision,
    };

    let cancelled = false;
    let retryFrame: number | null = null;
    let retryCount = 0;
    let resizeObserver: ResizeObserver | null = null;
    const maxMeasureRetries = 30;

    const applyPendingCameraCommand = () => {
      if (
        cancelled ||
        lastCameraCommandNonceRef.current === cameraCommand.nonce
      ) {
        return true;
      }
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (controlledZoomRevisionRef.current !== pendingCommandRevision) {
        lastCameraCommandNonceRef.current = cameraCommand.nonce;
        pendingCameraCommandZoomRevisionRef.current = null;
        resizeObserver?.disconnect();
        return true;
      }
      const availableWidth = Math.max(
        1,
        rect.width - chromeInsetLeft - chromeInsetRight,
      );
      const camera = getCameraForBounds(
        cameraCommand.fitBounds,
        { width: availableWidth, height: rect.height },
        {
          paddingScreenPx:
            cameraCommand.paddingScreenPx ?? CANVAS_FIT_PADDING_PX,
          canvasPadding: SURFACE_PADDING,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          fallbackZoom: zoomRef.current,
        },
      );
      camera.x += chromeInsetLeft;
      zoomRef.current = camera.zoom;
      lastCameraCommandZoomRef.current = camera.zoom;
      lastCameraCommandControlledZoomRef.current = zoom;
      panRef.current = { x: camera.x, y: camera.y };
      applyViewToDom();
      scheduleViewCommit();
      lastCameraCommandNonceRef.current = cameraCommand.nonce;
      pendingCameraCommandZoomRevisionRef.current = null;
      resizeObserver?.disconnect();
      return true;
    };

    const scheduleMeasureRetry = () => {
      if (cancelled || retryFrame !== null || retryCount >= maxMeasureRetries) {
        return;
      }
      retryFrame = window.requestAnimationFrame(() => {
        retryFrame = null;
        retryCount += 1;
        if (!applyPendingCameraCommand()) scheduleMeasureRetry();
      });
    };

    if (!applyPendingCameraCommand()) {
      scheduleMeasureRetry();
      const surface = surfaceRef.current;
      if (surface && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          if (!applyPendingCameraCommand()) scheduleMeasureRetry();
        });
        resizeObserver.observe(surface);
      }
    }

    return () => {
      cancelled = true;
      if (retryFrame !== null) window.cancelAnimationFrame(retryFrame);
      resizeObserver?.disconnect();
    };
  }, [cameraCommand, applyViewToDom, scheduleViewCommit]);

  const markWheelGestureActive = useCallback(() => {
    if (wheelGestureActiveRef.current) return;
    cancelPendingStaticBoardSelection();
    wheelGestureActiveRef.current = true;
    setWheelCameraGestureActive(true);
    const surface = surfaceRef.current;
    if (!surface) return;
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
  }, [cancelPendingStaticBoardSelection]);

  const flushPendingWheelGesture = useCallback(() => {
    wheelGestureFrameRef.current = null;
    const zoomGesture = pendingZoomGestureRef.current;
    const panGesture = pendingPanGestureRef.current;
    pendingZoomGestureRef.current = null;
    pendingPanGestureRef.current = null;

    let nextPan = panRef.current;
    let moved = false;
    let settleChrome = false;

    if (zoomGesture) {
      const currentZoom = zoomRef.current;
      const nextZoom = clamp(
        currentZoom * clampZoomFactor(zoomGesture.factor),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      if (nextZoom !== currentZoom) {
        nextPan = getPanForZoomToCursor({
          pan: nextPan,
          cursor: zoomGesture.cursor,
          oldZoom: currentZoom,
          nextZoom,
        });
        zoomRef.current = nextZoom;
        moved = true;
        settleChrome = true;
      }
    }

    if (panGesture) {
      nextPan = {
        x: nextPan.x - panGesture.deltaX,
        y: nextPan.y - panGesture.deltaY,
      };
      moved = true;
    }

    if (!moved) return;
    panRef.current = nextPan;
    markWheelGestureActive();
    applyViewToDom();
    scheduleViewCommit(settleChrome ? { settleChrome: true } : undefined);
  }, [applyViewToDom, markWheelGestureActive, scheduleViewCommit]);

  const enqueueWheelGesture = useCallback(
    (gesture: PendingWheelGesture) => {
      if (gesture.mode === "zoom") {
        const pending = pendingZoomGestureRef.current;
        pendingZoomGestureRef.current = {
          ...gesture,
          factor: (pending?.factor ?? 1) * gesture.factor,
        };
      } else {
        const pending = pendingPanGestureRef.current;
        pendingPanGestureRef.current = {
          mode: "pan",
          deltaX: (pending?.deltaX ?? 0) + gesture.deltaX,
          deltaY: (pending?.deltaY ?? 0) + gesture.deltaY,
        };
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
        const rect = surfaceRef.current?.getBoundingClientRect();
        if (!rect) return;
        const device = resolveZoomGestureDevice({
          deltaY: args.deltaY,
          deltaMode: args.deltaMode,
          ctrlKey: args.ctrlKey,
          metaKey: args.metaKey,
          atMs: performance.now(),
          previous: zoomGestureDeviceRef.current,
        });
        zoomGestureDeviceRef.current = device;
        enqueueWheelGesture({
          mode: "zoom",
          factor: accumulateZoomFactor(1, delta.y, device.pinch),
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
      if (!event.isTrusted) return;
      invalidateSnapGesture();
      if (event.cancelable) event.preventDefault();
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
      if (readOnly) return;
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
      if (onNudgeSelectionRef.current?.(targetIds) === false) return;

      event.preventDefault();
      event.stopPropagation();

      const nudge = getNudgeDelta(
        event.key,
        {
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        },
        {
          baseStep: nudgeAmountsRef.current?.small,
          bigStep: nudgeAmountsRef.current?.big,
        },
      );
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
        onGeometryCommitRef.current?.(before, cloneFrameGeometryById(next), {
          source: "keyboard",
        });
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
    readOnly,
    scheduleFeedbackClear,
    updateDraftPrimitives,
    updateFrameGeometry,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activePenPathRef.current) return;
      if (readOnly) return;
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
  }, [deleteSelectedItems, readOnly]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const path = activePenPathRef.current;
      if (!path || isEditableHotkeyTarget(event.target)) {
        return;
      }

      const primaryKey = event.metaKey || event.ctrlKey;
      if (primaryKey && !event.shiftKey && event.key.toLowerCase() === "z") {
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
        if (dragState.current?.type === "pen-node") cancelActiveDrag();
        const pathToFinish = activePenPathRef.current;
        if (!pathToFinish) return;
        const continuesExistingPath =
          continuationPenPathRef.current !== null ||
          penContinuesVectorEditRef.current;
        finishPenPath(pathToFinish, {
          continueAfterCommit: continuationPenPathRef.current !== null,
          nextTool: continuesExistingPath ? "pen" : "move",
        });
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
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
  }, [cancelActiveDrag, finishPenPath, undoActivePenPathSegment]);

  useEffect(() => {
    const tool = normalizeCanvasTool(activeTool ?? localActiveTool);
    if (tool !== "pen") {
      finishPenPath();
      if (!activePenPathRef.current) continuationPenPathRef.current = null;
    }
  }, [activeTool, finishPenPath, localActiveTool]);

  useEffect(() => {
    if (!onDuplicate) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;
      if (activePenPathRef.current) return;
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "d" ||
        isEditableHotkeyTarget(event.target)
      ) {
        return;
      }
      const frameIds = frameCommandTargetIds(
        selectedIdsRef.current,
        (id) => Boolean(frameGeometryRef.current[id]),
        selectedElementScreenIdRef.current,
      );
      if (frameIds.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      let dispatched = 0;
      const duplicateResults: Array<void | Promise<string | undefined>> = [];
      const historyBatchId = `duplicate-${++duplicateBatchSequenceRef.current}`;
      const orderedFrameIds = frameIds
        .map((targetId, index) => ({
          targetId,
          index,
          z: frameGeometryRef.current[targetId]?.z ?? 0,
        }))
        .sort((left, right) => left.z - right.z || left.index - right.index);
      for (const [
        duplicateStackIndex,
        { targetId },
      ] of orderedFrameIds.entries()) {
        const screen = screens.find((s) => s.id === targetId);
        if (!screen) continue;
        const sourceGeometry = frameGeometryRef.current[targetId];
        if (!sourceGeometry) continue;
        const canvasPosition = {
          x: sourceGeometry.x + sourceGeometry.width + SCREEN_GAP,
          y: sourceGeometry.y,
        };
        duplicateResults.push(
          onDuplicate(targetId, {
            mode: "alt-click",
            screen,
            canvasPosition,
            preserveCamera: true,
            historyBatchId,
            duplicateStackIndex,
            dropCanvasPosition: canvasPosition,
          }),
        );
        dispatched += 1;
      }
      if (dispatched > 0) {
        lineupRecenterSuppressRef.current = {
          atMs: Date.now(),
          fromCount: screensRef.current.length,
          addedCount: dispatched,
        };
        selectCompletedDuplicates(duplicateResults);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onDuplicate, readOnly, screens, selectCompletedDuplicates]);

  useEffect(() => {
    const releaseAltMeasurements = () => {
      setAltHoverMeasurement(null);
      surfaceRef.current
        ?.querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )
        .forEach((iframe) => {
          iframe.contentWindow?.postMessage(
            { type: "measurement-modifier-release" },
            "*",
          );
        });
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      releaseAltMeasurements();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseAltMeasurements();
    };
    const surface = surfaceRef.current;
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", releaseAltMeasurements);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    surface?.addEventListener("blur", releaseAltMeasurements, true);
    return () => {
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", releaseAltMeasurements);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      surface?.removeEventListener("blur", releaseAltMeasurements, true);
    };
  }, [setAltHoverMeasurement]);

  const scale = canvasZoom / 100;
  const chromeScale = scale > 0 ? 1 / scale : 1;
  const showPixelGrid = canvasZoom >= PIXEL_GRID_ZOOM;
  const effectiveTool = normalizeCanvasTool(activeTool ?? localActiveTool);
  const lastTracedToolRef = useRef<string | null>(null);
  if (lastTracedToolRef.current !== effectiveTool) {
    lastTracedToolRef.current = effectiveTool;
    trace("tool", "active-tool", { tool: effectiveTool });
  }
  useEffect(() => {
    effectiveToolRef.current = effectiveTool;
  }, [effectiveTool]);
  const penActive = !readOnly && effectiveTool === "pen";
  const creationToolActive =
    !readOnly && Boolean(getDraftCreationTool(effectiveTool));
  const seedSelectedPenContinuation = useCallback(() => {
    if (
      !penActive ||
      !selectedPenPathNodeId ||
      activePenPathRef.current ||
      continuationPenPathRef.current
    ) {
      return;
    }

    const matches: Array<{
      iframe: HTMLIFrameElement;
      sourceElement: SVGElement;
    }> = [];
    for (const iframe of Array.from(
      document.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-screen-iframe-id]",
      ),
    )) {
      const frameDocument = iframe.contentDocument;
      if (!frameDocument) continue;
      const element = Array.from(
        frameDocument.querySelectorAll<SVGElement>(
          "[data-agent-native-node-id]",
        ),
      ).find(
        (candidate) =>
          candidate.getAttribute("data-agent-native-node-id") ===
          selectedPenPathNodeId,
      );
      const sourceElement = element?.closest<SVGElement>("[data-an-pen-nodes]");
      if (sourceElement) matches.push({ iframe, sourceElement });
    }
    if (matches.length !== 1) return;

    const { iframe, sourceElement } = matches[0]!;
    const serialized = sourceElement.getAttribute("data-an-pen-nodes");
    const path = serialized ? parsePenNodes(serialized) : null;
    if (!path || path.closed || path.nodes.length < 2) return;
    const svg = sourceElement.closest("svg");
    const offset = svg ? penPathScreenContentOffset(svg) : null;
    const rect = iframe.getBoundingClientRect();
    if (!offset || iframe.clientWidth <= 0 || iframe.clientHeight <= 0) return;
    const renderedScale = rect.width / iframe.clientWidth;
    if (!Number.isFinite(renderedScale) || renderedScale <= 0) return;
    const scrollX = iframe.contentWindow?.scrollX ?? 0;
    const scrollY = iframe.contentWindow?.scrollY ?? 0;
    const toCanvasPoint = (point: { x: number; y: number }) => {
      const clientX =
        rect.left + (offset.x + point.x - scrollX) * renderedScale;
      const clientY = rect.top + (offset.y + point.y - scrollY) * renderedScale;
      return getCanvasPoint(clientX, clientY);
    };
    const canvasPath: PenPath = {
      closed: false,
      nodes: path.nodes.map((node) => {
        const mapped: PenNode = { ...node, point: toCanvasPoint(node.point) };
        if (node.handleIn) mapped.handleIn = toCanvasPoint(node.handleIn);
        if (node.handleOut) mapped.handleOut = toCanvasPoint(node.handleOut);
        return mapped;
      }),
    };
    const frameId = iframe.getAttribute("data-screen-iframe-id");
    if (!frameId) return;
    continuationPenPathRef.current = {
      frameId,
      nodeId: selectedPenPathNodeId,
      path: canvasPath,
    };
  }, [getCanvasPoint, penActive, selectedPenPathNodeId]);
  seedSelectedPenContinuationRef.current = seedSelectedPenContinuation;
  useEffect(() => {
    seedSelectedPenContinuation();
  }, [seedSelectedPenContinuation]);
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
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const fullViewIdSet = useMemo(
    () => new Set(fullViewScreenIds ?? []),
    [fullViewScreenIds],
  );
  const selectedDraftIdSet = useMemo(
    () => new Set(selectedDraftIds),
    [selectedDraftIds],
  );
  const surfaceCursor = isPanning
    ? "grabbing"
    : dragCursor
      ? dragCursor
      : isDragging && marquee
        ? "default"
        : penActive || getDraftCreationTool(effectiveTool)
          ? "crosshair"
          : effectiveTool === "hand"
            ? "grab"
            : effectiveTool === "comment"
              ? COMMENT_CURSOR
              : "default";
  useEffect(() => {
    const handleContentSize = (event: MessageEvent) => {
      const data = event.data;
      if (
        !data ||
        typeof data !== "object" ||
        data.type !== CONTENT_SIZE_REPORT_MESSAGE_TYPE ||
        typeof data.height !== "number" ||
        !Number.isFinite(data.height) ||
        data.height <= 0 ||
        data.height > MAX_SANE_FRAME_DIMENSION_PX
      ) {
        return;
      }
      const surface = surfaceRef.current;
      if (!surface || !event.source) return;
      const iframes = surface.querySelectorAll<HTMLIFrameElement>(
        "iframe[data-screen-iframe-id]",
      );
      let iframeId: string | null = null;
      for (const iframe of iframes) {
        if (iframe.contentWindow === event.source) {
          iframeId = iframe.getAttribute("data-screen-iframe-id");
          break;
        }
      }
      if (!iframeId) return;
      const key = iframeId;
      const breakpointMarker = "::bp-";
      const markerIndex = key.lastIndexOf(breakpointMarker);
      const screenId = markerIndex >= 0 ? key.slice(0, markerIndex) : key;
      const measuredScreen = screensRef.current.find(
        (screen) => screen.id === screenId,
      );
      if (
        measuredScreen &&
        getResolvedMetadata(measuredScreen).heightMode === "fixed"
      ) {
        return;
      }
      const height = Math.round(data.height);
      const width =
        typeof data.width === "number" && Number.isFinite(data.width)
          ? Math.round(data.width)
          : 0;
      const viewportHeight =
        typeof data.viewportHeight === "number" &&
        Number.isFinite(data.viewportHeight) &&
        data.viewportHeight > 0
          ? Math.round(data.viewportHeight)
          : 0;
      const naturalHeight =
        typeof data.naturalHeight === "number" &&
        Number.isFinite(data.naturalHeight) &&
        data.naturalHeight > 0 && // i18n-ignore positive numeric height validation
        data.naturalHeight <= MAX_SANE_FRAME_DIMENSION_PX
          ? Math.round(data.naturalHeight)
          : null;
      const sample = resolveStableContentSizeSample(
        contentSizeSamplesRef.current[key],
        { height, viewportHeight, width },
      );
      contentSizeSamplesRef.current[key] = sample;
      const acceptedHeight = sample.acceptedHeight;
      if (markerIndex >= 0) {
        const widthPx = Number(
          key.slice(markerIndex + breakpointMarker.length),
        );
        if (
          Number.isSafeInteger(widthPx) &&
          widthPx > 0 &&
          screensRef.current.some((screen) => screen.id === screenId)
        ) {
          onBreakpointContentHeightChangeRef.current?.(
            screenId,
            widthPx,
            acceptedHeight,
          );
        }
      } else if (screensRef.current.some((screen) => screen.id === key)) {
        onPrimaryContentHeightChangeRef.current?.(key, acceptedHeight);
        onScreenContentNaturalHeightChangeRef.current?.(key, naturalHeight);
      }
      setMeasuredIframeHeights((prev) => {
        const current = prev[key];
        if (current !== undefined && Math.abs(current - acceptedHeight) <= 1) {
          return prev;
        }
        return { ...prev, [key]: acceptedHeight };
      });
      setMeasuredIframeNaturalHeights((prev) => {
        const current = prev[key];
        if (naturalHeight === null) {
          if (current === undefined) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (current !== undefined && Math.abs(current - naturalHeight) <= 1)
          return prev;
        return { ...prev, [key]: naturalHeight };
      });
    };
    window.addEventListener("message", handleContentSize);
    return () => window.removeEventListener("message", handleContentSize);
  }, [getResolvedMetadata]);

  const canvasFrames = useMemo(() => {
    const cache = canvasFrameEntryCacheRef.current;
    const nextIds = new Set<string>();
    const next = renderedScreens.map((screen) => {
      nextIds.add(screen.id);
      const metadata = getResolvedMetadata(screen);
      const geometryOverride = geometryOverridesById?.[screen.id];
      const persistedGeometry = geometryById?.[screen.id];
      const persistedGeometryIsComplete =
        persistedGeometry &&
        typeof persistedGeometry.x === "number" &&
        typeof persistedGeometry.y === "number" &&
        typeof persistedGeometry.width === "number" &&
        typeof persistedGeometry.height === "number";
      const rawGeometry =
        geometryOverride ??
        (persistedGeometryIsComplete &&
        (!frameGeometry[screen.id] ||
          !renderedScreenIdsRef.current.has(screen.id))
          ? (persistedGeometry as FrameGeometry)
          : undefined) ??
        frameGeometry[screen.id] ??
        (persistedGeometryIsComplete
          ? (persistedGeometry as FrameGeometry)
          : undefined) ??
        getInitialFrameGeometry(screenIndexById.get(screen.id) ?? 0, metadata);
      const measuredPrimaryHeight =
        metadata.heightMode === "hug"
          ? measuredIframeNaturalHeights[screen.id]
          : measuredIframeHeights[screen.id];
      const isInlineScreen = !(
        metadata.previewUrl ?? getPreviewUrl(screen.content)
      );
      const sizeConstraints = readScreenSizeConstraints(
        screenRootComputedStylesById?.[screen.id],
      );
      const autoHeight =
        isInlineScreen && measuredPrimaryHeight
          ? resolveAutoFitScreenHeight({
              mode: metadata.heightMode ?? "auto",
              width: metadata.width,
              currentHeight: rawGeometry.height ?? 0,
              measuredHeight: measuredPrimaryHeight,
              sizeConstraints,
            })
          : (rawGeometry.height ?? 0);
      const sizedGeometry =
        !autoHeight || autoHeight === rawGeometry.height
          ? rawGeometry
          : { ...rawGeometry, height: autoHeight };
      const baseGeometry = clampScreenFrameSize(sizedGeometry, sizeConstraints);
      const geometry =
        screen.id === interactScreenId && focusedInteractViewport
          ? {
              ...baseGeometry,
              width: Math.max(1, Math.round(focusedInteractViewport.width)),
              height: Math.max(1, Math.round(focusedInteractViewport.height)),
              rotation: undefined,
            }
          : baseGeometry;
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
    for (const id of cache.keys()) {
      if (!nextIds.has(id)) cache.delete(id);
    }
    pruneResolvedMetadataCache(resolvedMetadataCacheRef.current, nextIds);
    return next;
  }, [
    frameGeometry,
    focusedInteractViewport?.height,
    focusedInteractViewport?.width,
    geometryById,
    geometryOverridesById,
    getResolvedMetadata,
    interactScreenId,
    measuredIframeHeights,
    measuredIframeNaturalHeights,
    renderedScreens,
    screenIndexById,
    screenRootComputedStylesById,
  ]);
  const focusedInteractFrame =
    focusedInteractViewport && interactScreenId
      ? canvasFrames.find(({ screen }) => screen.id === interactScreenId)
      : undefined;
  const focusedInteract = Boolean(focusedInteractFrame);
  useLayoutEffect(() => {
    renderedFrameGeometryRef.current = Object.fromEntries(
      canvasFrames.map(({ screen, geometry }) => [screen.id, geometry]),
    );
  }, [canvasFrames]);
  const editorProtectedScreenIds = useMemo(() => {
    const protectedIds = new Set(selectedIdSet);
    if (activeId) protectedIds.add(activeId);
    if (hoverPromotedScreenId) protectedIds.add(hoverPromotedScreenId);
    if (interactScreenId) protectedIds.add(interactScreenId);
    if (gradientEditTarget) {
      protectedIds.add(gradientEditTarget.frameOrDraftId);
    }
    for (const [screenId, selectorGroups] of Object.entries(
      selectedLayerSelectorGroupsByScreen,
    )) {
      if (selectorGroups?.length > 0) protectedIds.add(screenId);
    }
    return protectedIds;
  }, [
    activeId,
    gradientEditTarget,
    hoverPromotedScreenId,
    interactScreenId,
    selectedIdSet,
    selectedLayerSelectorGroupsByScreen,
  ]);
  const protectedLiveScreenIds = useMemo(() => {
    const protectedIds = new Set(editorProtectedScreenIds);
    if (fileDragOverFrameId) protectedIds.add(fileDragOverFrameId);
    if (isDragging) {
      const activeDrag = dragState.current;
      if (activeDrag?.type === "move" || activeDrag?.type === "resize") {
        activeDrag.targetIds.forEach((id) => protectedIds.add(id));
      } else if (activeDrag?.type === "rotate") {
        protectedIds.add(activeDrag.frameId);
      } else if (activeDrag?.type === "group-rotate") {
        activeDrag.targetIds.forEach((id) => protectedIds.add(id));
      }
    }
    const crossScreenTargetId = crossScreenTargetRef.current?.id;
    if (crossScreenGhost && crossScreenTargetId) {
      protectedIds.add(crossScreenTargetId);
    }
    return protectedIds;
  }, [
    crossScreenGhost,
    editorProtectedScreenIds,
    fileDragOverFrameId,
    isDragging,
  ]);

  const layoutGridBoardSizeById = useMemo(() => {
    const sizes: Record<string, number> = {};
    if (!layoutGrids) return sizes;
    const scale = canvasZoom / 100;
    for (const { screen, metadata, geometry } of canvasFrames) {
      const grid = layoutGrids[screen.id];
      if (!grid?.visible || !geometry.width) continue;
      const viewport = getScreenPreviewViewport(metadata, geometry);
      const boardSize =
        grid.size * (geometry.width / Math.max(1, viewport.viewportWidth));
      if (boardSize * scale < MIN_LAYOUT_GRID_SCREEN_PX) continue;
      sizes[screen.id] = boardSize;
    }
    return sizes;
  }, [canvasFrames, canvasZoom, layoutGrids]);

  const screenCullTierById = useMemo(() => {
    const viewport = getOverscannedViewportCanvasBounds(
      surfaceSize,
      pan,
      canvasZoom,
    );
    const visibleViewport = getOverscannedViewportCanvasBounds(
      surfaceSize,
      pan,
      canvasZoom,
      0,
    );
    const candidates = canvasFrames.map(({ screen, metadata, geometry }) => ({
      id: screen.id,
      geometry: getResponsiveScreenCullGeometry(screen, geometry, (widthPx) => {
        return metadata.heightMode === "fixed"
          ? undefined
          : (measuredIframeHeights[getBreakpointIframeId(screen.id, widthPx)] ??
              getResponsiveBreakpointHeightPx(
                { breakpointHeights: screen.breakpointHeights },
                widthPx,
              ));
      }),
      iframeCount:
        1 +
        visibleBreakpointWidths(screen.breakpointWidths, metadata.width).length,
    }));
    const next = computeBoundedScreenCullState({
      candidates,
      viewport,
      visibleViewport,
      protectedScreenIds: protectedLiveScreenIds,
      previousLiveScreenIds: liveScreenIdsRef.current,
      everVisibleScreenIds: hasBeenVisibleScreenIdsRef.current,
      lastVisibleEpochByScreenId: lastVisibleEpochByScreenIdRef.current,
      accessEpoch: ++cullAccessEpochRef.current,
    });
    liveScreenIdsRef.current = next.liveScreenIds;
    hasBeenVisibleScreenIdsRef.current = next.everVisibleScreenIds;
    lastVisibleEpochByScreenIdRef.current = next.lastVisibleEpochByScreenId;
    screenPaintCandidatesRef.current = candidates.map(({ id, geometry }) => ({
      id,
      geometry,
      tier: next.tierByScreenId.get(id) ?? "visible",
    }));
    return next.tierByScreenId;
  }, [
    canvasFrames,
    canvasZoom,
    measuredIframeHeights,
    pan,
    protectedLiveScreenIds,
    surfaceSize,
  ]);
  const largeBoard = canvasFrames.length > OVERVIEW_LIVE_SCREEN_BUDGET;
  const levelOfDetail = largeBoard && !interactMode;
  const liveEditorScreenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const liveEditorScreenIds = useMemo(() => {
    if (!levelOfDetail) return null;
    const next = resolveLiveEditorScreenIds({
      candidates: canvasFrames.map(({ screen, metadata, geometry }) => ({
        id: screen.id,
        width: geometry.width,
        alwaysLive:
          Boolean(metadata.previewUrl) ||
          isRunningAppSourceType(metadata.source) ||
          screen.id === exportPreviewScreenId ||
          editorProtectedScreenIds.has(screen.id),
      })),
      zoomPercent: canvasZoom,
      previousIds: liveEditorScreenIdsRef.current,
    });
    liveEditorScreenIdsRef.current = next;
    return next;
  }, [
    canvasFrames,
    canvasZoom,
    editorProtectedScreenIds,
    exportPreviewScreenId,
    levelOfDetail,
  ]);
  const liveBootFrameCountByScreenId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { screen, metadata } of canvasFrames) {
      if (
        largeBoard
          ? liveEditorScreenIds && !liveEditorScreenIds.has(screen.id)
          : !isRunningAppSourceType(metadata.source)
      ) {
        continue;
      }
      counts.set(
        screen.id,
        1 +
          visibleBreakpointWidths(screen.breakpointWidths, metadata.width)
            .length,
      );
    }
    return counts;
  }, [canvasFrames, largeBoard, liveEditorScreenIds, screenCullTierById]);
  bootFrameCountByScreenIdRef.current = liveBootFrameCountByScreenId;
  const liveBootCandidates = useMemo(
    () =>
      Array.from(liveScreenIdsRef.current).filter((screenId) =>
        liveBootFrameCountByScreenId.has(screenId),
      ),
    [liveBootFrameCountByScreenId, screenCullTierById],
  );
  const bootAdmittedScreenIds = useMemo(
    () =>
      admitBootBudget({
        candidates: liveBootCandidates,
        bootStatusById: bootStatusByScreenIdRef.current,
        costById: liveBootFrameCountByScreenId,
        protectedIds: protectedLiveScreenIds,
      }),
    [
      bootStatusRevision,
      liveBootCandidates,
      liveBootFrameCountByScreenId,
      protectedLiveScreenIds,
    ],
  );
  useEffect(() => {
    let changed = false;
    for (const screenId of bootAdmittedScreenIds) {
      if (bootStatusByScreenIdRef.current.has(screenId)) continue;
      bootStatusByScreenIdRef.current.set(screenId, "booting");
      bootReadyFrameIdsByScreenIdRef.current.set(screenId, new Set());
      const timeoutId = window.setTimeout(
        () => markScreenBootReady(screenId),
        8_000,
      );
      bootTimeoutByScreenIdRef.current.set(screenId, timeoutId);
      changed = true;
    }
    if (changed) setBootStatusRevision((revision) => revision + 1);
  }, [bootAdmittedScreenIds, markScreenBootReady]);
  useEffect(() => {
    let changed = false;
    for (const screenId of bootStatusByScreenIdRef.current.keys()) {
      if (
        liveScreenIdsRef.current.has(screenId) &&
        liveBootFrameCountByScreenId.has(screenId)
      ) {
        continue;
      }
      const timeoutId = bootTimeoutByScreenIdRef.current.get(screenId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      bootTimeoutByScreenIdRef.current.delete(screenId);
      bootStatusByScreenIdRef.current.delete(screenId);
      bootReadyFrameIdsByScreenIdRef.current.delete(screenId);
      changed = true;
    }
    if (changed) setBootStatusRevision((revision) => revision + 1);
  }, [liveBootFrameCountByScreenId, screenCullTierById]);
  const bootDeferredScreenIds = useMemo(
    () =>
      new Set(
        canvasFrames
          .filter(
            ({ screen }) =>
              liveScreenIdsRef.current.has(screen.id) &&
              liveBootFrameCountByScreenId.has(screen.id) &&
              !bootAdmittedScreenIds.has(screen.id),
          )
          .map(({ screen }) => screen.id),
      ),
    [
      bootAdmittedScreenIds,
      canvasFrames,
      liveBootFrameCountByScreenId,
      screenCullTierById,
    ],
  );
  const staticPreviewScreenIds = useMemo(
    () =>
      selectStaticPreviewScreenIds({
        candidates: canvasFrames
          .filter(
            ({ screen, metadata }) =>
              !metadata.previewUrl &&
              !isRunningAppSourceType(metadata.source) &&
              !liveScreenIdsRef.current.has(screen.id),
          )
          .map(({ screen, geometry }) => ({ id: screen.id, geometry })),
        viewport: getOverscannedViewportCanvasBounds(
          surfaceSize,
          pan,
          canvasZoom,
          OVERVIEW_STATIC_PREVIEW_OVERSCAN_FACTOR,
        ),
      }),
    [canvasFrames, canvasZoom, pan, screenCullTierById, surfaceSize],
  );
  useEffect(() => {
    screenPaintTargetsRef.current = collectScreenPaintTargets(
      surfaceRef.current,
    );
    syncScreenPaintSuppression();
  });

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
  const vectorEditOverlayZIndex = useMemo(
    () =>
      canvasFrames.reduce(
        (highest, { screen, geometry }) =>
          Math.max(
            highest,
            (geometry.z ?? 0) +
              (screen.id === topScreenId ? TOP_SCREEN_Z_BOOST : 0),
          ),
        DRAFT_PREVIEW_Z,
      ) + 1,
    [canvasFrames, topScreenId],
  );
  const editorScreenIds = useMemo(() => {
    const ids = new Set<string>();
    if (!renderScreenContent) return ids;
    canvasFrames.forEach(({ screen }) => {
      const baseTier = screenCullTierById.get(screen.id) ?? "visible";
      const tier =
        screen.id === exportPreviewScreenId &&
        (baseTier === "placeholder" || baseTier === "evicted")
          ? "culled"
          : baseTier;
      if (tier === "placeholder" || tier === "evicted") return;
      if (liveEditorScreenIds && !liveEditorScreenIds.has(screen.id)) return;
      if (bootDeferredScreenIds.has(screen.id)) return;
      ids.add(screen.id);
    });
    return ids;
  }, [
    canvasFrames,
    exportPreviewScreenId,
    bootDeferredScreenIds,
    liveEditorScreenIds,
    renderScreenContent,
    screenCullTierById,
  ]);
  const iframeAdmissionOrder = useMemo(
    () =>
      orderByViewportDistance(
        screenPaintCandidatesRef.current.filter(
          ({ id }) =>
            !editorScreenIds.has(id) &&
            (liveScreenIdsRef.current.has(id) ||
              staticPreviewScreenIds.has(id) ||
              id === exportPreviewScreenId),
        ),
        getOverscannedViewportCanvasBounds(surfaceSize, pan, canvasZoom, 0),
      ),
    [
      canvasZoom,
      editorScreenIds,
      exportPreviewScreenId,
      pan,
      screenCullTierById,
      staticPreviewScreenIds,
      surfaceSize,
    ],
  );
  const iframeAdmissionImmediateIds = useMemo(() => {
    const ids = new Set(protectedLiveScreenIds);
    if (exportPreviewScreenId) ids.add(exportPreviewScreenId);
    return ids;
  }, [exportPreviewScreenId, protectedLiveScreenIds]);
  const [iframeAdmissionTick, setIframeAdmissionTick] = useState(0);
  const admittedIframeIdsRef = useRef<ReadonlySet<string>>(new Set());
  const admittedIframeIds = useMemo(() => {
    const next = admitIframesProgressively({
      wantedIds: iframeAdmissionOrder,
      admittedIds: admittedIframeIdsRef.current,
      immediateIds: iframeAdmissionImmediateIds,
      perFrame: 0,
    });
    admittedIframeIdsRef.current = next;
    return next;
  }, [iframeAdmissionImmediateIds, iframeAdmissionOrder, iframeAdmissionTick]);
  useEffect(() => {
    if (admittedIframeIds.size >= iframeAdmissionOrder.length) return;
    const frame = requestAnimationFrame(() => {
      admittedIframeIdsRef.current = admitIframesProgressively({
        wantedIds: iframeAdmissionOrder,
        admittedIds: admittedIframeIdsRef.current,
        immediateIds: iframeAdmissionImmediateIds,
      });
      setIframeAdmissionTick((tick) => tick + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [admittedIframeIds, iframeAdmissionImmediateIds, iframeAdmissionOrder]);
  const contentScreenIdsRef = useRef<ReadonlySet<string>>(new Set());
  const retainedEditorScreenIds = useMemo(() => {
    const wanted = new Set(iframeAdmissionOrder);
    const ids = new Set<string>();
    for (const id of contentScreenIdsRef.current) {
      if (
        !editorScreenIds.has(id) &&
        wanted.has(id) &&
        !admittedIframeIds.has(id)
      ) {
        ids.add(id);
      }
    }
    return ids;
  }, [admittedIframeIds, editorScreenIds, iframeAdmissionOrder]);
  const screenContentById = useMemo(() => {
    if (!renderScreenContent) return new Map<string, ReactNode>();
    const cache = screenContentCacheRef.current;
    const next = new Map<string, ReactNode>();
    canvasFrames.forEach(({ screen, metadata, geometry }) => {
      if (
        !editorScreenIds.has(screen.id) &&
        !retainedEditorScreenIds.has(screen.id)
      ) {
        return;
      }
      next.set(
        screen.id,
        getCachedScreenContentNode(
          cache,
          screen,
          metadata,
          geometry,
          renderScreenContent,
          {
            onBootReady: getScreenBootReadyCallback(screen.id),
            onBootStart: getScreenBootStartCallback(screen.id),
            cacheKey: screenContentRenderKey,
          },
        ),
      );
    });
    pruneScreenContentCache(
      cache,
      new Set(canvasFrames.map(({ screen }) => screen.id)),
    );
    contentScreenIdsRef.current = new Set(next.keys());
    return next;
  }, [
    canvasFrames,
    editorScreenIds,
    getScreenBootReadyCallback,
    getScreenBootStartCallback,
    renderScreenContent,
    screenContentRenderKey,
    retainedEditorScreenIds,
  ]);
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
  const singleSelectedFrameScreen = singleSelectedFrame
    ? canvasFrames.find((entry) => entry.screen.id === singleSelectedFrame.id)
        ?.screen
    : undefined;
  const singleSelectedFrameIsRunningApp = singleSelectedFrameScreen
    ? isRunningAppSourceType(
        getResolvedMetadata(singleSelectedFrameScreen).source,
      )
    : false;
  const suppressBaseSelectionBox = Boolean(
    singleSelectedFrameScreen &&
    shouldSuppressFrameSelectionBox(
      singleSelectedFrameScreen,
      selectedElementScreenId,
    ),
  );
  const singleSelectedDraft =
    selectedDraftEntries.length === 1 && !selectedDraftGroupBounds
      ? selectedDraftEntries[0]
      : null;
  const boardSelectionBoxVisible =
    !boardTextEditing &&
    !vectorEdit &&
    (boardFileId
      ? (selectedLayerSelectorGroupsByScreen[boardFileId]?.length ?? 0)
      : 0) <= 1 &&
    boardSelectionRect?.sourceId === boardSelectedSourceId &&
    shouldRenderBoardSelectionBox({
      boardSelectionRect,
      boardIsActive,
      boardSurfaceRenderGeometry,
    });
  const rootSelectedEntryCount =
    selectedFrameEntries.length + selectedDraftEntries.length;
  const showPassiveRootSelectionBoxes = rootSelectedEntryCount > 1;
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
      data-multi-screen-canvas-surface
      tabIndex={-1}
      className="relative h-full w-full select-none overflow-clip outline-none"
      onMouseDownCapture={handleMouseDown}
      onFocusCapture={restoreInitialCanvasFocus}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setAltHoverMeasurement(null)}
      onDragEnter={handleCanvasDragEnter}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
      style={{
        cursor: surfaceCursor,
        contain: "layout paint",
        isolation: "isolate",
        overscrollBehavior: "none",
        touchAction: "none",
        visibility: focusedInteract ? "hidden" : undefined,
      }}
    >
      {showPixelGrid && !focusedInteract ? (
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

      {!focusedInteract &&
      showBoardStaticPreview &&
      boardFrameGeometry &&
      boardStaticPreviewViewport &&
      boardStaticPreviewContent ? (
        <div
          data-board-static-preview
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            overflow: "clip",
            contain: "strict",
            isolation: "isolate",
            pointerEvents: "none",
            background: "transparent",
            zIndex: 0,
          }}
        >
          <iframe
            ref={boardStaticPreviewRef}
            data-board-static-preview-iframe
            aria-hidden="true"
            tabIndex={-1}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={boardStaticPreviewContent}
            style={{
              display: "block",
              width: boardStaticPreviewViewport.width,
              height: boardStaticPreviewViewport.height,
              border: 0,
              pointerEvents: "none",
              transform: getBoardSurfaceStaticPreviewTransform({
                logicalGeometry: boardFrameGeometry,
                viewport: boardStaticPreviewViewport,
                pan,
                zoom: canvasZoom,
              }),
              transformOrigin: "top left",
              background: CANVAS_BACKGROUND_VAR,
              ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
              ...getIframePaintRetentionStyle({
                viewportWidth: boardStaticPreviewViewport.width,
                viewportHeight: boardStaticPreviewViewport.height,
                effectiveScale:
                  (boardFrameGeometry.width /
                    Math.max(1, boardStaticPreviewViewport.width)) *
                  (canvasZoom / 100),
              }),
            }}
          />
        </div>
      ) : null}

      <div
        ref={worldRef}
        data-multi-screen-canvas-world
        className="pointer-events-none absolute"
        style={
          {
            left: 0,
            top: 0,
            right: focusedInteract ? 0 : undefined,
            bottom: focusedInteract ? 0 : undefined,
            transform: focusedInteractFrame
              ? `translate(${surfaceSize.width / 2 - (SURFACE_PADDING + focusedInteractFrame.geometry.x + focusedInteractFrame.geometry.width / 2) * scale}px, ${surfaceSize.height / 2 - (SURFACE_PADDING + focusedInteractFrame.geometry.y + focusedInteractFrame.geometry.height / 2) * scale}px) scale(${scale})`
              : `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: "top left",
            visibility: focusedInteract ? "hidden" : undefined,
            [CHROME_SCALE_CSS_VAR]: chromeScale,
          } as CSSProperties
        }
      >
        {boardFileId &&
          boardFileContent !== undefined &&
          boardHasSurfaceContent &&
          (() => {
            const boardGeo = boardSurfaceRenderGeometry ?? {
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
            const boardRenderContent = getBoardSurfaceRenderContent(
              boardFileContent,
              resolvedTheme === "dark",
            );
            return (
              <div
                className="[&_.design-canvas-iframe-wrapper]:shadow-none [&_.design-canvas-iframe-wrapper]:ring-0"
                data-board-surface-layer
                style={{
                  ...getBoardSurfaceLayerStyle({
                    geometry: boardGeo,
                    interactive: boardSurfaceInteractive,
                  }),
                  background: CANVAS_BACKGROUND_VAR,
                }}
              >
                <DesignCanvas
                  content={boardRenderContent}
                  authoredSourceContent={boardFileContent}
                  contentKey={boardContentKey}
                  runtimeReplacementContent={boardRenderContent}
                  runtimeReplacementKey={`${boardFileId}:layers:${boardLayerSignature}`}
                  screenId={boardFileId}
                  zoom={100}
                  deviceFrame="none"
                  boardSurface
                  transparentBackground
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
                  editMode={boardEditMode && !interactMode}
                  interactMode={interactMode}
                  scaleMode={
                    !readOnly && boardIsActive && effectiveTool === "scale"
                  }
                  readOnly={readOnly && !boardEditMode}
                  runtimeStructureInsertRequest={
                    boardRuntimeStructureInsertRequest
                  }
                  runtimeStructureRollbackRequest={
                    boardRuntimeStructureRollbackRequest
                  }
                  onRuntimeStructureInsertRejected={(reason, transactionId) => {
                    const rollbackScheduled =
                      onBoardRuntimeStructureInsertRejected?.(
                        reason,
                        transactionId,
                      ) === true;
                    const expectedTransactionId =
                      boardCrossScreenDropTransactionRef.current;
                    if (
                      !expectedTransactionId ||
                      !transactionId ||
                      expectedTransactionId !== transactionId
                    ) {
                      return;
                    }
                    if (reason === "board-drop-timeout") {
                      if (!rollbackScheduled) {
                        setBoardRuntimeSurfaceActive(null);
                        finishBoardCrossScreenDrop();
                      }
                      return;
                    }
                    setBoardRuntimeSurfaceActive(null);
                    finishBoardCrossScreenDrop();
                  }}
                  onRuntimeStructureInsertApplied={(details) => {
                    const expectedTransactionId =
                      boardCrossScreenDropTransactionRef.current;
                    if (
                      !expectedTransactionId ||
                      !details.transactionId ||
                      expectedTransactionId !== details.transactionId
                    ) {
                      handleBoardRuntimeStructureInsertApplied(details);
                      return;
                    }
                    if (details.applied !== false) {
                      setBoardRuntimeSurfaceActive(boardFileId ?? null);
                    }
                    handleBoardRuntimeStructureInsertApplied(details);
                    finishBoardCrossScreenDrop({ preserveTransaction: true });
                  }}
                  onRuntimeStructureRollbackResult={(details) => {
                    const expectedTransactionId =
                      boardCrossScreenDropTransactionRef.current;
                    if (
                      !expectedTransactionId ||
                      !details.transactionId ||
                      expectedTransactionId !== details.transactionId
                    ) {
                      handleBoardRuntimeStructureRollbackResult(details);
                      return;
                    }
                    if (details.applied) setBoardRuntimeSurfaceActive(null);
                    handleBoardRuntimeStructureRollbackResult(details);
                    finishBoardCrossScreenDrop({ force: true });
                  }}
                  clearSelectionRequest={boardClearSelectionRequest}
                  selectedSelector={boardSelectedSelector ?? null}
                  selectedSelectorCandidates={
                    boardSelectedSelectorCandidates ?? []
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
                  registerRuntimeBridge={boardIsActive}
                  onElementSelect={onBoardElementSelect ?? (() => {})}
                  onElementMarqueeSelect={onBoardElementMarqueeSelect}
                  onElementHover={onBoardElementHover ?? (() => {})}
                  onClearSelection={onBoardElementClear}
                  onIframeHotkey={onBoardIframeHotkey}
                  onFigmaClipboardPaste={onBoardFigmaClipboardPaste}
                  onImagePaste={onBoardImagePaste}
                  onIframeContextMenu={onBoardIframeContextMenu}
                  onVisualStructureChange={onBoardVisualStructureChange}
                  onVisualStyleChange={onBoardVisualStyleChange}
                  onVisualStyleBatchChange={onBoardVisualStyleBatchChange}
                  onVisualDuplicateChange={onBoardVisualDuplicateChange}
                  onTextContentChange={onBoardTextContentChange}
                  onTextEditingStateChange={handleBoardTextEditingStateChange}
                  onElementDblClickText={onBoardElementDblClickText}
                  pinMode={reviewPinMode}
                  commentPinsHidden={reviewCommentsHidden}
                  onExitPinMode={onExitReviewPinMode}
                  designId={reviewResourceId}
                  reviewCanPost={reviewCanPost}
                  reviewCanResolve={reviewCanResolve}
                  reviewTargetId={reviewTargetId ?? null}
                  reviewBoardGeometry={boardGeo}
                  onReviewFocusBoardPoint={focusBoardReviewPoint}
                  reviewCurrentUserEmail={reviewCurrentUserEmail}
                  reviewFocusRequest={reviewFocusRequest}
                  onDispatchCommentToAgent={onDispatchCommentToAgent}
                  onSendThreadToAgent={onSendThreadToAgent}
                  reviewSendingThreadId={reviewSendingThreadId}
                  designTitle={reviewDesignTitle}
                  commentContextId={
                    reviewResourceId
                      ? `${reviewResourceId}:${boardFileId}`
                      : undefined
                  }
                  tweakValues={{}}
                />
              </div>
            );
          })()}

        {renderEmptyBoardReviewCanvas &&
        boardFileId &&
        boardFileContent !== undefined &&
        reviewResourceId ? (
          <div
            data-board-review-canvas
            style={{
              ...getBoardSurfaceLayerStyle({
                geometry: boardReviewGeometry,
                interactive: false,
              }),
              zIndex: 1,
            }}
          >
            <ReviewCanvasPins
              active={reviewPinMode}
              hidden={reviewCommentsHidden}
              onClose={() => onExitReviewPinMode?.()}
              canvasSelector="[data-board-review-canvas]"
              resourceType="design"
              resourceId={reviewResourceId}
              targetId={reviewTargetId ?? null}
              boardGeometry={boardReviewGeometry}
              canPost={reviewCanPost ?? false}
              canResolve={reviewCanResolve ?? false}
              currentUserEmail={reviewCurrentUserEmail}
              focusRequest={reviewFocusRequest}
              onFocusBoardPoint={focusBoardReviewPoint}
              onDispatchCommentToAgent={onDispatchCommentToAgent}
              onSendThreadToAgent={onSendThreadToAgent}
              sendingThreadId={reviewSendingThreadId}
            />
          </div>
        ) : null}

        {canvasFrames.map(({ screen, metadata, geometry }) => {
          const baseCullTier = screenCullTierById.get(screen.id) ?? "visible";
          const isExportPreview = screen.id === exportPreviewScreenId;
          const cullTier =
            isExportPreview &&
            (baseCullTier === "placeholder" || baseCullTier === "evicted")
              ? "culled"
              : baseCullTier;
          return (
            <Screen
              key={screen.id}
              layoutGridBoardSize={layoutGridBoardSizeById[screen.id] ?? 0}
              screen={screen}
              metadata={metadata}
              screenRootComputedStylesById={screenRootComputedStylesById}
              screenRootComputedStyles={
                screenRootComputedStylesById?.[screen.id]
              }
              geometry={geometry}
              measuredIframeHeights={measuredIframeHeights}
              focusedInteract={
                screen.id === interactScreenId && focusedInteract
              }
              locked={lockedScreenIdSet.has(screen.id)}
              screenContent={screenContentById.get(screen.id)}
              bootDeferred={bootDeferredScreenIds.has(screen.id)}
              staticPreview={staticPreviewScreenIds.has(screen.id)}
              iframeAdmitted={admittedIframeIds.has(screen.id)}
              onStaticPreviewLoad={postStaticPreviewTweakValues}
              onHoverIntent={handleScreenHoverIntent}
              snapshotHtml={screenSnapshotsById?.[screen.id]?.html}
              renderBreakpointContent={
                !liveEditorScreenIds ||
                liveEditorScreenIds.has(screen.id) ||
                retainedEditorScreenIds.has(screen.id)
                  ? renderBreakpointContent
                  : undefined
              }
              getBootReadyCallback={getScreenBootReadyCallback}
              getBootStartCallback={getScreenBootStartCallback}
              cullTier={cullTier}
              isExportPreview={isExportPreview}
              isActive={screen.id === activeId}
              interactMode={interactMode || interactScreenId === screen.id}
              isTopScreen={screen.id === topScreenId}
              isSelected={
                selectedIdSet.has(screen.id) &&
                !isBreakpointSelectionTarget(screen)
              }
              elementSelectedInScreen={selectedElementScreenId === screen.id}
              showFullView={fullViewIdSet.has(screen.id)}
              pendingReview={pendingReviewScreenIdSet.has(screen.id)}
              onReviewPendingScreen={onReviewPendingScreen}
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
              contentEditable={editableScreenIds?.has(screen.id) === true}
              handlesEnabled={!hasGroupSelection && !readOnly}
              readOnly={readOnly}
              penActive={penActive}
              creationToolActive={creationToolActive}
              canvasGestureActive={canvasGestureActive}
              chromeScale={chromeScale}
              chromeSettling={chromeSettling}
              onPick={handleFrameClick}
              onEdit={handleFrameInteract}
              onEnterFrame={handleFrameEnter}
              onStartFrameDrag={beginFrameDrag}
              onStartResize={beginResize}
              onStartRotate={beginRotate}
              onAddBreakpoint={onAddBreakpoint}
              breakpointMutationPending={breakpointMutationPending}
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
            readOnly={readOnly}
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
            readOnly={readOnly}
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
                showHandles={!readOnly}
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
                showHandles={!readOnly}
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
            selectedAnchorIndex={vectorEdit.selectedAnchorIndex}
            onSelectedAnchorChange={vectorEdit.onSelectedAnchorChange}
            chromeScale={chromeScale}
            zIndex={vectorEditOverlayZIndex}
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
            handlesEnabled={!readOnly && !focusedInteract}
            showRotate
            onStartResize={(handle, event) =>
              beginResize(singleSelectedFrame.id, handle, event)
            }
            onStartRotate={(event) =>
              beginRotate(singleSelectedFrame.id, event)
            }
            onStartDrag={
              singleSelectedFrameIsRunningApp
                ? undefined
                : (event) => beginFrameDrag(singleSelectedFrame.id, event)
            }
          />
        ) : null}

        {singleSelectedDraft ? (
          <SelectionBox
            geometry={singleSelectedDraft.geometry}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            handlesEnabled={!readOnly}
            showRotate={false}
            onStartResize={(handle, event) =>
              beginDraftResize(singleSelectedDraft.id, handle, event)
            }
            onStartRotate={() => {}}
          />
        ) : null}

        {boardSelectionBoxVisible &&
        boardSelectionRect &&
        boardSurfaceRenderGeometry ? (
          <SelectionBox
            geometry={{
              ...boardSurfaceLocalPointToBoardPoint(
                {
                  x: boardSelectionRect.rect.left,
                  y: boardSelectionRect.rect.top,
                },
                boardSurfaceRenderGeometry,
              ),
              width: boardSelectionRect.rect.width,
              height: boardSelectionRect.rect.height,
              rotation: boardSelectionRect.rotationDeg,
            }}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            handlesEnabled={!readOnly}
            showRotate={false}
            boardObject
            onStartResize={beginBoardElementResize}
            onStartRotate={() => {}}
            onStartDrag={beginBoardElementDrag}
          />
        ) : null}

        {selectedGroupBounds ? (
          <GroupSelectionBox
            bounds={selectedGroupBounds}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            handlesEnabled={!readOnly}
            onStartDrag={(event) =>
              beginFrameDrag(selectedFrameEntries[0]!.id, event)
            }
            onStartResize={beginGroupResize}
            onStartRotate={beginGroupRotate}
          />
        ) : null}

        {selectedDraftGroupBounds ? (
          <GroupSelectionBox
            bounds={selectedDraftGroupBounds}
            chromeScale={chromeScale}
            chromeSettling={chromeSettling}
            handlesEnabled={!readOnly}
            onStartDrag={(event) =>
              beginDraftDrag(selectedDraftEntries[0]!.id, event)
            }
            onStartResize={beginDraftGroupResize}
          />
        ) : null}

        {alignmentGuides.map((guide, index) => (
          <span
            key={`${guide.orientation}-${guide.position}-${index}`}
            data-canvas-guide="alignment"
            className="pointer-events-none absolute z-30 bg-[var(--design-editor-measure-color)]"
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

        {equalGapGuides.map((guide, index) =>
          guide.bands.map((band, bandIndex) => (
            <SpacingGuideMark
              key={`equal-gap-${guide.orientation}-${index}-${bandIndex}`}
              band={band}
              orientation={guide.orientation}
              chromeScale={chromeScale}
            />
          )),
        )}

        {proximityMeasurements.map((measurement) => (
          <SpacingGuideMark
            key={`proximity-${measurement.orientation}`}
            band={measurement.band}
            orientation={measurement.orientation}
            chromeScale={chromeScale}
          />
        ))}

        {/* Figma-parity alt-hover measurement: orange edge-to-edge distance
            lines between the current selection and whatever frame/draft is
            under the cursor while Alt is held (pure hover, no drag). */}
        {[altHoverMeasurement?.horizontal, altHoverMeasurement?.vertical]
          .filter(
            (line): line is AltHoverMeasurementLine => !!line && !line.overlaps,
          )
          .map((line) => (
            <span
              key={`alt-hover-${line.orientation}`}
              className="pointer-events-none absolute z-40 bg-[var(--design-editor-measure-color)]"
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
              className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--design-editor-measure-color)] px-1 py-0.5 text-[10px] font-medium leading-none text-white shadow-sm"
              style={{
                left: pan.x + (SURFACE_PADDING + labelCanvasPoint.x) * scale,
                top: pan.y + (SURFACE_PADDING + labelCanvasPoint.y) * scale,
              }}
            >
              {Math.round(line.gap)}
            </span>
          );
        })}

      {/* Live width × height readout while drawing, pinned below the draft box.
          Rendered outside the transformed world so it stays a fixed size.
          Skipped for line/arrow/pen and the pre-drag zero-size state. */}
      {creationPreview &&
      creationPreview.tool !== "line" &&
      creationPreview.tool !== "arrow" &&
      creationPreview.tool !== "pen" &&
      creationPreview.geometry.width > 0 &&
      creationPreview.geometry.height > 0 ? (
        <span
          className="pointer-events-none absolute z-40 -translate-x-1/2 translate-y-1 rounded-full bg-[var(--design-editor-accent-color)] px-2 py-1 text-[11px] font-semibold leading-none text-[var(--design-editor-accent-contrast-color)] shadow-sm"
          style={{
            left:
              pan.x +
              (SURFACE_PADDING +
                creationPreview.geometry.x +
                creationPreview.geometry.width / 2) *
                scale,
            top:
              pan.y +
              (SURFACE_PADDING +
                creationPreview.geometry.y +
                creationPreview.geometry.height) *
                scale,
          }}
        >
          {Math.round(creationPreview.geometry.width)} ×{" "}
          {Math.round(creationPreview.geometry.height)}
        </span>
      ) : null}

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
            className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--design-editor-measure-color)] px-1 py-0.5 text-[10px] font-medium leading-none text-[var(--design-editor-accent-contrast-color)] shadow-sm"
            style={{
              left: pan.x + (SURFACE_PADDING + labelCanvasPoint.x) * scale,
              top: pan.y + (SURFACE_PADDING + labelCanvasPoint.y) * scale,
            }}
          >
            {Math.round(guide.gap)}
          </span>
        );
      })}

      {proximityMeasurements.map((measurement) => {
        const { band } = measurement;
        const crossMid = (band.crossStart + band.crossEnd) / 2;
        const gapMid = (band.gapStart + band.gapEnd) / 2;
        const point =
          measurement.orientation === "vertical"
            ? { x: gapMid, y: crossMid }
            : { x: crossMid, y: gapMid };
        return (
          <span
            key={`proximity-label-${measurement.orientation}`}
            className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded bg-[var(--design-editor-measure-color)] px-1 py-0.5 text-[10px] font-medium leading-none text-[var(--design-editor-accent-contrast-color)] shadow-sm"
            style={{
              left: pan.x + (SURFACE_PADDING + point.x) * scale,
              top: pan.y + (SURFACE_PADDING + point.y) * scale,
            }}
          >
            {Math.round(measurement.gap)}
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
            left: pan.x + (SURFACE_PADDING + marquee.x) * scale,
            top: pan.y + (SURFACE_PADDING + marquee.y) * scale,
            width: Math.max(1, marquee.width * scale),
            height: Math.max(1, marquee.height * scale),
          }}
        />
      ) : null}

      {primitiveDropTarget ? (
        primitiveDropTarget.placement === "before" ||
        primitiveDropTarget.placement === "after" ? (
          <span
            data-primitive-drop-target
            data-agent-native-insertion-guide
            data-primitive-drop-placement={primitiveDropTarget.placement}
            className="pointer-events-none absolute z-40 rounded-sm"
            style={getCrossScreenDropGuideStyle({
              guide: {
                placement: primitiveDropTarget.placement,
                axis: primitiveDropTarget.axis ?? "y",
                boardRect: primitiveDropTarget.boardRect,
              },
              pan,
              scale,
            })}
          />
        ) : (
          <span
            data-primitive-drop-target
            className="pointer-events-none absolute z-40 rounded-sm"
            style={{
              left:
                pan.x +
                (SURFACE_PADDING + primitiveDropTarget.boardRect.x) * scale,
              top:
                pan.y +
                (SURFACE_PADDING + primitiveDropTarget.boardRect.y) * scale,
              width: Math.max(1, primitiveDropTarget.boardRect.width * scale),
              height: Math.max(1, primitiveDropTarget.boardRect.height * scale),
              transform: primitiveDropTarget.boardRect.rotation
                ? `rotate(${primitiveDropTarget.boardRect.rotation}deg)`
                : undefined,
              border: "2px solid var(--design-editor-accent-color)",
              background:
                "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)",
            }}
          />
        )
      ) : null}

      {duplicatePreview ? (
        <div
          ref={duplicatePreviewElRef}
          data-duplicate-preview-ghost
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
              {duplicatePreview.count > 1
                ? `${duplicatePreview.display} +${duplicatePreview.count - 1}`
                : duplicatePreview.display}
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

      {transformBadge
        ? createPortal(
            <div
              data-transform-badge
              className="pointer-events-none fixed z-50 rounded border border-border bg-background/95 px-1.5 py-0.5 font-mono !text-[11px] leading-5 text-foreground shadow-lg backdrop-blur"
              style={{ left: transformBadge.x, top: transformBadge.y }}
            >
              {transformBadge.text}
            </div>,
            document.body,
          )
        : null}

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
      {crossScreenGhost ? (
        <span
          data-cross-screen-drag-ghost
          className="pointer-events-none absolute z-40 rounded border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-color)]/20 shadow"
          style={{
            ...getCrossScreenGhostStyle({
              ghost: crossScreenGhost,
              pan,
              scale,
            }),
            opacity: crossScreenGhost.dimmed ? 0.75 : 1,
            background: crossScreenGhost.background,
            borderRadius: crossScreenGhost.borderRadius,
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
  readOnly,
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
  readOnly: boolean;
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
        zIndex: preview ? DRAFT_PREVIEW_Z : (geometry.z ?? 40),
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
        if (readOnly) {
          event.stopPropagation();
          return;
        }
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
        enabled={!readOnly && !penActive && preview}
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
    const pathData =
      draft.pathData ??
      (draft.penPath
        ? serializePenPath(draft.penPath)
        : pointsToPath(draft.points ?? []));
    const paint = canvasVectorPaint({
      outline:
        draft.kind === "path" && isClosedPathData(pathData)
          ? "closed-path"
          : "open-path",
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
    const resolvedStroke = paint.stroke;
    const endpoints = vectorEndpointPairForPrimitive(
      draft.kind,
      draft.startPoint,
      draft.endPoint,
    );
    const renderEndpointShape = (
      endpoint: typeof endpoints.startPoint,
    ): ReactNode => {
      const shape = vectorEndpointShape(endpoint);
      if (!shape) return null;
      const attributes = shape.attributes;
      if (shape.tag === "circle") {
        return (
          <circle
            cx={attributes.cx}
            cy={attributes.cy}
            r={attributes.r}
            fill={attributes.fill}
            stroke={attributes.stroke}
            strokeWidth={attributes["stroke-width"]}
          />
        );
      }
      if (shape.tag === "rect") {
        return (
          <rect
            x={attributes.x}
            y={attributes.y}
            width={attributes.width}
            height={attributes.height}
            fill={attributes.fill}
          />
        );
      }
      return (
        <path
          d={attributes.d}
          fill={attributes.fill}
          stroke={attributes.stroke}
          strokeWidth={attributes["stroke-width"]}
          strokeLinecap={
            attributes["stroke-linecap"] as
              | "butt"
              | "inherit"
              | "round"
              | "square"
          }
          strokeLinejoin={
            attributes["stroke-linejoin"] as
              | "bevel"
              | "inherit"
              | "miter"
              | "round"
          }
        />
      );
    };
    const endpointMarkers = (
      [
        ["start", endpoints.startPoint],
        ["end", endpoints.endPoint],
      ] as const
    ).map(([side, endpoint]) => {
      if (endpoint === "none") return null;
      const markerId = vectorEndpointMarkerId(draft.id, side);
      return (
        <marker
          key={markerId}
          data-an-vector-endpoint-marker={side}
          id={markerId}
          markerWidth="10"
          markerHeight="10"
          refX={vectorEndpointMarkerRefX(endpoint)}
          refY="5"
          orient={vectorEndpointMarkerOrientation(side)}
          markerUnits="strokeWidth"
        >
          {renderEndpointShape(endpoint)}
        </marker>
      );
    });
    return (
      <svg
        className={cn("block size-full overflow-visible", muted)}
        viewBox={`${draft.geometry.x} ${draft.geometry.y} ${draft.geometry.width} ${draft.geometry.height}`}
      >
        {endpointMarkers.some(Boolean) ? <defs>{endpointMarkers}</defs> : null}
        <path
          d={pathData}
          fill={paint.fill}
          stroke={resolvedStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={paint.strokeWidth}
          markerStart={
            endpoints.startPoint === "none"
              ? undefined
              : `url(#${vectorEndpointMarkerId(draft.id, "start")})`
          }
          markerEnd={
            endpoints.endPoint === "none"
              ? undefined
              : `url(#${vectorEndpointMarkerId(draft.id, "end")})`
          }
        />
      </svg>
    );
  }

  if (draft.kind === "text") {
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
    const frameStyle = canvasPrimitiveReactStyle("frame", {
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
    return <div className={cn("size-full", muted)} style={frameStyle} />;
  }

  if (draft.kind === "ellipse") {
    const ellipseStyle = canvasPrimitiveReactStyle("ellipse", {
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
    return <div className={cn("size-full", muted)} style={ellipseStyle} />;
  }

  if (draft.kind === "polygon" || draft.kind === "star") {
    const polygonPaint = canvasVectorPaint({
      outline: "shape",
      fill: draft.fill,
      stroke: draft.stroke,
      strokeWidth: draft.strokeWidth,
    });
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
          fill={polygonPaint.fill}
          stroke={polygonPaint.stroke}
          strokeLinejoin="round"
          strokeWidth={polygonPaint.strokeWidth}
        />
      </svg>
    );
  }

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

function VectorEditOverlay({
  vectorEdit,
  selectedAnchorIndex,
  onSelectedAnchorChange,
  chromeScale,
  zIndex,
}: {
  vectorEdit: VectorEditOverlayState;
  selectedAnchorIndex: number | null;
  onSelectedAnchorChange: (nodeIndex: number | null) => void;
  chromeScale: number;
  zIndex: number;
}) {
  const { path, originCanvas } = vectorEdit;
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
      className="pointer-events-auto absolute"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
        zIndex,
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
          className={cn(
            "pointer-events-auto absolute rounded-[2px] border shadow-sm border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)]",
            selectedAnchorIndex === index &&
              "ring-2 ring-[var(--design-editor-accent-color)]",
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
              className="pointer-events-auto absolute rounded-full border border-[var(--design-editor-accent-color)] bg-background shadow-sm"
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

type GradientDragKind =
  | { kind: "endpoint"; which: "start" | "end" }
  | { kind: "stop"; stopId: string };

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
  const containerRef = useRef<HTMLDivElement>(null);

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

function screenDisplayName(
  screen: ScreenFile,
  metadata: ResolvedScreenMetadata,
): string {
  return metadata.title ?? prettyScreenName(screen.filename);
}

function screenRootRequiresTransparentHost(
  styles?: Record<string, string>,
): boolean {
  if (!styles) return false;
  const background = parseCssColorExtended(styles.backgroundColor ?? "");
  if (background && background.a < 1) return true;
  const opacity = Number.parseFloat(styles.opacity ?? "1");
  if (Number.isFinite(opacity) && opacity < 1) return true;
  return [
    styles.borderRadius,
    styles.borderTopLeftRadius,
    styles.borderTopRightRadius,
    styles.borderBottomRightRadius,
    styles.borderBottomLeftRadius,
  ].some((value) =>
    Boolean(value && !/^0(?:px|%)?(?:\s+0(?:px|%)?){0,3}$/i.test(value)),
  );
}

const STANDARD_BREAKPOINT_WIDTHS = [390, 768, 1280] as const;

function breakpointLabel(widthPx: number): string {
  if (widthPx <= 640) return "Mobile";
  if (widthPx <= 1024) return "Tablet";
  return "Desktop";
}

function nextBreakpointWidth(
  existing: number[],
  primaryWidthPx: number,
): number | undefined {
  return STANDARD_BREAKPOINT_WIDTHS.find(
    (width) =>
      !existing.includes(width) && Math.abs(width - primaryWidthPx) > 1,
  );
}

interface ScreenProps {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  screenRootComputedStylesById?: Record<string, Record<string, string>>;
  screenRootComputedStyles?: Record<string, string>;
  geometry: FrameGeometry;
  measuredIframeHeights: Record<string, number>;
  locked: boolean;
  isActive: boolean;
  interactMode: boolean;
  focusedInteract: boolean;
  isSelected: boolean;
  elementSelectedInScreen: boolean;
  isTopScreen: boolean;
  showFullView: boolean;
  pendingReview: boolean;
  onReviewPendingScreen?: (screenId: string) => void;
  readOnly: boolean;
  isDirectlyHovered: boolean;
  isFileDragOver: boolean;
  hasHoveredChild: boolean;
  groupSelected: boolean;
  contentEditable: boolean;
  handlesEnabled: boolean;
  penActive: boolean;
  creationToolActive: boolean;
  canvasGestureActive: boolean;
  chromeScale: number;
  chromeSettling: boolean;
  screenContent?: ReactNode;
  bootDeferred: boolean;
  staticPreview: boolean;
  iframeAdmitted: boolean;
  onStaticPreviewLoad?: (iframe: HTMLIFrameElement) => void;
  onHoverIntent?: (screenId: string, hovered: boolean) => void;
  snapshotHtml?: string;
  renderBreakpointContent?: MultiScreenCanvasProps["renderBreakpointContent"];
  getBootReadyCallback?: (screenId: string, frameId: string) => () => void;
  getBootStartCallback?: (screenId: string, frameId: string) => () => void;
  cullTier: ScreenCullTier;
  isExportPreview: boolean;
  onPick: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  onEdit: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  onEnterFrame: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  onStartFrameDrag: (id: string, e: React.MouseEvent) => void;
  onStartResize: (
    id: string,
    handle: ResizeHandle,
    e: React.MouseEvent,
  ) => void;
  onStartRotate: (id: string, e: React.MouseEvent) => void;
  onAddBreakpoint?: (widthPx: number) => void;
  breakpointMutationPending?: boolean;
  onActiveBreakpointChange?: (
    screenId: string,
    widthPx: number | undefined,
  ) => void;
  onRemoveBreakpoint?: (screenId: string, widthPx: number) => void;
  onChangeBreakpointWidth?: (
    screenId: string,
    widthPx: number,
    nextWidthPx: number,
  ) => void;
  onEditBreakpoint?: (screenId: string, widthPx: number) => void;
  layoutGridBoardSize?: number;
}

const Screen = memo(function Screen({
  layoutGridBoardSize = 0,
  screen,
  metadata,
  screenRootComputedStylesById,
  screenRootComputedStyles,
  geometry,
  measuredIframeHeights,
  locked,
  isActive,
  interactMode,
  focusedInteract,
  isSelected,
  elementSelectedInScreen,
  isTopScreen,
  showFullView,
  pendingReview,
  onReviewPendingScreen,
  readOnly,
  isDirectlyHovered,
  isFileDragOver,
  hasHoveredChild,
  groupSelected,
  contentEditable,
  handlesEnabled,
  penActive,
  creationToolActive,
  canvasGestureActive,
  chromeScale,
  chromeSettling,
  onPick,
  onEdit,
  onEnterFrame,
  onStartFrameDrag,
  onStartResize,
  onStartRotate,
  screenContent,
  bootDeferred,
  staticPreview,
  iframeAdmitted,
  onStaticPreviewLoad,
  onHoverIntent,
  snapshotHtml,
  renderBreakpointContent,
  getBootReadyCallback,
  getBootStartCallback,
  cullTier,
  isExportPreview,
  onAddBreakpoint,
  breakpointMutationPending = false,
  onActiveBreakpointChange,
  onRemoveBreakpoint,
  onChangeBreakpointWidth,
  onEditBreakpoint,
}: ScreenProps) {
  const t = useT();
  const browserOrigin = useBrowserOrigin();
  const display = screenDisplayName(screen, metadata);
  const previewUrl = metadata.previewUrl ?? getPreviewUrl(screen.content);
  const externalPreviewPendingOrigin = Boolean(previewUrl && !browserOrigin);
  const previewViewport = getScreenPreviewViewport(
    focusedInteract ? geometry : metadata,
    geometry,
  );
  const suppressNextClick = useRef(false);
  const { shouldMount: shouldMountContent } =
    getScreenContentCullState(cullTier);
  const [directlyHovered, setDirectlyHovered] = useState(false);
  const frameDirectlyHovered =
    (directlyHovered || isDirectlyHovered) &&
    !locked &&
    !creationToolActive &&
    !canvasGestureActive;
  const childHoverActive =
    hasHoveredChild && !creationToolActive && !canvasGestureActive;
  const suppressFrameChromeForChild =
    hasHoveredChild && !directlyHovered && !isDirectlyHovered;
  const emphasized = isSelected || frameDirectlyHovered;
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
    (interactMode ||
      isSelected ||
      hasScreenChildLayers(screen.content) ||
      contentEditable) &&
    !locked &&
    !penActive &&
    !creationToolActive &&
    !canvasGestureActive;
  const showStaticPreview =
    !screenContent &&
    iframeAdmitted &&
    (shouldMountContent ? !bootDeferred || !previewUrl : staticPreview);
  const staticSrcdocNeeded =
    !previewUrl &&
    (showStaticPreview ||
      (shouldMountContent &&
        !bootDeferred &&
        (screen.breakpointWidths?.length ?? 0) > 0));
  const fitBodyToFrame = metadata.heightMode !== "hug";
  const srcdocWithHitTest = useMemo(() => {
    if (!staticSrcdocNeeded) return "";
    return injectSessionReplayIframeBootstrap(
      appendContentSizeReporter(
        appendHitTestResponder(
          injectDocumentMarkup(
            getEmbeddedFrameDocumentContent({
              content: withLocalRuntimes(screen.content),
              fitBodyToFrame,
            }),
            STATIC_PREVIEW_TWEAK_BRIDGE,
          ),
          screen.content,
        ),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitBodyToFrame, screen.content, staticSrcdocNeeded]);

  const deferredSnapshot =
    cullTier === "visible" && bootDeferred && snapshotHtml ? (
      <iframe
        data-screen-snapshot
        aria-hidden="true"
        tabIndex={-1}
        sandbox=""
        srcDoc={snapshotHtml}
        className="pointer-events-none border-0"
        style={{
          width: previewViewport.viewportWidth,
          height: previewViewport.viewportHeight,
          transform:
            previewViewport.scale === 1
              ? undefined
              : `scale(${previewViewport.scale})`,
          transformOrigin: "top left",
          backgroundColor: "white",
          colorScheme: "light",
          ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
          ...getIframePaintRetentionStyle({
            viewportWidth: previewViewport.viewportWidth,
            viewportHeight: previewViewport.viewportHeight,
            effectiveScale:
              previewViewport.scale / Math.max(chromeScale, 0.001),
          }),
        }}
        title={`${screen.filename} snapshot`}
      />
    ) : null;

  const updateDirectHover = useCallback((next: boolean) => {
    setDirectlyHovered((current) => (current === next ? current : next));
  }, []);
  const hoverWantsLiveEditor = frameDirectlyHovered && !screenContent;
  useEffect(() => {
    onHoverIntent?.(screen.id, hoverWantsLiveEditor);
  }, [hoverWantsLiveEditor, onHoverIntent, screen.id]);
  const frameLabelHeight = focusedInteract
    ? 0
    : FRAME_LABEL_HEIGHT * chromeScale;
  const frameScreenWidth = geometry.width / Math.max(chromeScale, 0.001);
  const compactFullView = frameScreenWidth < FRAME_HEADER_BUTTON_COMPACT_WIDTH;
  const frameActionLabel = t("designEditor.modes.interact");
  const labelInfoMaxWidth = Math.min(
    frameScreenWidth,
    Math.max(
      64,
      frameScreenWidth -
        (compactFullView
          ? FRAME_HEADER_COMPACT_BUTTON_RESERVE
          : FRAME_HEADER_BUTTON_RESERVE),
    ),
  );
  const frameLabelHidden = frameScreenWidth < FRAME_LABEL_MIN_SCREEN_WIDTH;
  const fullViewMaxWidth = compactFullView
    ? 20
    : Math.max(84, Math.min(180, frameScreenWidth * 0.46));

  return (
    <div
      data-frame-shell
      data-screen-shell
      data-screen-interact-mode={interactMode ? "true" : "false"}
      data-frame-id={screen.id}
      className="group/frame pointer-events-auto absolute"
      style={{
        ...frameStyleLeftTop(geometry, frameLabelHeight),
        width: geometry.width,
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        visibility: focusedInteract ? "visible" : undefined,
        transformOrigin: `${geometry.width / 2}px ${frameLabelHeight + geometry.height / 2}px`,
        zIndex: isTopScreen
          ? (geometry.z ?? 0) + TOP_SCREEN_Z_BOOST
          : geometry.z,
      }}
    >
      <div
        className="relative w-full cursor-default"
        style={{
          height: frameLabelHeight,
          display: focusedInteract ? "none" : undefined,
        }}
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
          if (readOnly) {
            e.stopPropagation();
            return;
          }
          suppressNextClick.current = false;
          if (e.altKey) {
            suppressNextClick.current = true;
          } else if (e.shiftKey && !isSelected) {
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
            visibility: frameLabelHidden ? "hidden" : undefined,
            transform: `translateY(-50%) scale(var(${CHROME_SCALE_CSS_VAR}, ${chromeScale}))`,
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
          {pendingReview && onReviewPendingScreen ? (
            <button
              type="button"
              data-node-rewrite-review-badge
              className="flex h-5 shrink-0 items-center gap-1 rounded-full border border-border bg-background/95 px-1.5 !text-[9px] font-medium text-foreground shadow-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={t("designEditor.nodeRewrite.reviewCandidate")}
              aria-label={t("designEditor.nodeRewrite.reviewCandidate")}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onReviewPendingScreen(screen.id);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span className="size-1.5 rounded-full bg-primary" />
              {t("designEditor.nodeRewrite.reviewCandidate")}
            </button>
          ) : null}
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
          data-compact={compactFullView || undefined}
          className={cn(
            "absolute left-1/2 top-1/2 z-40 flex h-5 shrink-0 -translate-x-1/2 items-center overflow-hidden rounded-md border border-border bg-background/95 text-[10px] font-medium text-foreground opacity-0 shadow-sm transition-opacity",
            compactFullView ? "w-5 justify-center px-0" : "gap-1 px-1.5",
            "hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            fullViewVisible && "opacity-100",
          )}
          style={{
            display: focusedInteract ? "none" : undefined,
            maxWidth: fullViewMaxWidth,
            transform: `translate(-50%, -50%) scale(var(${CHROME_SCALE_CSS_VAR}, ${chromeScale}))`,
            transformOrigin: "center center",
            transition: getChromeLabelTransition(
              chromeSettling && fullViewVisible,
            ),
          }}
          aria-label={frameActionLabel}
          title={frameActionLabel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit(screen.id, event);
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseEnter={() => updateDirectHover(true)}
          onMouseLeave={() => updateDirectHover(false)}
        >
          <IconHandClick className="size-3 shrink-0" />
          <span className={cn("truncate", compactFullView && "sr-only")}>
            {frameActionLabel}
          </span>
        </button>
      </div>
      <div
        data-screen-card
        role="button"
        tabIndex={0}
        onClick={(e) => {
          const interactiveContent = isInteractiveScreenContentTarget(e.target);
          e.stopPropagation();
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            return;
          }
          if (e.detail > 1) return;
          if (interactiveContent && isSelected) return;
          onPick(screen.id, e);
        }}
        onDoubleClick={(e) => {
          if (isInteractiveScreenContentTarget(e.target)) {
            e.stopPropagation();
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onEnterFrame(screen.id, e);
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
          if (readOnly) {
            e.stopPropagation();
            return;
          }
          if (e.button === 0) {
            suppressNextClick.current = false;
            if (e.altKey) {
              suppressNextClick.current = true;
            } else if (e.shiftKey && !isSelected) {
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
          "group/artboard relative block overflow-visible bg-background text-left outline-none transition-colors",
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
          backgroundColor: screenRootRequiresTransparentHost(
            screenRootComputedStyles,
          )
            ? "transparent"
            : undefined,
          cursor: penActive || creationToolActive ? "crosshair" : "pointer",
          touchAction: "none",
        }}
      >
        <span
          data-screen-content
          data-file-drag-over={isFileDragOver || undefined}
          data-cull-tier={cullTier}
          className={cn(
            // guard:allow-raw-color — preserve the document's white default independently of the editor theme.
            "relative block h-full w-full overflow-clip rounded-[inherit] bg-white ring-1 ring-inset ring-border transition-colors",
            isFileDragOver &&
              "ring-2 ring-[var(--design-editor-accent-color)] ring-inset",
          )}
          style={{
            pointerEvents: screenContentInteractive ? "auto" : "none",
            backgroundColor: screenRootRequiresTransparentHost(
              screenRootComputedStyles,
            )
              ? "transparent"
              : undefined,
            borderRadius: screenRootComputedStyles?.borderRadius,
            borderTopLeftRadius: screenRootComputedStyles?.borderTopLeftRadius,
            borderTopRightRadius:
              screenRootComputedStyles?.borderTopRightRadius,
            borderBottomRightRadius:
              screenRootComputedStyles?.borderBottomRightRadius,
            borderBottomLeftRadius:
              screenRootComputedStyles?.borderBottomLeftRadius,
          }}
        >
          {screenContent ??
            (!showStaticPreview ? (
              (deferredSnapshot ?? (
                <div
                  data-screen-placeholder
                  aria-hidden="true"
                  className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground"
                >
                  <span className="max-w-[80%] truncate px-2 text-center !text-[11px] font-medium">
                    {display}
                  </span>
                </div>
              ))
            ) : externalPreviewPendingOrigin ? null : (
              <iframe
                {...{
                  [SESSION_REPLAY_IFRAME_ATTRIBUTE]: previewUrl
                    ? undefined
                    : "",
                }}
                data-screen-iframe-id={screen.id}
                data-screen-static-preview={previewUrl ? undefined : ""}
                src={previewUrl}
                srcDoc={previewUrl ? undefined : srcdocWithHitTest}
                sandbox={getDesignCanvasIframeSandbox({
                  externalPreview: Boolean(previewUrl),
                  readOnly: true,
                  previewUrl,
                  parentOrigin: browserOrigin ?? undefined,
                })}
                onLoad={
                  previewUrl
                    ? undefined
                    : (event) => onStaticPreviewLoad?.(event.currentTarget)
                }
                loading={
                  isExportPreview || cullTier === "visible" ? "eager" : "lazy"
                }
                className="pointer-events-none border-0"
                style={{
                  width: previewViewport.viewportWidth,
                  height: previewViewport.viewportHeight,
                  transform:
                    previewViewport.scale === 1
                      ? undefined
                      : `scale(${previewViewport.scale})`,
                  transformOrigin: "top left",
                  backgroundColor: "white",
                  colorScheme: "light",
                  ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
                  ...getIframePaintRetentionStyle({
                    viewportWidth: previewViewport.viewportWidth,
                    viewportHeight: previewViewport.viewportHeight,
                    effectiveScale:
                      previewViewport.scale / Math.max(chromeScale, 0.001),
                  }),
                }}
                title={screen.filename}
              />
            ))}
          {layoutGridBoardSize > 0 ? (
            <span
              data-layout-grid={screen.id}
              data-layout-grid-size={layoutGridBoardSize}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                backgroundImage: `linear-gradient(to right, var(--design-editor-layout-grid-color) ${LAYOUT_GRID_LINE_CSS}, transparent ${LAYOUT_GRID_LINE_CSS}), linear-gradient(to bottom, var(--design-editor-layout-grid-color) ${LAYOUT_GRID_LINE_CSS}, transparent ${LAYOUT_GRID_LINE_CSS})`,
                backgroundSize: `${layoutGridBoardSize}px ${layoutGridBoardSize}px`,
              }}
            />
          ) : null}
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
            borderWidth: chromeScale,
            transition: getChromeBorderTransition(
              chromeSettling && showHoverChrome,
            ),
          }}
          aria-hidden="true"
        />
        <span className="pointer-events-none absolute inset-0 rounded-[inherit] border border-black/5" />
        <ResizeHandles
          active={false}
          enabled={
            !focusedInteract &&
            !selectionOutlined &&
            !elementSelectedInScreen &&
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
      {!focusedInteract &&
      screen.breakpointWidths &&
      screen.breakpointWidths.length > 0 ? (
        <BreakpointPreviewRow
          screen={screen}
          primaryGeometry={geometry}
          measuredIframeHeights={measuredIframeHeights}
          primaryScale={previewViewport.scale}
          naturalAspect={metadata.height / Math.max(1, metadata.width)}
          previewUrl={previewUrl}
          srcdocWithHitTest={srcdocWithHitTest}
          metadata={metadata}
          screenRootComputedStylesById={screenRootComputedStylesById}
          renderBreakpointContent={renderBreakpointContent}
          getBootReadyCallback={getBootReadyCallback}
          getBootStartCallback={getBootStartCallback}
          onStaticPreviewLoad={onStaticPreviewLoad}
          activeBreakpointWidth={screen.activeBreakpointWidth}
          isScreenSelected={isSelected}
          penActive={penActive}
          creationToolActive={creationToolActive}
          cullTier={cullTier}
          bootDeferred={bootDeferred}
          chromeScale={chromeScale}
          chromeSettling={chromeSettling}
          onPick={onPick}
          onStartFrameDrag={onStartFrameDrag}
          onActiveBreakpointChange={
            onActiveBreakpointChange
              ? (widthPx) => onActiveBreakpointChange(screen.id, widthPx)
              : undefined
          }
          onAddBreakpoint={onAddBreakpoint}
          breakpointMutationPending={breakpointMutationPending}
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

function sameBreakpointMeasuredHeights(
  screen: ScreenFile,
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  if (a === b) return true;
  for (const width of screen.breakpointWidths ?? []) {
    const key = getBreakpointIframeId(screen.id, width);
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function areScreenPropsEqual(prev: ScreenProps, next: ScreenProps) {
  return (
    prev.screen === next.screen &&
    prev.screenRootComputedStyles === next.screenRootComputedStyles &&
    sameScreenRootComputedStylesById(
      prev.screen,
      prev.screenRootComputedStylesById,
      next.screenRootComputedStylesById,
    ) &&
    sameBreakpointMeasuredHeights(
      prev.screen,
      prev.measuredIframeHeights,
      next.measuredIframeHeights,
    ) &&
    prev.screenContent === next.screenContent &&
    prev.bootDeferred === next.bootDeferred &&
    prev.staticPreview === next.staticPreview &&
    prev.iframeAdmitted === next.iframeAdmitted &&
    prev.onStaticPreviewLoad === next.onStaticPreviewLoad &&
    prev.onHoverIntent === next.onHoverIntent &&
    prev.snapshotHtml === next.snapshotHtml &&
    prev.renderBreakpointContent === next.renderBreakpointContent &&
    prev.getBootReadyCallback === next.getBootReadyCallback &&
    prev.getBootStartCallback === next.getBootStartCallback &&
    prev.cullTier === next.cullTier &&
    prev.isExportPreview === next.isExportPreview &&
    sameResolvedMetadata(prev.metadata, next.metadata) &&
    sameFrameGeometry(prev.geometry, next.geometry) &&
    prev.isActive === next.isActive &&
    prev.focusedInteract === next.focusedInteract &&
    prev.isSelected === next.isSelected &&
    prev.elementSelectedInScreen === next.elementSelectedInScreen &&
    prev.isTopScreen === next.isTopScreen &&
    prev.showFullView === next.showFullView &&
    prev.isDirectlyHovered === next.isDirectlyHovered &&
    prev.isFileDragOver === next.isFileDragOver &&
    prev.hasHoveredChild === next.hasHoveredChild &&
    prev.groupSelected === next.groupSelected &&
    prev.contentEditable === next.contentEditable &&
    prev.readOnly === next.readOnly &&
    prev.interactMode === next.interactMode &&
    prev.handlesEnabled === next.handlesEnabled &&
    prev.penActive === next.penActive &&
    prev.creationToolActive === next.creationToolActive &&
    prev.canvasGestureActive === next.canvasGestureActive &&
    prev.chromeScale === next.chromeScale &&
    prev.chromeSettling === next.chromeSettling &&
    prev.onPick === next.onPick &&
    prev.onEdit === next.onEdit &&
    prev.onEnterFrame === next.onEnterFrame &&
    prev.onStartFrameDrag === next.onStartFrameDrag &&
    prev.onStartResize === next.onStartResize &&
    prev.onStartRotate === next.onStartRotate &&
    prev.onAddBreakpoint === next.onAddBreakpoint &&
    prev.breakpointMutationPending === next.breakpointMutationPending &&
    prev.onActiveBreakpointChange === next.onActiveBreakpointChange &&
    prev.onRemoveBreakpoint === next.onRemoveBreakpoint &&
    prev.onChangeBreakpointWidth === next.onChangeBreakpointWidth &&
    prev.onEditBreakpoint === next.onEditBreakpoint
  );
}

function sameScreenRootComputedStylesById(
  screen: ScreenFile,
  prev: Record<string, Record<string, string>> | undefined,
  next: Record<string, Record<string, string>> | undefined,
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev[screen.id] !== next[screen.id]) return false;
  return (screen.breakpointWidths ?? []).every(
    (widthPx) =>
      prev[getBreakpointIframeId(screen.id, widthPx)] ===
      next[getBreakpointIframeId(screen.id, widthPx)],
  );
}

const BREAKPOINT_LABEL_WITH_WIDTH_MIN_FRAME_WIDTH = 128;

function BreakpointPreviewRow({
  screen,
  primaryGeometry,
  measuredIframeHeights,
  primaryScale,
  naturalAspect,
  previewUrl,
  srcdocWithHitTest,
  metadata,
  screenRootComputedStylesById,
  renderBreakpointContent,
  getBootReadyCallback,
  getBootStartCallback,
  onStaticPreviewLoad,
  activeBreakpointWidth,
  isScreenSelected,
  penActive,
  creationToolActive,
  cullTier,
  bootDeferred,
  chromeScale,
  chromeSettling,
  onPick,
  onStartFrameDrag,
  onActiveBreakpointChange,
  onAddBreakpoint,
  breakpointMutationPending = false,
  onRemoveBreakpoint,
  onChangeBreakpointWidth,
  onEditBreakpoint,
  canEdit = false,
}: {
  screen: ScreenFile;
  primaryGeometry: FrameGeometry;
  measuredIframeHeights: Record<string, number>;
  primaryScale: number;
  naturalAspect: number;
  previewUrl: string | undefined;
  srcdocWithHitTest: string;
  metadata: ResolvedScreenMetadata;
  screenRootComputedStylesById?: Record<string, Record<string, string>>;
  renderBreakpointContent?: MultiScreenCanvasProps["renderBreakpointContent"];
  getBootReadyCallback?: ScreenProps["getBootReadyCallback"];
  getBootStartCallback?: ScreenProps["getBootStartCallback"];
  onStaticPreviewLoad?: ScreenProps["onStaticPreviewLoad"];
  activeBreakpointWidth: number | undefined;
  isScreenSelected: boolean;
  penActive: boolean;
  creationToolActive: boolean;
  cullTier: ScreenCullTier;
  bootDeferred: boolean;
  chromeScale: number;
  chromeSettling: boolean;
  onPick?: (id: string, e: React.MouseEvent<HTMLElement>) => void;
  onStartFrameDrag?: (id: string, e: React.MouseEvent) => void;
  onActiveBreakpointChange?: (widthPx: number | undefined) => void;
  onAddBreakpoint?: (widthPx: number) => void;
  breakpointMutationPending?: boolean;
  onRemoveBreakpoint?: (widthPx: number) => void;
  onChangeBreakpointWidth?: (widthPx: number, nextWidthPx: number) => void;
  onEditBreakpoint?: (widthPx: number) => void;
  canEdit?: boolean;
}) {
  const t = useT();
  const browserOrigin = useBrowserOrigin();
  const externalPreviewPendingOrigin = Boolean(previewUrl && !browserOrigin);
  const frameActionLabel = t("designEditor.modes.interact");
  const primaryWidthPx = metadata.width ?? primaryGeometry.width;
  const breakpointWidths = visibleBreakpointWidths(
    screen.breakpointWidths,
    primaryWidthPx,
  );
  let offsetX = primaryGeometry.width + BREAKPOINT_FRAME_GAP;

  const nextWidth = nextBreakpointWidth(breakpointWidths, primaryWidthPx);
  const [menuOpenForWidth, setMenuOpenForWidth] = useState<number | null>(null);
  const [widthDraft, setWidthDraft] = useState("");
  const { shouldMount: shouldMountContent } =
    getScreenContentCullState(cullTier);

  return (
    <>
      {breakpointWidths.map((widthPx) => {
        const { frameWidth, frameHeight, naturalHeight, scale } =
          getBreakpointFrameGeometry({
            widthPx,
            naturalAspect,
            primaryScale,
            contentHeightPx:
              metadata.heightMode === "fixed"
                ? undefined
                : (measuredIframeHeights[
                    getBreakpointIframeId(screen.id, widthPx)
                  ] ??
                  getResponsiveBreakpointHeightPx(
                    { breakpointHeights: screen.breakpointHeights },
                    widthPx,
                  )),
          });
        const isActive = activeBreakpointWidth === widthPx;
        const editableContent = bootDeferred
          ? undefined
          : renderBreakpointContent?.(screen, metadata, {
              widthPx,
              viewportHeight: naturalHeight,
              displayWidth: frameWidth,
              displayHeight: frameHeight,
              active: isActive,
              onBootReady: getBootReadyCallback?.(
                screen.id,
                `breakpoint:${widthPx}`,
              ),
              onBootStart: getBootStartCallback?.(
                screen.id,
                `breakpoint:${widthPx}`,
              ),
            });
        const currentOffsetX = offsetX;
        offsetX += frameWidth + BREAKPOINT_FRAME_GAP;
        const showBreakpointWidth =
          frameWidth >= BREAKPOINT_LABEL_WITH_WIDTH_MIN_FRAME_WIDTH;
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
        const rootStyles =
          screenRootComputedStylesById?.[
            getBreakpointIframeId(screen.id, widthPx)
          ];
        const transparentHost = screenRootRequiresTransparentHost(rootStyles);

        return (
          <div
            key={widthPx}
            data-frame-shell
            data-breakpoint-frame
            className="group/frame pointer-events-auto absolute"
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
                if (e.shiftKey && !isScreenSelected) {
                  e.stopPropagation();
                  return;
                }
                onStartFrameDrag?.(screen.id, e);
                onActiveBreakpointChange?.(widthPx);
              }}
            >
              <div
                data-frame-label
                className="absolute left-1 top-1/2 flex min-w-0 max-w-[calc(100%-28px)] items-center gap-1.5"
                style={{
                  transform: `translateY(-50%) scale(var(${CHROME_SCALE_CSS_VAR}, ${chromeScale}))`,
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
                {showBreakpointWidth ? (
                  <span
                    data-breakpoint-width
                    className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50"
                  >
                    {widthPx}px
                  </span>
                ) : null}
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
                    transform: `translateY(-50%) scale(var(${CHROME_SCALE_CSS_VAR}, ${chromeScale}))`,
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
                            onKeyDownCapture={(e) => {
                              e.stopPropagation();
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const nextWidthPx = parseBreakpointWidthInput(
                                widthDraft,
                                breakpointWidths.filter((w) => w !== widthPx),
                              );
                              if (nextWidthPx === null) return;
                              setMenuOpenForWidth(null);
                              if (nextWidthPx !== widthPx) {
                                onChangeBreakpointWidth(widthPx, nextWidthPx);
                              }
                            }}
                            aria-invalid={
                              parseBreakpointWidthInput(
                                widthDraft,
                                breakpointWidths.filter((w) => w !== widthPx),
                              ) === null
                            }
                            className="h-6 px-1.5 !text-[11px] tabular-nums aria-invalid:border-destructive"
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
                          disabled={breakpointMutationPending}
                          onSelect={() => {
                            if (breakpointMutationPending) return;
                            setMenuOpenForWidth(null);
                            onRemoveBreakpoint(widthPx);
                          }}
                        >
                          {breakpointMutationPending ? (
                            <span className="inline-flex items-center gap-1.5">
                              <IconLoader2 className="size-3 animate-spin" />
                              {t("designEditor.breakpointBar.remove")}
                            </span>
                          ) : (
                            t("designEditor.breakpointBar.remove")
                          )}
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
                "group/artboard relative block cursor-pointer overflow-visible bg-background text-left outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
              style={{
                width: frameWidth,
                height: frameHeight,
                backgroundColor: transparentHost ? "transparent" : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation();
                activateThisFrame(e);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                activateThisFrame(e);
                onEditBreakpoint?.(widthPx);
              }}
              onMouseDown={(e) => {
                if (e.button !== 0 || penActive || creationToolActive) return;
                if (e.shiftKey && !isScreenSelected) {
                  e.stopPropagation();
                  return;
                }
                if (e.detail > 1) {
                  e.stopPropagation();
                  return;
                }
                onStartFrameDrag?.(screen.id, e);
                onActiveBreakpointChange?.(widthPx);
              }}
            >
              {onEditBreakpoint ? (
                <button
                  type="button"
                  data-frame-full-view
                  className="absolute right-1 top-1 z-30 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border bg-background/95 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/artboard:opacity-100"
                  style={{
                    transform: `scale(var(${CHROME_SCALE_CSS_VAR}, ${chromeScale}))`,
                    transformOrigin: "right center",
                  }}
                  aria-label={frameActionLabel}
                  title={frameActionLabel}
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
                  <IconHandClick className="size-3" />
                </button>
              ) : null}
              <span
                data-screen-content
                data-cull-tier={cullTier}
                className={
                  // guard:allow-raw-color — preserve the document's white default independently of the editor theme.
                  "relative block h-full w-full overflow-clip rounded-[inherit] bg-white ring-1 ring-inset ring-border"
                }
                style={{
                  backgroundColor: transparentHost ? "transparent" : undefined,
                  borderRadius: rootStyles?.borderRadius,
                  borderTopLeftRadius: rootStyles?.borderTopLeftRadius,
                  borderTopRightRadius: rootStyles?.borderTopRightRadius,
                  borderBottomRightRadius: rootStyles?.borderBottomRightRadius,
                  borderBottomLeftRadius: rootStyles?.borderBottomLeftRadius,
                }}
              >
                {!shouldMountContent || (bootDeferred && previewUrl) ? (
                  <div
                    data-breakpoint-placeholder
                    aria-hidden="true"
                    className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground"
                  >
                    <span className="max-w-[80%] truncate px-2 text-center !text-[11px] font-medium">
                      {breakpointLabel(widthPx)}
                    </span>
                  </div>
                ) : editableContent ? (
                  editableContent
                ) : externalPreviewPendingOrigin ? null : (
                  <iframe
                    data-screen-iframe-id={getBreakpointIframeId(
                      screen.id,
                      widthPx,
                    )}
                    {...{
                      [SESSION_REPLAY_IFRAME_ATTRIBUTE]: previewUrl
                        ? undefined
                        : "",
                    }}
                    data-screen-static-preview={previewUrl ? undefined : ""}
                    src={previewUrl}
                    srcDoc={previewUrl ? undefined : srcdocWithHitTest}
                    sandbox={getDesignCanvasIframeSandbox({
                      externalPreview: Boolean(previewUrl),
                      readOnly: true,
                      previewUrl,
                      parentOrigin: browserOrigin ?? undefined,
                    })}
                    onLoad={(event) => {
                      if (!previewUrl)
                        onStaticPreviewLoad?.(event.currentTarget);
                      getBootStartCallback?.(
                        screen.id,
                        `breakpoint:${widthPx}`,
                      )?.();
                      getBootReadyCallback?.(
                        screen.id,
                        `breakpoint:${widthPx}`,
                      )?.();
                    }}
                    loading={cullTier === "visible" ? "eager" : "lazy"}
                    className="pointer-events-none border-0"
                    style={{
                      width: widthPx,
                      height: naturalHeight,
                      transform: scale === 1 ? undefined : `scale(${scale})`,
                      transformOrigin: "top left",
                      backgroundColor: "white",
                      colorScheme: "light",
                      ...SCALED_IFRAME_PAINT_RETENTION_STYLE,
                      ...getIframePaintRetentionStyle({
                        viewportWidth: widthPx,
                        viewportHeight: naturalHeight,
                        effectiveScale: scale / Math.max(chromeScale, 0.001),
                      }),
                    }}
                    title={`${screen.filename} — ${breakpointLabel(widthPx)}`}
                  />
                )}
                {shouldMountContent && (creationToolActive || penActive) ? (
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
            disabled={breakpointMutationPending}
            aria-busy={breakpointMutationPending || undefined}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-sm transition-colors",
              "hover:border-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
              breakpointMutationPending && "opacity-70",
            )}
            style={{
              transform: `scale(var(${CHROME_SCALE_CSS_VAR}, ${chromeScale}))`,
              transformOrigin: "left center",
            }}
            title={t("multiScreenCanvas.addBreakpointToAllScreens", {
              label: breakpointLabel(nextWidth),
              width: nextWidth,
            })}
            onClick={(e) => {
              e.stopPropagation();
              if (breakpointMutationPending) return;
              onAddBreakpoint(nextWidth);
            }}
          >
            {breakpointMutationPending ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconPlus className="size-3.5" />
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}

function SpacingGuideMark({
  band,
  orientation,
  chromeScale,
}: {
  band: DistanceGuideBand;
  orientation: EqualGapGuide["orientation"];
  chromeScale: number;
}) {
  const line = chromeScale;
  const serif = 5 * chromeScale;
  const crossMid = (band.crossStart + band.crossEnd) / 2;
  const length = Math.max(0, band.gapEnd - band.gapStart);
  const alongAxis = orientation === "vertical";

  return (
    <span
      data-canvas-guide="spacing"
      className="pointer-events-none absolute z-30"
      style={
        alongAxis
          ? {
              left: SURFACE_PADDING + band.gapStart,
              top: SURFACE_PADDING + crossMid - serif,
              width: length,
              height: serif * 2,
            }
          : {
              left: SURFACE_PADDING + crossMid - serif,
              top: SURFACE_PADDING + band.gapStart,
              width: serif * 2,
              height: length,
            }
      }
    >
      <span
        className="absolute bg-[var(--design-editor-measure-color)]"
        style={
          alongAxis
            ? { left: 0, top: serif - line / 2, width: length, height: line }
            : { left: serif - line / 2, top: 0, width: line, height: length }
        }
      />
      {[0, length].map((offset, index) => (
        <span
          key={index}
          className="absolute bg-[var(--design-editor-measure-color)]"
          style={
            alongAxis
              ? {
                  left: offset - line / 2,
                  top: 0,
                  width: line,
                  height: serif * 2,
                }
              : {
                  left: 0,
                  top: offset - line / 2,
                  width: serif * 2,
                  height: line,
                }
          }
        />
      ))}
    </span>
  );
}

function GroupSelectionBox({
  bounds,
  chromeScale,
  chromeSettling,
  onStartDrag,
  onStartResize,
  onStartRotate,
  handlesEnabled = true,
}: {
  bounds: NonNullable<ReturnType<typeof getFrameGroupBounds>>;
  chromeScale: number;
  chromeSettling: boolean;
  onStartDrag?: (e: React.MouseEvent) => void;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate?: (e: React.MouseEvent) => void;
  handlesEnabled?: boolean;
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
      handlesEnabled={handlesEnabled}
      filled
      onStartDrag={onStartDrag}
      onStartResize={onStartResize}
      onStartRotate={onStartRotate ?? (() => {})}
    />
  );
}

function PassiveSelectionBox({
  geometry,
  chromeScale,
  chromeSettling,
  showHandles = true,
}: {
  geometry: FrameGeometry;
  chromeScale: number;
  chromeSettling: boolean;
  showHandles?: boolean;
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
        borderWidth: 1.5 * chromeScale,
        transition: getSelectionBoxTransition(chromeSettling),
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${geometry.height / 2}px`,
        zIndex: 999_999,
      }}
    >
      {showHandles
        ? CORNER_RESIZE_HANDLE_CONFIGS.map((config) => (
            <span
              key={config.handle}
              data-passive-resize-handle={config.handle}
              className="pointer-events-none absolute z-20 rounded-none border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)] shadow"
              style={cornerHandleStyle(
                config.handle,
                config.cursor,
                chromeScale,
                chromeSettling,
                geometry.width,
                geometry.height,
              )}
            />
          ))
        : null}
    </div>
  );
}

function SelectionBox({
  geometry,
  chromeScale,
  chromeSettling,
  filled = false,
  showRotate = true,
  handlesEnabled = true,
  onStartResize,
  onStartRotate,
  onStartDrag,
  boardObject = false,
}: {
  geometry: FrameGeometry;
  chromeScale: number;
  chromeSettling: boolean;
  filled?: boolean;
  showRotate?: boolean;
  handlesEnabled?: boolean;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate: (e: React.MouseEvent) => void;
  onStartDrag?: (e: React.MouseEvent) => void;
  boardObject?: boolean;
}) {
  return (
    <div
      data-frame-selection-box
      data-frame-shell
      data-board-object-selection-box={boardObject || undefined}
      className="pointer-events-none absolute border border-[var(--design-editor-accent-color)]"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y,
        width: geometry.width,
        height: geometry.height,
        background: filled
          ? "var(--design-editor-selection-color)"
          : "transparent",
        borderWidth: 1.5 * chromeScale,
        transition: getSelectionBoxTransition(chromeSettling),
        transform: geometry.rotation
          ? `rotate(${geometry.rotation}deg)`
          : undefined,
        transformOrigin: `${geometry.width / 2}px ${geometry.height / 2}px`,
        zIndex: 1_000_000,
      }}
    >
      {onStartDrag ? (
        <span
          data-frame-drag-surface
          className="pointer-events-auto absolute inset-0 z-[5] cursor-move"
          onMouseDown={onStartDrag}
        />
      ) : null}
      <ResizeHandles
        active
        enabled={handlesEnabled}
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
  rotationDeg?: number;
  frameWidth?: number;
  frameHeight?: number;
  onStartResize: (handle: ResizeHandle, e: React.MouseEvent) => void;
  onStartRotate: (e: React.MouseEvent) => void;
}) {
  if (!enabled) return null;
  const easeGeometry = chromeSettling && (active || showOnHover);

  const visibleHandleClass = cn(
    "pointer-events-auto absolute z-20 rounded-none border border-[var(--design-editor-accent-color)] bg-[var(--design-editor-accent-contrast-color)] shadow transition-opacity",
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
            easeGeometry,
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
            easeGeometry,
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
                easeGeometry,
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

const ROTATE_HANDLE_BASE_ANGLE: Record<string, number> = {
  ne: 0,
  se: 90,
  sw: 180,
  nw: 270,
};

function quantizeAngleTo8Buckets(angleDeg: number): number {
  const normalized = ((angleDeg % 360) + 360) % 360;
  return (Math.round(normalized / 45) % 8) * 45;
}

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

function dedupeIds(ids: string[]) {
  return [...new Set(ids)];
}

function chromeScaleFromZoom(zoom: number) {
  const scale = zoom / 100;
  return scale > 0 ? 1 / scale : 1;
}

function traceOnce(
  seen: MutableRefObject<string | null>,
  area: TraceArea,
  event: string,
  message: string,
): void {
  if (seen.current === message) return;
  seen.current = message;
  trace(area, event, message);
}

function cssColorValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "transparent") return undefined;
  return /^(#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\))$/i.test(trimmed)
    ? trimmed
    : undefined;
}

function cssLengthValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "0px") return undefined;
  const lengths = trimmed.split(/\s+/);
  if (lengths.length > 4) return undefined;
  return lengths.every((length) => /^-?\d+(\.\d+)?(px|%|r?em)$/i.test(length))
    ? trimmed
    : undefined;
}

function enclosesMarqueeRect(
  geometry: FrameGeometry,
  rect: MarqueeRect,
): boolean {
  return (
    geometry.x <= rect.x &&
    geometry.y <= rect.y &&
    geometry.x + geometry.width >= rect.x + rect.width &&
    geometry.y + geometry.height >= rect.y + rect.height
  );
}

function marqueeFullyEnclosesBounds(
  rect: MarqueeRect,
  bounds: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    rect.x <= bounds.left &&
    rect.y <= bounds.top &&
    rect.x + rect.width >= bounds.right &&
    rect.y + rect.height >= bounds.bottom
  );
}

function xorMarqueeSelection(baseIds: string[], hitIds: string[]) {
  const hitSet = new Set(hitIds);
  const kept = baseIds.filter((id) => !hitSet.has(id));
  const added = hitIds.filter((id) => !baseIds.includes(id));
  return dedupeIds([...kept, ...added]);
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

function mutePreviewIframePointerEvents(
  root: HTMLElement | null,
  except?: HTMLIFrameElement | null,
) {
  if (!root) return () => {};
  const previous = new Map<HTMLIFrameElement, string>();
  root
    .querySelectorAll<HTMLIFrameElement>("[data-design-preview-iframe]")
    .forEach((iframe) => {
      if (iframe === except) return;
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

function getWheelDeltaFromValues(
  deltaX: number,
  deltaY: number,
  deltaMode: number,
) {
  return {
    x: normalizeWheelDeltaPx(deltaX, deltaMode),
    y: normalizeWheelDeltaPx(deltaY, deltaMode),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
