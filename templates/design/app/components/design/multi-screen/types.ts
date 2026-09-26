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
  /** A height the user dragged; auto-fit must not grow past it. */
  heightPinned?: boolean;
  /** Explicit sizing choice; absent metadata keeps the legacy auto/fixed behavior. */
  heightMode?: ScreenHeightMode;
  url?: string;
  previewUrl?: string;
  bridgeUrl?: string;
  /** Exact projection namespace used by the host for this authored screen. */
  codeLayerSource?: CodeLayerSource;
  /** Stable persisted connection scope for URL-backed local/Fusion screens. */
  connectionId?: string;
  /** Read-only localhost preview credential. Never a filesystem token. */
  previewToken?: string;
  /**
   * When set, renders multiple side-by-side breakpoint frames (mobile-first,
   * §6.4). Each entry is a pixel width; the active breakpoint determines the
   * edit scope (Tailwind prefix: base / md: / lg: / xl:).
   */
  breakpointWidths?: number[];
  breakpointHeights?: Record<string, number>;
  /** Id of the currently active breakpoint frame for this screen. */
  activeBreakpointWidth?: number;
  /** Generated variation-set membership. Used only to preserve/reflow the
   * action-authored lineup when responsive preview rows are introduced. */
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
  /**
   * Invalidates the cached React element without changing the renderer
   * callback. Runtime requests use this while the overview keeps the same
   * live iframe mounted: the element must receive the new one-shot request,
   * but its iframe document must not be remounted.
   */
  cacheKey?: string | number | null;
}

