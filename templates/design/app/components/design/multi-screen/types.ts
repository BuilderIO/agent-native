import type { ReviewThread } from "@agent-native/core/client/review";
import type { ReviewComment } from "@agent-native/core/review";
import type {
  DistanceGuideBand,
  EqualGapGuide,
  FrameBounds,
} from "@shared/canvas-math";
import type { CodeLayerProjection, CodeLayerSource } from "@shared/code-layer";
import type { LayoutGridById } from "@shared/layout-grid";
import type { PenCuspLatch, PenPath } from "@shared/pen-path";
import type { SourceNodeProvenance } from "@shared/preview-source-provenance";
import type { VectorEndpointStyle } from "@shared/vector-endpoints";
import type { ReactNode, RefObject } from "react";

import type {
  IframeContextMenuPayload,
  IframeFigmaClipboardPastePayload,
  IframeHotkeyPayload,
  IframeImagePastePayload,
} from "../design-canvas/iframe-events";
import type {
  DeviceFrameType,
  ElementInfo,
  ElementSelectionIntent,
  PortableStyleSnapshot,
  RuntimeStructureInsertRequest,
  RuntimeStructureRollbackRequest,
} from "../types";
import type { ScreenHeightMode } from "./screen-height";

export interface ScreenFile {
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
  heightPinned?: boolean;
  heightMode?: ScreenHeightMode;
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
  codeLayerSource?: CodeLayerSource;
  connectionId?: string;
  /** Read-only localhost preview credential. Never a filesystem token. */
  previewToken?: string;
  breakpointWidths?: number[];
  breakpointHeights?: Record<string, number>;
  activeBreakpointWidth?: number;
  layoutGroupId?: string;
}

export interface ScreenProjectionNodeIdentity {
  projection: CodeLayerProjection;
  nodeId: string;
  authoredNodeId: string;
}

export interface PreparedPrimitiveCreateResult {
  nodeId: string;
  preparedTargetNodeId: string;
  preparedTargetIdentity: ScreenProjectionNodeIdentity;
}

export type PrimitiveCreateResult =
  | boolean
  | string
  | PreparedPrimitiveCreateResult;

export interface PrimitiveCreateOptions {
  nextTool?: "move" | "pen";
  reparentTargetIdentity?: ScreenProjectionNodeIdentity;
}

export type ScreenSourceType = "localhost" | "fusion" | "inline";
export type ScreenPreviewState = "live" | "snapshot" | "preview";
export type MultiScreenCanvasTool =
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

export interface CanvasToolProps {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  startPoint?: VectorEndpointStyle;
  endPoint?: VectorEndpointStyle;
  text?: string;
}

export interface CanvasPrimitiveInsert {
  kind: DraftPrimitiveKind;
  nodeId?: string;
  geometry: FrameGeometry;
  points?: Point[];
  pathData?: string;
  penPath?: PenPath;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  startPoint?: VectorEndpointStyle;
  endPoint?: VectorEndpointStyle;
  autoSize?: boolean;
}

export interface PersistedDraftPrimitive {
  frameId: string;
  nodeId: string;
  sourceNodeId?: string;
  preparedTargetNodeId?: string;
  preparedTargetIdentity?: ScreenProjectionNodeIdentity;
}

export interface ScreenMetadata {
  source?: string;
  sourceType?: string;
  lod?: string;
  previewState?: string;
  status?: string;
  title?: string;
  width?: number;
  height?: number;
  heightPinned?: boolean;
  heightMode?: Exclude<ScreenHeightMode, "auto">;
  breakpointHeights?: Record<string, number>;
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
  previewToken?: string;
}

export interface DuplicateRequest {
  mode: "alt-click" | "alt-drag";
  screen: ScreenFile;
  canvasPosition: { x: number; y: number };
  canvasOffset?: { x: number; y: number };
  dropCanvasPosition?: { x: number; y: number };
  preserveCamera?: boolean;
  historyBatchId?: string;
  duplicateStackIndex?: number;
}

export interface ScreenContentRenderOptions {
  onBootStart?: () => void;
  onBootReady?: () => void;
  cacheKey?: string | number | null;
}

