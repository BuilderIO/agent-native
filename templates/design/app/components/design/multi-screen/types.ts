import type {
  DistanceGuideBand,
  EqualGapGuide,
  FrameBounds,
} from "@shared/canvas-math";
import type { PenPath } from "@shared/pen-path";
import type { ReactNode } from "react";

import type {
  IframeContextMenuPayload,
  IframeFigmaClipboardPastePayload,
  IframeHotkeyPayload,
} from "../DesignCanvas";
import type {
  DeviceFrameType,
  ElementInfo,
  ElementSelectionIntent,
  PortableStyleSnapshot,
} from "../types";

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
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
  /**
   * When set, renders multiple side-by-side breakpoint frames (mobile-first,
   * §6.4). Each entry is a pixel width; the active breakpoint determines the
   * edit scope (Tailwind prefix: base / md: / lg: / xl:).
   */
  breakpointWidths?: number[];
  /** Id of the currently active breakpoint frame for this screen. */
  activeBreakpointWidth?: number;
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

export interface PersistedDraftPrimitive {
  frameId: string;
  nodeId: string;
}

export interface ScreenMetadata {
  source?: string;
  sourceType?: string;
  lod?: string;
  previewState?: string;
  title?: string;
  width?: number;
  height?: number;
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
}

export interface DuplicateRequest {
  mode: "alt-click" | "alt-drag";
  screen: ScreenFile;
  canvasPosition: { x: number; y: number };
  canvasOffset?: { x: number; y: number };
  dropCanvasPosition?: { x: number; y: number };
}