export interface MultiScreenCanvasProps {
  screens: ScreenFile[];
  zoom: number;
  activeId?: string | null;
  selectedScreenIds?: string[];
  /** One screen whose preview is mounted temporarily for export while the
   *  overview camera and selection stay unchanged. */
  exportPreviewScreenId?: string | null;
  /** Screen id whose active selection is a specific element INSIDE the
   * screen (a Layers-panel row, an in-canvas click) rather than the screen
   * frame itself. The frame's own SelectionBox is suppressed for this
   * screen — the iframe's editor-chrome bridge already draws a tightly
   * fitted outline + resize handles around the real element, so drawing the
   * frame-sized box on top of it would be wrong, not just redundant. */
  selectedElementScreenId?: string | null;
  /** Stable source id for the currently selected canvas layer. */
  selectedPenPathNodeId?: string | null;
  /** Hidden screen/file rows retain geometry but do not render or participate
   * in overview hit testing, fit, or selection until shown again. */
  hiddenScreenIds?: ReadonlySet<string> | readonly string[];
  /** Locked screen/file rows remain visible but cannot be selected or
   * transformed directly from the overview canvas. */
  lockedScreenIds?: ReadonlySet<string> | readonly string[];
  fullViewScreenIds?: string[];
  /** Screens with generated candidates waiting for explicit review. */
  pendingReviewScreenIds?: ReadonlySet<string> | readonly string[];
  /** Opens candidate review for one pending screen. */
  onReviewPendingScreen?: (screenId: string) => void;
  /** Lets every live frame receive native pointer interaction while the
   * overview camera and frame chrome remain available. */
  interactMode?: boolean;
  /** Screen whose mounted editor receives input in focused Interact view. */
  interactScreenId?: string | null;
  /** Responsive viewport for a focused Interact screen that stays in this
   * mounted canvas. */
  focusedInteractViewport?: { width: number; height: number } | null;
  /** Viewer mode keeps selection/inspection available without edit chrome. */
  readOnly?: boolean;
  /** Live localhost screens whose DOM editor may receive pointer input. */
  editableScreenIds?: ReadonlySet<string>;
  activeScreenHasHoveredChild?: boolean;
  hoveredChildScreenId?: string | null;
  directlyHoveredScreenId?: string | null;
  previewDeviceFrame?: DeviceFrameType;
  activeTool?: MultiScreenCanvasTool;
  /** Review overlays shared by screen frames and the overview board. */
  reviewResourceId?: string;
  reviewPinMode?: boolean;
  reviewCommentsHidden?: boolean;
  reviewCanPost?: boolean;
  reviewCanResolve?: boolean;
  /** Optional review target override; null scopes comments to the board. */
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
  /** Routes empty-board clicks to the active overview comment composer. */
  onCommentPin?: (point: Point) => void;
  onPick: (id: string) => void;
  onEdit?: (id: string) => void;
  metadataById?: Record<string, ScreenMetadata | undefined>;
  /** Computed <body> styles from each live screen, used to make its board
   *  chrome transparent and clip root corner radii to the rendered surface. */
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
  /** Reports the stable, accepted primary iframe height for camera fitting. */
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
    options?: { nextTool?: "move" | "pen"; preserveActiveTool?: boolean },
  ) => void;
  onUpdatePenPath?: (
    screenId: string,
    nodeId: string,
    path: PenPath,
  ) => boolean;
  onPrimitiveReparent?: (args: {
    sourceNodeId: string;
    sourceScreenId: string;
    /**
     * The moveNode/moveNodeBetweenDocuments anchor: the containing primitive
     * itself when `placement` is "inside" (append), or a sibling child of
     * that container when `placement` is "before"/"after" (flow-insert at a
     * specific index) — see PrimitiveDropTarget.anchorNodeId in
     * primitive-drop-target.ts, which resolves which one to pass.
     */
    targetNodeId: string;
    targetScreenId: string;
    targetIdentity?: ScreenProjectionNodeIdentity;
    preparedTargetNodeId?: string;
    /**
     * "inside" appends into the target container (absolute-drop parity with
     * the historic behavior). "before"/"after" flow-inserts next to
     * `targetNodeId` at the resolved auto-layout index, mirroring
     * onCrossScreenElementDrop's targetAnchorPlacement contract.
     */
    placement: "before" | "after" | "inside";
  }) => void;
  onCreateScreenFrame?: (geometry: FrameGeometry) => void;
  /** Whether the frame tool commits a top-level screen or a plain frame. */
  frameToolDraws?: "screen" | "frame";
  onDeleteSelection?: (ids: string[]) => boolean | void;
  /** Return false to keep the arrow key: the host's real selection is an
   * element inside a screen, and this canvas still lists that screen in
   * `selectedIds`. Same veto `onDeleteSelection` uses. */
  onNudgeSelection?: (ids: string[]) => boolean | void;
  /** The editor's configured small/big arrow-key steps. Board frames and
   *  in-screen elements must nudge by the same amounts, so this comes from the
   *  one preference rather than a second default living out here. */
  nudgeAmounts?: { small: number; big: number };
  /** Per-frame layout grids, keyed by frame id. A frame with no entry keeps the
   *  whole-pixel floor. Absent entirely means the host has not loaded them. */
  layoutGrids?: LayoutGridById;
  onZoomChange?: (zoom: number) => void;
  renderScreenContent?: (
    screen: ScreenFile,
    metadata: ResolvedScreenMetadata,
    geometry: FrameGeometry,
    options?: ScreenContentRenderOptions,
  ) => ReactNode;
  /**
   * Changes to a transient per-screen runtime request must invalidate the
   * cached React element so a mounted DesignCanvas receives the request. This
   * is intentionally separate from the renderer identity: changing it updates
   * props in place and preserves the iframe document and running-app state.
   */
  screenContentRenderKey?: string | number | null;
  /** Cached inert HTML used while a live screen is waiting for a boot slot. */
  screenSnapshotsById?: Record<string, { html: string } | undefined>;
  /** The design's resolved tweak CSS custom properties. Editors receive them
   *  from their own DesignCanvas; static previews are posted them here. */
  tweakValues?: Record<string, string>;
  /**
   * Renders the fully editable runtime for one responsive sub-frame. Keeping
   * this separate from `renderScreenContent` prevents a breakpoint preview
   * from falling back to the lightweight, pointer-inert thumbnail iframe.
   */
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
  /**
   * Called when the user clicks the + affordance on a screen's breakpoint
   * row to add the next standard breakpoint width (390 / 768 / 1280).
   */
  /** Adds a breakpoint width to the DESIGN. A design has one active breakpoint
   *  set in v1, so this deliberately takes no screen id: every screen renders
   *  the same widths, and a per-screen parameter here only ever promised
   *  scoping the action cannot deliver. */
  onAddBreakpoint?: (widthPx: number) => void;
  /** True while an add/remove breakpoint mutation is in flight — disables the
   *  "+" affordance and shows a brief spinner so the click is acknowledged. */
  breakpointMutationPending?: boolean;
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
   * in overview (double-click or its own Interact button): enter
   * single-screen mode for the owning screen with this breakpoint width as
   * the active edit/viewport scope. Falls back to plain `onEdit` when unset
   * so existing callers keep working unchanged.
   */
  onEditBreakpoint?: (screenId: string, widthPx: number) => void;
  onSelectionChange?: (selectedIds: string[]) => void;
  onLayerMarqueeSelectionChange?: (
    selection: CanvasLayerMarqueeSelection[],
    // `final` is true only for the one report each marquee gesture sends at
    // mouseup (every mousemove tick omits it) — see
    // coalesceMarqueeSelectionHistory's doc comment for why the host needs
    // it to record one undo step per drag instead of one per tick.
    intent: ElementSelectionIntent & { final?: boolean },
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
    sourceDeleteRequestId?: string;
    sourceProvenance?: SourceNodeProvenance;
    targetAnchorProvenance?: SourceNodeProvenance;
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
    /** CSS width/height used by the source before auto-layout is removed. */
    sourceComputedSize?: { width?: number; height?: number };
    /** Host-captured HTML for a board root, including its current DOM subtree. */
    sourceHtmlSnapshot?: string;
    /** True when the source bridge is carrying an Alt-drag copy. */
    duplicate?: boolean;
    /** Runtime HTML for an Alt-drag copy whose source must remain in place. */
    sourceCloneHtml?: string;
    /** Portable computed styles captured in the source iframe before the move. */
    styleSnapshot?: PortableStyleSnapshot;
    /** True when the source bridge could not measure the bare-tag probe
     *  (portableStyleTagDefaults returned null) — distinct from a legitimately
     *  absent snapshot (`styleSnapshot === undefined`, nothing to carry). The
     *  drop command must refuse the move rather than silently drop a
     *  class-only appearance it never got a chance to carry. */
    styleSnapshotCaptureFailed?: boolean;
  }) => void;
  // ── Board file (new model) ───────────────────────────────────────────────
  /**
   * The id of the reserved "__board__.html" design file.
   * When provided, a full-surface board <DesignCanvas> is rendered below
   * the screen iframes so board elements are editable through the bridge.
   */
  boardFileId?: string;
  /** Host CSS vars do not reach the board iframe; omit this and coverage stays themed. */
  canvasBackground?: string | null;
  /**
   * The current HTML content of the board file.
   * Passed as `content` to the board <DesignCanvas> instance.
   */
  boardFileContent?: string;
  /** Canonical source identity used when the Board participates in layer hit testing. */
  boardCodeLayerSource?: CodeLayerSource;
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
  onBoardDrawPrimitive?: (
    primitive: CanvasPrimitiveInsert,
    options?: PrimitiveCreateOptions,
  ) => PrimitiveCreateResult;
  // ── Board edit callbacks (active-target model) ───────────────────────────
  /**
   * When true the board <DesignCanvas> is in edit mode.
   * Pass the persisted-design or public visual-edit capability from
   * DesignEditor. Defaults to false.
   */
  boardEditMode?: boolean;
  /** Runtime-only requests targeted at the board iframe. */
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
  /** Shared admission lock used to associate a board timeout with its transaction. */
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
  /** Reports the selected board element's world-space bounds separately from
   * ElementInfo.boundingRect, whose contract remains iframe-local. */
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
   * Target file is boardFileId. `metadata` must mirror DesignCanvas's own
   * `onVisualStyleChange` signature exactly — this callback is wired
   * straight through from that event (see MultiScreenCanvas's board
   * DesignCanvas) — or a resize/drag commit's `phase`/`originalStyles`
   * silently drops before it reaches undo history, leaving one Cmd+Z
   * unable to restore the pre-drag geometry.
   */
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
  /** Called when K-scale commits a board selection as one style batch. */
  onBoardVisualStyleBatchChange?: (
    changes: KScaleStyleChange[],
  ) => boolean | void;
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
  /** Suppresses the automatic lineup fit for a history replay that restores a
   * deliberately placed screen while keeping the current camera. */
  suppressLineupRecenter?: {
    fromCount: number;
    addedCount: number;
    nonce: number;
  } | null;
  /** Keeps an explicitly chosen overview zoom from triggering an automatic
   * lineup fit when screen data arrives after a direct URL navigation. */
  preserveCameraOnScreenCountChange?: boolean;
  /** Lets the initial URL zoom apply after the first lineup centers the canvas. */
  deferLineupZoomChange?: boolean;
  /**
   * Screen-px width of fixed chrome the caller renders OVER this canvas's
   * left/right edges (e.g. the left workspace rail+panel shell, the right
   * inspector panel) — both are absolutely-positioned overlays, not flex
   * siblings, so this component's own measured surface rect never shrinks
   * for them. Every camera-fit computation (the default overview lineup
   * recenter and the explicit `cameraCommand` fit) must center content in
   * the space actually free of that chrome, or the first screen and its
   * frame label render unreachable underneath it. Defaults to 0.
   */
  chromeInsetLeft?: number;
  chromeInsetRight?: number;
  /** Reads the canvas-space rectangle currently visible between editor chrome. */
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
  renderKey: string | number | null | undefined;
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
  selectedAnchorIndex: number | null;
  onSelectedAnchorChange: (nodeIndex: number | null) => void;
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
  startPoint?: VectorEndpointStyle;
  endPoint?: VectorEndpointStyle;
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
  cuspLatch: PenCuspLatch;
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
  /** Alt is a one-way latch for the drag: releasing it must not re-mirror the
   *  pair the user just broke. */
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
      /** Already-curved multiplier, not a raw delta: the two devices' curves
       *  differ, so only the factor is safe to accumulate across events. */
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
  targetAnchorProvenance?: SourceNodeProvenance;
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
  /** A height the user dragged; auto-fit must not grow past it. */
  heightPinned?: boolean;
  heightMode?: ScreenHeightMode;
  previewUrl?: string;
}

export interface DuplicatePreview {
  display: string;
  /** How many frames the drop will copy — the whole frame selection when the
   *  alt-drag started on a selected frame, otherwise just the pressed one. */
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