export interface MultiScreenCanvasProps {
  screens: ScreenFile[];
  zoom: number;
  activeId?: string | null;
  selectedScreenIds?: string[];
  exportPreviewScreenId?: string | null;
  selectedElementScreenId?: string | null;
  selectedPenPathNodeId?: string | null;
  hiddenScreenIds?: ReadonlySet<string> | readonly string[];
  lockedScreenIds?: ReadonlySet<string> | readonly string[];
  fullViewScreenIds?: string[];
  pendingReviewScreenIds?: ReadonlySet<string> | readonly string[];
  onReviewPendingScreen?: (screenId: string) => void;
  interactMode?: boolean;
  interactScreenId?: string | null;
  focusedInteractViewport?: { width: number; height: number } | null;
  readOnly?: boolean;
  editableScreenIds?: ReadonlySet<string>;
  activeScreenHasHoveredChild?: boolean;
  hoveredChildScreenId?: string | null;
  directlyHoveredScreenId?: string | null;
  previewDeviceFrame?: DeviceFrameType;
  activeTool?: MultiScreenCanvasTool;
  reviewResourceId?: string;
  reviewPinMode?: boolean;
  reviewCommentsHidden?: boolean;
  reviewCanPost?: boolean;
  reviewCanResolve?: boolean;
  reviewTargetId?: string | null;
  reviewFocusRequest?: {
    nonce: number;
    anchor: unknown;
    targetId?: string | null;
    threadId?: string;
  } | null;
  reviewCurrentUserEmail?: string | null;
  onExitReviewPinMode?: () => void;
  onDispatchCommentToAgent?: (comment: ReviewComment) => void;
  onSendThreadToAgent?: (thread: ReviewThread) => void;
  reviewSendingThreadId?: string | null;
  reviewDesignTitle?: string;
  toolProps?: CanvasToolProps;
  onActiveToolChange?: (tool: MultiScreenCanvasTool) => void;
  onCommentPin?: (point: Point) => void;
  onPick: (id: string) => void;
  onEdit?: (id: string) => void;
  metadataById?: Record<string, ScreenMetadata | undefined>;
  screenRootComputedStylesById?: Record<string, Record<string, string>>;
  getScreenMetadata?: (screen: ScreenFile) => ScreenMetadata | undefined;
  onDuplicate?: (
    id: string,
    request: DuplicateRequest,
  ) => void | Promise<string | undefined>;
  geometryById?: Record<string, Partial<FrameGeometry> | undefined>;
  geometryOverridesById?: Record<string, FrameGeometry | undefined>;
  onGeometryChange?: (geometryById: FrameGeometryById) => void;
  onGeometryCommit?: (
    before: FrameGeometryById,
    after: FrameGeometryById,
    options?: {
      source?: "pointer" | "keyboard";
      kScaleStyleChangesByFrameId?: KScaleStyleChangesByFrameId;
    },
  ) => boolean | void;
  onBreakpointContentHeightChange?: (
    screenId: string,
    widthPx: number,
    heightPx: number,
  ) => void;
  onPrimaryContentHeightChange?: (screenId: string, heightPx: number) => void;
  onScreenContentNaturalHeightChange?: (
    screenId: string,
    heightPx: number | null,
  ) => void;
  onCreatePrimitive?: (
    screenId: string,
    primitive: CanvasPrimitiveInsert,
    options?: PrimitiveCreateOptions,
  ) => PrimitiveCreateResult;
  onPrimitiveCreated?: (
    screenId: string,
    nodeId: string,
    options?: {
      nextTool?: "move" | "pen";
      preserveActiveTool?: boolean;
    },
  ) => void;
  onUpdatePenPath?: (
    screenId: string,
    nodeId: string,
    path: PenPath,
  ) => boolean;
  onPrimitiveReparent?: (args: {
    sourceNodeId: string;
    sourceScreenId: string;
    targetNodeId: string;
    targetScreenId: string;
    targetIdentity?: ScreenProjectionNodeIdentity;
    preparedTargetNodeId?: string;
    placement: "before" | "after" | "inside";
  }) => void;
  onCreateScreenFrame?: (geometry: FrameGeometry) => void;
  frameToolDraws?: "screen" | "frame";
  onDeleteSelection?: (ids: string[]) => boolean | void;
  onNudgeSelection?: (ids: string[]) => boolean | void;
  nudgeAmounts?: { small: number; big: number };
  layoutGrids?: LayoutGridById;
  onZoomChange?: (zoom: number) => void;
  renderScreenContent?: (
    screen: ScreenFile,
    metadata: ResolvedScreenMetadata,
    geometry: FrameGeometry,
    options?: ScreenContentRenderOptions,
  ) => ReactNode;
  screenContentRenderKey?: string | number | null;
  screenSnapshotsById?: Record<string, { html: string } | undefined>;
  tweakValues?: Record<string, string>;
  renderBreakpointContent?: (
    screen: ScreenFile,
    metadata: ResolvedScreenMetadata,
    frame: {
      widthPx: number;
      viewportHeight: number;
      displayWidth: number;
      displayHeight: number;
      active: boolean;
      onBootStart?: () => void;
      onBootReady?: () => void;
    },
  ) => ReactNode;
  onScreenSelectionChange?: (ids: string[]) => void;
  selectAllRequest?: number;
  clearSelectionRequest?: number;
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
  onSelectionChange?: (selectedIds: string[]) => void;
  onLayerMarqueeSelectionChange?: (
    selection: CanvasLayerMarqueeSelection[],
    intent: ElementSelectionIntent & { final?: boolean },
  ) => void;
  selectedLayerSelectorGroupsByScreen?: Record<string, string[][]>;
  onCrossScreenElementDrop?: (args: {
    sourceSelector: string;
    sourceNodeId?: string;
    sourceDeleteRequestId?: string;
    sourceProvenance?: SourceNodeProvenance;
    targetAnchorProvenance?: SourceNodeProvenance;
    sourceScreenId: string;
    targetScreenId: string;
    targetAnchorNodeId?: string;
    targetAnchorPendingNodeId?: string;
    targetAnchorSelector?: string;
    targetAnchorPlacement?: "before" | "after" | "inside";
    targetDropMode?: CrossScreenDropMode;
    targetAnchorRect?: CrossScreenHitTestAnchorRect;
    targetCanvasPoint?: Point;
    targetLocalPoint?: Point;
    sourcePointerOffset?: Point;
    sourceComputedSize?: { width?: number; height?: number };
    sourceHtmlSnapshot?: string;
    duplicate?: boolean;
    sourceCloneHtml?: string;
    styleSnapshot?: PortableStyleSnapshot;
    styleSnapshotCaptureFailed?: boolean;
  }) => void;
  boardFileId?: string;
  canvasBackground?: string | null;
  boardFileContent?: string;
  boardCodeLayerSource?: CodeLayerSource;
  boardFrameGeometry?: FrameGeometry;
  onBoardDrawPrimitive?: (
    primitive: CanvasPrimitiveInsert,
    options?: PrimitiveCreateOptions,
  ) => PrimitiveCreateResult;
  boardEditMode?: boolean;
  boardRuntimeStructureInsertRequest?:
    | (RuntimeStructureInsertRequest & {
        screenId: string;
      })
    | null;
  boardRuntimeStructureRollbackRequest?:
    | (RuntimeStructureRollbackRequest & {
        screenId: string;
      })
    | null;
  runtimeStructurePendingTransactionRef?: RefObject<string | null>;
  onBoardRuntimeStructureInsertRejected?: (
    reason: string,
    transactionId?: string,
  ) => boolean | void;
  onBoardRuntimeStructureInsertApplied?: (details: {
    requestId: string;
    transactionId?: string;
    routePath?: string;
    selector: string;
    sourceId?: string;
    applied?: boolean;
  }) => void;
  onBoardRuntimeStructureRollbackResult?: (details: {
    requestId: string;
    transactionId?: string;
    applied: boolean;
    reason?: string;
  }) => void;
  boardIsActive?: boolean;
  onBoardElementSelect?: (
    info: ElementInfo,
    intent?: ElementSelectionIntent,
  ) => void;
  onBoardSelectionWorldBoundsChange?: (
    selection: {
      screenId: string;
      selector: string;
      memberSelectors?: readonly string[];
      memberSourceIds?: readonly string[];
      worldBounds: FrameBounds;
    } | null,
  ) => void;
  onBoardElementMarqueeSelect?: (
    infos: ElementInfo[],
    intent?: ElementSelectionIntent,
  ) => void;
  onBoardElementHover?: (info: ElementInfo | null) => void;
  onBoardElementClear?: () => void;
  onBoardElementDblClickText?: (info: ElementInfo) => void;
  onBoardIframeHotkey?: (event: IframeHotkeyPayload) => void;
  onBoardFigmaClipboardPaste?: (
    event: IframeFigmaClipboardPastePayload,
  ) => void;
  onBoardImagePaste?: (event: IframeImagePastePayload) => void;
  onBoardIframeContextMenu?: (event: IframeContextMenuPayload) => void;
  onBoardTextEditingStateChange?: (state: {
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }) => void;
  boardClearSelectionRequest?: number;
  boardSelectedSelector?: string | null;
  boardSelectedSelectorCandidates?: string[];
  boardSelectedSourceId?: string | null;
  boardHoveredSelector?: string | null;
  boardHoveredSelectorCandidates?: string[];
  boardLockedSelectors?: string[];
  boardHiddenSelectors?: string[];
  onBoardVisualStructureChange?: (
    selector: string,
    anchorSelector: string,
    placement: "before" | "after" | "inside",
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      anchorSourceId?: string;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
    },
  ) => boolean | "pending" | void;
  onBoardVisualStyleChange?: (
    selector: string,
    styles: Record<string, string>,
    info?: ElementInfo,
    metadata?: {
      phase?: "preview" | "commit";
      originalStyles?: Record<string, string>;
      preserveSelection?: boolean;
    },
  ) => void;
  onBoardVisualStyleBatchChange?: (
    changes: KScaleStyleChange[],
  ) => boolean | void;
  onBoardVisualDuplicateChange?: (
    selector: string,
    cloneHtml: string,
    info?: ElementInfo,
    details?: {
      sourceId?: string;
      sourceNodeIdMap?: readonly (readonly [string, string])[] | null;
      anchorSelector?: string;
      anchorSourceId?: string;
      anchorElementInfo?: ElementInfo;
      requestId?: string;
      dropMode?: "flow-insert" | "absolute-container";
      forceFlowPositionOverride?: boolean;
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
      placement?: "before" | "after" | "inside";
    },
  ) => boolean | "pending" | void;
  onBoardTextContentChange?: (
    selector: string,
    value: string,
    info?: ElementInfo,
    details?: { html?: string },
  ) => void;
  vectorEdit?: VectorEditOverlayState | null;
  gradientEditTarget?: GradientEditOverlayTarget | null;
  onDropFiles?: (
    files: File[],
    target: { canvasPoint: Point; frameId?: string },
  ) => void;
  cameraCommand?: {
    fitBounds: FrameBounds;
    paddingScreenPx?: number;
    nonce: number;
  } | null;
  suppressLineupRecenter?: {
    fromCount: number;
    addedCount: number;
    nonce: number;
  } | null;
  preserveCameraOnScreenCountChange?: boolean;
  deferLineupZoomChange?: boolean;
  chromeInsetLeft?: number;
  chromeInsetRight?: number;
  visibleCanvasRectRef?: RefObject<(() => VisibleCanvasRect | null) | null>;
}