export interface MultiScreenCanvasProps {
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
  onPrimitiveCreated?: (
    screenId: string,
    nodeId: string,
    options?: { nextTool?: "move" | "pen" },
  ) => void;
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
  /**
   * STEVE TEST BATCH 3 item 8b — "…" menu on an overview breakpoint frame:
   * remove that breakpoint. Width-first (not breakpoint-id) to match
   * onAddBreakpoint/onActiveBreakpointChange's existing convention — the
   * design only has one breakpoint set, so the caller (DesignEditor) can
   * resolve widthPx back to a breakpoint id the same way
   * handleOverviewActiveBreakpointChange already does.
   */
  onRemoveBreakpoint?: (screenId: string, widthPx: number) => void;
  /**
   * STEVE TEST BATCH 3 item 8b — "…" menu "Change width" commit for an
   * overview breakpoint frame. `widthPx` identifies which breakpoint (its
   * current width); `nextWidthPx` is the new value.
   */
  onChangeBreakpointWidth?: (
    screenId: string,
    widthPx: number,
    nextWidthPx: number,
  ) => void;
  /**
   * STEVE TEST BATCH 3 item 8b — "full view" entry for one breakpoint frame
   * in overview (double-click or its own full-view button): enter
   * single-screen mode for the owning screen with this breakpoint width as
   * the active edit/viewport scope. Falls back to plain `onEdit` when unset
   * so existing callers keep working unchanged.
   */
  onEditBreakpoint?: (screenId: string, widthPx: number) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
  onLayerMarqueeSelectionChange?: (
    selection: CanvasLayerMarqueeSelection[],
    intent: ElementSelectionIntent,
  ) => void;
  selectedLayerSelectorGroupsByScreen?: Record<string, string[][]>;
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
    /** Pending node id minted by the hit-test bridge for an id-less anchor —
     *  see CrossScreenHitTestResult.pendingNodeId's doc for the handshake. */
    targetAnchorPendingNodeId?: string;
    /** Source-equivalent structural selector locating the pending anchor in
     *  the persisted dest document (CrossScreenHitTestResult.anchorSelector). */
    targetAnchorSelector?: string;
    /** DOM insertion placement relative to the anchor node. */
    targetAnchorPlacement?: "before" | "after" | "inside";
    /** Whether the target should receive an in-flow insert or an absolute child. */
    targetDropMode?: CrossScreenDropMode;
    /** Target anchor rect in the destination iframe/content coordinate space. */
    targetAnchorRect?: CrossScreenHitTestAnchorRect;
    /** Final drop point in logical overview canvas coordinates. */
    targetCanvasPoint?: Point;
    /** Final drop point in the destination iframe/content coordinate space. */
    targetLocalPoint?: Point;
    /** Pointer offset from the dragged element's top-left in source iframe px. */
    sourcePointerOffset?: Point;
    /** Portable computed styles captured in the source iframe before the move. */
    styleSnapshot?: PortableStyleSnapshot;
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
   * When true the board is the active surface (activeFileId === boardFileId),
   * so the board <DesignCanvas> owns the global window runtime bridge
   * (`registerRuntimeBridge={boardIsActive}`). This mirrors how the active
   * screen owns the bridge in single/overview mode: at most one surface
   * registers the global `window.__designCanvas*` helpers at a time
   * (active screen XOR active board, since `activeFileId` is exclusive), so
   * in-place ops — delete removal, begin-text-edit — reach the board exactly
   * like a screen. DesignEditor passes `activeFileId === boardFileId`.
   * Defaults to false.
   */
  boardIsActive?: boolean;
  /**
   * Called when the user selects an element on the board surface.
   * DesignEditor should set boardFileId as the active file and push the
   * selection to the inspector.
   */
  onBoardElementSelect?: (
    info: ElementInfo,
    intent?: ElementSelectionIntent,
  ) => void;
  onBoardElementMarqueeSelect?: (
    infos: ElementInfo[],
    intent?: ElementSelectionIntent,
  ) => void;
  /**
   * Called when the user hovers an element on the board surface.
   */
  onBoardElementHover?: (info: ElementInfo | null) => void;
  onBoardElementClear?: () => void;
  onBoardElementDblClickText?: (info: ElementInfo) => void;
  onBoardIframeHotkey?: (event: IframeHotkeyPayload) => void;
  onBoardFigmaClipboardPaste?: (
    event: IframeFigmaClipboardPastePayload,
  ) => void;
  onBoardIframeContextMenu?: (event: IframeContextMenuPayload) => void;
  onBoardTextEditingStateChange?: (state: {
    active: boolean;
    selector?: string;
    hasRange?: boolean;
  }) => void;
  boardClearSelectionRequest?: number;
  boardSelectedSelector?: string | null;
  boardSelectedSelectorCandidates?: string[];
  boardHoveredSelector?: string | null;
  boardHoveredSelectorCandidates?: string[];
  boardLockedSelectors?: string[];
  boardHiddenSelectors?: string[];
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
      dropMode?: "flow-insert" | "absolute-container";
      sourceRect?: { x: number; y: number; width: number; height: number };
      anchorRect?: { x: number; y: number; width: number; height: number };
    },
  ) => boolean | "pending" | void;
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
  /**
   * Figma-style vector edit mode: when present, renders an interactive
   * overlay (draggable anchors + control handles) over `path` and lets the
   * user reshape it. When null/undefined, nothing new renders and existing
   * pen-draw / selection / drag behavior is unaffected. The parent owns the
   * working PenPath state, entering/exiting edit mode, and persistence.
   */
  vectorEdit?: VectorEditOverlayState | null;
  /**
   * Figma-parity on-canvas gradient editing handles: when present and
   * `frameOrDraftId` matches the single currently-selected screen frame or
   * draft primitive, renders a draggable gradient line (start/end handles +
   * per-stop markers) over that target's bounds in the selection-chrome
   * layer. When null/undefined (the default), nothing new renders and
   * existing selection/drag behavior is unaffected. The parent
   * (DesignEditor) owns opening/closing the inspector's gradient tab,
   * parsing/serializing the CSS value, and persistence — this component
   * only draws the overlay and reports drag phases back through
   * `onChange("preview" | "commit")`. See `GradientEditOverlayTarget` below
   * and `GradientEditSessionTarget` in `inspector/GradientEditor.tsx` for
   * the full contract. Linear gradients + overview-canvas board/draft/
   * screen-frame targets only — see that type's doc for scope notes.
   */
  gradientEditTarget?: GradientEditOverlayTarget | null;
  /**
   * OS file drag-and-drop (Figma parity): fired when the user drops native
   * OS files (e.g. images dragged from Finder/Explorer) onto the overview
   * canvas surface. `target.canvasPoint` is the drop point converted to
   * canvas-world coordinates via the same math `getCanvasPoint` uses.
   * `target.frameId` is set when the drop landed inside an existing screen
   * frame's bounds (hit-tested via `getFrameEntryAtPoint`), so the caller can
   * insert into that screen's local coordinate space instead of the shared
   * board. This component only resolves the drop geometry — it does NOT read
   * file contents, upload, or insert anything; the caller (DesignEditor) owns
   * that side, matching the paste-image pipeline. Multiple files dropped at
   * once are passed together in one call so the caller can stagger their
   * placement (e.g. offsetting each by a fixed canvas delta) instead of this
   * component guessing a stagger amount.
   */
  onDropFiles?: (
    files: File[],
    target: { canvasPoint: Point; frameId?: string },
  ) => void;
  /**
   * Imperative camera command (Figma's Shift+1 "zoom to fit" / Shift+2 "zoom
   * to selection"). MultiScreenCanvas owns pan internally (no `onPanChange`
   * prop exists), so the only external control path for pan is this
   * bounds-based command: pass the world-space bounds to fit and a
   * monotonically increasing `nonce`; on each `nonce` change this component
   * computes the fit zoom+pan itself (via the shared `getCameraForBounds`,
   * clamped to the same MIN_ZOOM/MAX_ZOOM this canvas already uses) against
   * its OWN current viewport size, and applies it through the exact same
   * imperative-transform + debounced-commit path wheel/pinch zoom uses (so
   * there is no extra re-render storm — one commit at the end, same as a
   * settled gesture). Passing `null`/`undefined`, or repeating the same
   * `nonce`, is a no-op. `onZoomChange` still fires once the camera settles,
   * same as any other zoom change, so callers that mirror `zoom` into their
   * own state stay in sync automatically.
   */
  cameraCommand?: {
    fitBounds: FrameBounds;
    /** Screen-px padding around the bounds. Defaults to 64 (Figma-ish). */
    paddingScreenPx?: number;
    nonce: number;
  } | null;
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

/** One entry of `canvasFrames` (PF21). Kept referentially stable across
 *  renders for a given screen.id when that screen's own screen/metadata/
 *  geometry are unchanged by value — see canvasFrameEntryCacheRef. */
export interface CanvasFrameEntry {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  geometry: FrameGeometry;
}

/** Per-screen cache entry backing screenContentById (PF21). `contentNode` is
 *  reused across renders whenever `screen`, `renderScreenContent` (the
 *  DesignEditor-provided callback identity), `metadata` (by value), and the
 *  *rounded* geometry width/height are all unchanged — notably NOT
 *  geometry.x/geometry.y, since renderScreenContent's actual implementation
 *  never reads position (position is applied by Screen's own wrapper
 *  transform/left/top, not by the cached content node). See the
 *  screenContentById useMemo for the full rationale. */
export interface ScreenContentCacheEntry {
  screen: ScreenFile;
  metadata: ResolvedScreenMetadata;
  width: number;
  height: number;
  renderScreenContent: NonNullable<
    MultiScreenCanvasProps["renderScreenContent"]
  >;
  contentNode: ReactNode;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Interactive vector-edit overlay state, supplied by the parent
 * (DesignEditor) whenever the user is editing an existing path's anchors and
 * control handles on the canvas. `path` is expressed in path-local
 * coordinates (the same space `pen-path.ts` helpers operate in); `originCanvas`
 * is where that path's local origin (0,0) sits in canvas space, so a given
 * local point's canvas position is simply `originCanvas + localPoint`
 * (see `vectorEditLocalToCanvasPoint`). The parent owns the working PenPath
 * state, entering/exiting edit mode, and persistence — this component only
 * renders the overlay and reports pointer interaction back through
 * `onChange`/`onExit`.
 */
export interface VectorEditOverlayState {
  path: PenPath;
  originCanvas: Point;
  onChange: (nextPath: PenPath, phase: "preview" | "commit") => void;
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
  /** Draft primitive id or screen id this gradient CSS applies to. */
  frameOrDraftId: string;
  /** The live gradient CSS string, e.g. `linear-gradient(90deg, ...)`. */
  cssValue: string;
  /** Fired on every drag tick ("preview") and once on release ("commit"),
   *  mirroring the gesture-coalescing convention used by `vectorEdit`. */
  onChange: (nextCss: string, meta?: { phase: "preview" | "commit" }) => void;
}

/** One linear-gradient stop, projected to a point on the gradient line for
 *  on-canvas rendering (see `gradientStopPoints`). */
export interface GradientLinePoint extends Point {
  /** 0–100 position along the gradient line, matching `GradientStopValue`. */
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

// Exported so applyDraftGeometry's K-scale math (see its own doc comment)
// can be unit-tested directly, matching the existing convention for the
// gradient-overlay math (gradientLineEndpoints etc.) exported just below.
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
  autoSize?: boolean;
}

export type DraftPrimitiveById = Record<string, DraftPrimitive>;

/** Live keyboard modifiers for shape-drawing tools: shift constrains rect/
 *  ellipse to a square/circle (and lines/arrows to 45deg increments); alt
 *  draws outward from the start point as the shape's center. */
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

/** Multi-selection rotate (CV14): rotates every selected frame together
 *  around the group's own center, using rotateFrameGroupAroundCenter. Kept
 *  as a separate drag-state type from the single-frame RotateDragState above
 *  (rather than extending it to optionally hold multiple ids) so the
 *  existing, already-correct single-frame rotate path is never touched. */
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
  /**
   * True when this drag started on the close-hit-target (the path's first
   * anchor) rather than adding a new node. Figma defers the close commit
   * until mouseup so a drag on the closing click can shape the closing
   * segment's curve (the first anchor's handleIn) instead of the click
   * being an instant, undraggable straight-line close.
   */
  closing?: boolean;
}