export interface VisibleCanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
}

export type FrameGeometryById = Record<string, FrameGeometry>;

export interface CanvasFrameEntry {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  geometry: FrameGeometry;
}

export interface ScreenContentCacheEntry {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  width: number;
  height: number;
  renderScreenContent: NonNullable<
    MultiScreenCanvasProps["renderScreenContent"]
  >;
  renderKey: string | number | null | undefined;
  contentNode: ReactNode;
}

export interface Point {
  x: number;
  y: number;
}

export interface VectorEditOverlayState {
  path: PenPath;
  originCanvas: Point;
  selectedAnchorIndex: number | null;
  onSelectedAnchorChange: (nodeIndex: number | null) => void;
  onChange: (nextPath: PenPath, phase: "preview" | "commit") => boolean;
  onExit: () => void;
}

/**
 * Figma-parity on-canvas gradient editing handles (follow-up to IP21's
 * inspector-only `GradientEditor`). Supplied by the parent (DesignEditor)
 * whenever a fill's gradient tab is open in the inspector for a selected
 * board/draft primitive or screen frame this canvas renders chrome for; see
 * `GradientEditSessionTarget` in `inspector/GradientEditor.tsx` for the full
 * wiring contract both sides agree on. `frameOrDraftId` must match a
 * currently-selected draft primitive id or screen id for the overlay to
 * render — this component does not itself resolve "the selection", it only
 * draws chrome for whichever single selected frame/draft's id matches.
 *
 * Scope note: this renders in the *parent-DOM* chrome layer (same layer as
 * `SelectionBox`/`VectorEditOverlay`), so it only covers overview-canvas
 * board/draft primitives and screen-frame-level selections. Gradient handles
 * for elements *inside* a screen's iframe content are a separate follow-up
 * (an in-iframe bridge overlay, analogous to how `boardEditMode` element
 * selection already bridges into iframe content) — not implemented here.
 *
 * Linear-gradient only for now: `GradientEditor` also supports radial/
 * angular/diamond kinds, but this overlay only draws handles when `cssValue`
 * parses as `linear-gradient(...)`. Non-linear values (or values that fail
 * to parse) render nothing, matching the "no behavior change" contract for
 * every other unrecognized/absent target.
 */
export interface GradientEditOverlayTarget {
  frameOrDraftId: string;
  cssValue: string;
  onChange: (nextCss: string, meta?: { phase: "preview" | "commit" }) => void;
}

export interface GradientLinePoint extends Point {
  position: number;
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
export type DraftCreationTool =
  | "frame"
  | "rect"
  | "line"
  | "arrow"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "pen";

export interface DraftPrimitive {
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
  startPoint?: VectorEndpointStyle;
  endPoint?: VectorEndpointStyle;
  autoSize?: boolean;
}

export type DraftPrimitiveById = Record<string, DraftPrimitive>;

export interface DraftGeometryModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface DraftPrimitiveInput {
  tool: DraftCreationTool;
  start: Point;
  end: Point;
  moved: boolean;
  toolProps?: CanvasToolProps;
  modifiers?: DraftGeometryModifiers;
}

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface KScaleStyleChange {
  selector: string;
  sourceId?: string;
  elementInfo?: ElementInfo;
  styles: Record<string, string>;
  originalStyles?: Record<string, string>;
  preserveSelection?: boolean;
}

export type KScaleStyleChangesByFrameId = Record<string, KScaleStyleChange[]>;

export interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  start: number;
  end: number;
}

export interface MoveDragState {
  type: "move";
  originClient: Point;
  originFrames: FrameGeometryById;
  targetIds: string[];
  primaryId: string;
  hasMoved: boolean;
}