/** Dragging an anchor square of a `vectorEdit` overlay path (P-VE1). Anchor
 *  drags move the whole node (point + handles, via movePenAnchor's default
 *  moveHandlesWithAnchor:true) rather than reshaping a single handle. */
export interface VectorEditAnchorDragState {
  type: "vector-anchor";
  originClient: Point;
  nodeIndex: number;
  /** Path snapshot (local coords) from just before this drag began, restored
   *  on cancel. */
  pathBefore: PenPath;
  hasMoved: boolean;
}

/** Dragging a control-handle circle of a `vectorEdit` overlay path (P-VE1).
 *  Alt/Option held during the drag breaks handle symmetry into a cusp
 *  (movePenHandle's breakSymmetry), matching the pen tool's own alt
 *  behavior while placing a fresh anchor. */
export interface VectorEditHandleDragState {
  type: "vector-handle";
  originClient: Point;
  nodeIndex: number;
  which: "in" | "out";
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
  | VectorEditHandleDragState;

export type PendingWheelGesture =
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

// ── Cross-screen drop + layer marquee types ─────────────────────────────────

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
  anchorNodeId?: string;
  /**
   * Minted by the hit-test bridge when the resolved anchor has no stable id
   * (AI-generated screens): the anchor's live DOM carries it as
   * `data-an-pending-node-id`, and `anchorSelector` (below) locates the same
   * element in the PERSISTED source so a host can stamp the pending id as
   * the real `data-agent-native-node-id` before resolving the drop — the
   * two-step id-on-demand handshake mirroring editor-chrome's selection
   * contract. Without passing these through, drops into id-less screens
   * silently degrade to absolute placement.
   */
  pendingNodeId?: string;
  /**
   * Body-rooted source-equivalent structural path for the pending anchor
   * (skips Alpine-generated runtime nodes + editor overlays). Absent when
   * the anchor is itself an Alpine-generated instance with no source node.
   */
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

// ── Alt-hover measurement types ──────────────────────────────────────────────

/** One Figma-style alt-hover distance measurement: a line spanning the empty
 *  space between the selection's bounds and the hovered object's bounds on a
 *  single axis, plus the cross-axis position the line/label should draw at.
 *  `gap` is the edge-to-edge distance in canvas units (can be negative when
 *  the two boxes overlap on this axis — callers should treat negative gaps
 *  as "no line" the same way `overlaps` signals that). */
export interface AltHoverMeasurementLine {
  orientation: "horizontal" | "vertical";
  /** Edge-to-edge distance in canvas units. */
  gap: number;
  /** Start/end of the line along its own axis (e.g. for a horizontal line,
   *  the x range it spans). */
  start: number;
  end: number;
  /** Position along the cross axis the line is drawn at (e.g. for a
   *  horizontal line, the y coordinate). Centered on the overlapping range
   *  when the boxes overlap on the cross axis, otherwise centered between
   *  the two boxes' cross-axis midpoints. */
  crossPosition: number;
  /** True when the two boxes overlap on this line's own axis, meaning there
   *  is no real empty-space gap to show (Figma hides the line in that case). */
  overlaps: boolean;
}

export interface AltHoverMeasurement {
  horizontal: AltHoverMeasurementLine | null;
  vertical: AltHoverMeasurementLine | null;
}

// Re-exported for callers that only need the shared guide-compare types.
export type { DistanceGuideBand, EqualGapGuide };

// Re-exported bridge payload types used by MultiScreenCanvasProps board
// callbacks, so consumers can import them from this module too.
export type {
  IframeContextMenuPayload,
  IframeFigmaClipboardPastePayload,
  IframeHotkeyPayload,
};

export interface ResolvedScreenMetadata {
  source: ScreenSourceType;
  previewState: ScreenPreviewState;
  title?: string;
  width: number;
  height: number;
  previewUrl?: string;
}

export interface DuplicatePreview {
  display: string;
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