export interface ResizeDragState {
  type: "resize";
  originClient: Point;
  originFrames: FrameGeometryById;
  originBounds: FrameGeometry;
  targetIds: string[];
  handle: ResizeHandle;
  scaleContents: boolean;
  hasMoved: boolean;
}

export interface RotateDragState {
  type: "rotate";
  originClient: Point;
  originFrame: FrameGeometry;
  frameId: string;
  originPointerAngle: number;
  originRotation: number;
  hasMoved: boolean;
}

export interface GroupRotateDragState {
  type: "group-rotate";
  originClient: Point;
  originFrames: FrameGeometryById;
  targetIds: string[];
  groupCenter: Point;
  originPointerAngle: number;
  hasMoved: boolean;
}

export interface MarqueeDragState {
  type: "marquee";
  originClient: Point;
  originCanvas: Point;
  baseSelectedIds: string[];
  baseSelectedDraftIds: string[];
  additive: boolean;
  hasMoved: boolean;
}

export interface PanDragState {
  type: "pan";
  originClient: Point;
  originPan: Point;
}

export interface DraftMoveDragState {
  type: "draft-move";
  originClient: Point;
  originDrafts: DraftPrimitiveById;
  targetIds: string[];
  primaryId: string;
  hasMoved: boolean;
}

export interface DraftResizeDragState {
  type: "draft-resize";
  originClient: Point;
  originDrafts: DraftPrimitiveById;
  originBounds: FrameGeometry;
  targetIds: string[];
  handle: ResizeHandle;
  hasMoved: boolean;
}

export interface DraftCreateDragState {
  type: "draft-create";
  tool: DraftCreationTool;
  originClient: Point;
  originCanvas: Point;
  originFrameId?: string;
  points: Point[];
  hasMoved: boolean;
}

export interface PenNodeDragState {
  type: "pen-node";
  originClient: Point;
  anchor: Point;
  pathBefore: PenPath | null;
  hasMoved: boolean;
  closing?: boolean;
  cuspLatch: PenCuspLatch;
}

export interface VectorEditAnchorDragState {
  type: "vector-anchor";
  originClient: Point;
  nodeIndex: number;
  pathBefore: PenPath;
  hasMoved: boolean;
}

export interface VectorEditHandleDragState {
  type: "vector-handle";
  originClient: Point;
  nodeIndex: number;
  which: "in" | "out";
  pathBefore: PenPath;
  hasMoved: boolean;
  symmetryBroken: boolean;
}

export interface VectorEditSegmentDragState {
  type: "vector-segment";
  originClient: Point;
  originLocal: Point;
  segmentIndex: number;
  t: number;
  pathBefore: PenPath;
  hasMoved: boolean;
}

export interface DraftCreationPreview {
  tool: DraftCreationTool;
  geometry: FrameGeometry;
  points?: Point[];
}

export type DragState =
  | MoveDragState
  | ResizeDragState
  | RotateDragState
  | GroupRotateDragState
  | MarqueeDragState
  | PanDragState
  | DraftMoveDragState
  | DraftResizeDragState
  | DraftCreateDragState
  | PenNodeDragState
  | VectorEditAnchorDragState
  | VectorEditHandleDragState
  | VectorEditSegmentDragState;

export type PendingWheelGesture =
  | {
      mode: "zoom";
      factor: number;
      cursor: Point;
      clientX: number;
      clientY: number;
    }
  | {
      mode: "pan";
      deltaX: number;
      deltaY: number;
    };

export type CrossScreenDropPlacement = "before" | "after" | "inside";
export type CrossScreenDropAxis = "x" | "y";
export type CrossScreenDropMode = "flow-insert" | "absolute-container";

export interface CrossScreenHitTestAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CrossScreenHitTestResult {
  targetAnchorProvenance?: SourceNodeProvenance;
  anchorNodeId?: string;
  pendingNodeId?: string;
  anchorSelector?: string;
  placement?: CrossScreenDropPlacement;
  axis?: CrossScreenDropAxis;
  dropMode?: CrossScreenDropMode;
  anchorRect?: CrossScreenHitTestAnchorRect;
}

export interface CrossScreenDragElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasLayerMarqueeCandidate {
  screenId: string;
  info: ElementInfo;
  geometry: FrameGeometry;
  frameGeometry: FrameGeometry;
}

export interface CanvasLayerMarqueeSelection {
  screenId: string;
  info: ElementInfo;
}

export interface CrossScreenDropGuide {
  placement: CrossScreenDropPlacement;
  axis: CrossScreenDropAxis;
  boardRect: FrameGeometry;
}

export interface AltHoverMeasurementLine {
  orientation: "horizontal" | "vertical";
  gap: number;
  start: number;
  end: number;
  crossPosition: number;
  overlaps: boolean;
}

export interface AltHoverMeasurement {
  horizontal: AltHoverMeasurementLine | null;
  vertical: AltHoverMeasurementLine | null;
}

export type { DistanceGuideBand, EqualGapGuide };

export type {
  IframeContextMenuPayload,
  IframeFigmaClipboardPastePayload,
  IframeHotkeyPayload,
  IframeImagePastePayload,
  RuntimeStructureInsertRequest,
  RuntimeStructureRollbackRequest,
};

export interface ResolvedScreenMetadata {
  source: ScreenSourceType;
  previewState: ScreenPreviewState;
  title?: string;
  width: number;
  height: number;
  heightPinned?: boolean;
  heightMode?: ScreenHeightMode;
  previewUrl?: string;
}

export interface DuplicatePreview {
  display: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  canDuplicate: boolean;
  moved: boolean;
}

export interface TransformBadge {
  x: number;
  y: number;
  text: string;
}
