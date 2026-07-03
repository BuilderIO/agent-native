import { useT } from "@agent-native/core/client";
import {
  DEFAULT_ASSIGNED_REGION_GAP,
  DEFAULT_ASSIGNED_REGION_HEIGHT,
  DEFAULT_ASSIGNED_REGION_MAX_COLUMNS,
  DEFAULT_ASSIGNED_REGION_WIDTH,
  DEFAULT_CANVAS_MAX_ZOOM,
  DEFAULT_CANVAS_MIN_ZOOM,
  DEFAULT_SNAP_THRESHOLD_SCREEN_PX,
  computeEqualGapGuides,
  computeMoveSnap,
  computeResizeSnap,
  type DistanceGuideBand,
  type EqualGapGuide,
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
  isPenCloseTarget,
  scalePenPathToGeometry,
  serializePenPath,
  snapPenAnchorPoint,
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
  type IframeContextMenuPayload,
  type IframeFigmaClipboardPastePayload,
  type IframeHotkeyPayload,
} from "./DesignCanvas";
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

type ScreenSourceType = "localhost" | "fusion" | "inline";
type ScreenPreviewState = "live" | "snapshot" | "preview";
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
  bridgeUrl?: string;
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
// During a zoom gesture the constant-size selection chrome is frozen (we don't
// re-render); on commit it recomputes to its fixed screen size. These transitions
// are enabled only for that brief settle, so normal selection, resize, and
// screen-switch geometry stays pinned to the frame.
const CHROME_SETTLE_MS = 150;
const CHROME_OPACITY_TRANSITION = "opacity 150ms ease-out";
const CHROME_BORDER_SETTLE_TRANSITION = `inset ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const SELECTION_BOX_SETTLE_TRANSITION = `border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const CHROME_HANDLE_SETTLE_TRANSITION = `width ${CHROME_SETTLE_MS}ms ease-out, height ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, top ${CHROME_SETTLE_MS}ms ease-out, bottom ${CHROME_SETTLE_MS}ms ease-out, left ${CHROME_SETTLE_MS}ms ease-out, right ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
// Frame header (name + "Full view" button) is counter-scaled via
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

export function hasBoardSurfaceContent(html: string | undefined) {
  if (!html) return false;
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch?.[1] ?? html;
  return content.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

const BOARD_SURFACE_RENDER_STYLE = `<style data-agent-native-board-surface-render>html,body{background:transparent!important;background-color:transparent!important;background-image:none!important;}body{margin:0!important;position:relative;overflow:visible;}body>:not([data-agent-native-node-id]):not(style):not(script),body>[data-agent-native-node-id]:not([data-an-primitive]):not([data-agent-native-preserve-styles="true"]):has([data-agent-native-node-id]),body>[data-agent-native-node-id="body"],body>[data-agent-native-node-id="Body"],body>[data-agent-native-layer-name="body"],body>[data-agent-native-layer-name="Body"],body>[data-agent-native-layer-name="<body>"]{background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;}[data-agent-native-board-backdrop-candidate="true"]{display:none!important;pointer-events:none!important;}</style>`;
const BOARD_SURFACE_BACKGROUND = "hsl(0 0% 10%)";

const BOARD_SURFACE_BACKDROP_MIN_EDGE_PX = 2400;
const BOARD_SURFACE_BACKDROP_MIN_AREA_PX = 8_000_000;
const HTML_VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const HTML_TAG_RE = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)([^<>]*?)\/?>/g;

function getHtmlAttributeValue(tag: string, name: string) {
  const match = tag.match(
    new RegExp(
      `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
      "i",
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function getCssDeclarationValue(style: string, name: string) {
  const match = style.match(
    new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"),
  );
  return match?.[1]?.trim() ?? "";
}

function getCssPixelValue(style: string, name: string) {
  const value = getCssDeclarationValue(style, name);
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCssColor(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "transparent") return null;
  const rgb = trimmed.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/,
  );
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    if (alpha <= 0) return null;
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as const;
  }
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex?.[1]) return null;
  const raw = hex[1];
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((part) => part + part)
          .join("")
      : raw;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ] as const;
}

function isNeutralBackdropColor(value: string) {
  const color = parseCssColor(value);
  if (!color) return false;
  const max = Math.max(...color);
  const min = Math.min(...color);
  return min >= 180 && max - min <= 24;
}

function isAccidentalBoardBackdropTag(tag: string) {
  if (
    getHtmlAttributeValue(tag, "data-agent-native-board-backdrop-candidate")
  ) {
    return false;
  }
  const primitive = getHtmlAttributeValue(
    tag,
    "data-an-primitive",
  ).toLowerCase();
  if (primitive !== "rectangle" && primitive !== "rect") return false;
  const style = getHtmlAttributeValue(tag, "style");
  if (!style) return false;
  const width = getCssPixelValue(style, "width");
  const height = getCssPixelValue(style, "height");
  if (width === null || height === null) return false;
  if (
    width < BOARD_SURFACE_BACKDROP_MIN_EDGE_PX ||
    height < BOARD_SURFACE_BACKDROP_MIN_EDGE_PX ||
    width * height < BOARD_SURFACE_BACKDROP_MIN_AREA_PX
  ) {
    return false;
  }
  const background =
    getCssDeclarationValue(style, "background-color") ||
    getCssDeclarationValue(style, "background");
  return isNeutralBackdropColor(background);
}

function markAccidentalBoardBackdropCandidates(html: string) {
  return html.replace(HTML_TAG_RE, (tag: string, tagName?: string) => {
    if (!tagName || tag.startsWith("</")) return tag;
    if (!isAccidentalBoardBackdropTag(tag)) return tag;
    return tag.replace(
      /\/?>$/,
      (ending) => ` data-agent-native-board-backdrop-candidate="true"${ending}`,
    );
  });
}

function findLastHtmlStackTagIndex(
  stack: Array<{ tagName: string; nodeId: string }>,
  tagName: string,
) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.tagName === tagName) return i;
  }
  return -1;
}

function getCurrentLayerParentNodeId(
  stack: Array<{ tagName: string; nodeId: string }>,
) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const nodeId = stack[i]?.nodeId;
    if (nodeId) return nodeId;
  }
  return "body";
}

export function getBoardSurfaceRenderContent(html: string) {
  if (!html) return html;
  const renderHtml = markAccidentalBoardBackdropCandidates(html);
  if (renderHtml.includes("data-agent-native-board-surface-render")) {
    return renderHtml;
  }
  if (/<\/head>/i.test(html)) {
    return renderHtml.replace(
      /<\/head>/i,
      `${BOARD_SURFACE_RENDER_STYLE}</head>`,
    );
  }
  if (/<body\b/i.test(html)) {
    return renderHtml.replace(/<body\b/i, `${BOARD_SURFACE_RENDER_STYLE}<body`);
  }
  return `${BOARD_SURFACE_RENDER_STYLE}${renderHtml}`;
}

export function getBoardContentLayerSignature(html: string) {
  const layers: string[] = [];
  const stack: Array<{ tagName: string; nodeId: string }> = [];
  const childCountsByParent = new Map<string, number>();

  for (const match of html.matchAll(HTML_TAG_RE)) {
    const token = match[0];
    const tagName = match[1]?.toLowerCase();
    if (!tagName) continue;

    if (token.startsWith("</")) {
      const index = findLastHtmlStackTagIndex(stack, tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }

    const nodeId = getHtmlAttributeValue(token, "data-agent-native-node-id");
    if (nodeId) {
      const parentNodeId = getCurrentLayerParentNodeId(stack);
      const childIndex = childCountsByParent.get(parentNodeId) ?? 0;
      childCountsByParent.set(parentNodeId, childIndex + 1);
      layers.push(`${nodeId}<${parentNodeId}#${childIndex}`);
    }

    const selfClosing = token.endsWith("/>") || HTML_VOID_TAGS.has(tagName);
    if (!selfClosing) stack.push({ tagName, nodeId });
  }

  return `${layers.length}:${hashString(layers.join("\n"))}`;
}

export function getBoardContentKey(args: {
  boardFileId: string;
  boardFileContent: string;
  boardIsActive: boolean;
}) {
  return `${args.boardFileId}:surface`;
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
  placement?: CrossScreenDropPlacement;
  axis?: CrossScreenDropAxis;
  dropMode?: CrossScreenDropMode;
  anchorRect?: CrossScreenHitTestAnchorRect;
}

interface CrossScreenDragElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function isFinitePoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isPortableStyleSnapshot(
  value: unknown,
): value is PortableStyleSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.version === 1 && Array.isArray(snapshot.nodes);
}

interface CanvasLayerMarqueeCandidate {
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

function isCrossScreenDropPlacement(
  value: unknown,
): value is CrossScreenDropPlacement {
  return value === "before" || value === "after" || value === "inside";
}

function isCrossScreenDropAxis(value: unknown): value is CrossScreenDropAxis {
  return value === "x" || value === "y";
}

function isCrossScreenDropMode(value: unknown): value is CrossScreenDropMode {
  return value === "flow-insert" || value === "absolute-container";
}

function isCrossScreenHitTestAnchorRect(
  value: unknown,
): value is CrossScreenHitTestAnchorRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

// Snap/guide recompute runs every rAF-coalesced mousemove during a drag and
// always returns a freshly-allocated array, so referential-equality bail in
// setState never fires even when the guides are unchanged frame-to-frame
// (e.g. holding steady mid-drag, or dragging along an axis with no new
// alignment). Shallow field-compare avoids the wasted re-render (PF15).
function alignmentGuidesEqual(a: AlignmentGuide[], b: AlignmentGuide[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.orientation !== y.orientation ||
      x.position !== y.position ||
      x.start !== y.start ||
      x.end !== y.end
    ) {
      return false;
    }
  }
  return true;
}

function distanceGuideBandEqual(
  a: DistanceGuideBand,
  b: DistanceGuideBand,
): boolean {
  return (
    a.gapStart === b.gapStart &&
    a.gapEnd === b.gapEnd &&
    a.crossStart === b.crossStart &&
    a.crossEnd === b.crossEnd
  );
}

function equalGapGuidesEqual(a: EqualGapGuide[], b: EqualGapGuide[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.orientation !== y.orientation ||
      x.gap !== y.gap ||
      !distanceGuideBandEqual(x.bands[0], y.bands[0]) ||
      !distanceGuideBandEqual(x.bands[1], y.bands[1])
    ) {
      return false;
    }
  }
  return true;
}

export function getCrossScreenDropGuideForHitTest(args: {
  hit: CrossScreenHitTestResult;
  targetGeometry: FrameGeometry;
  targetMetadata: { width: number; height: number };
}): CrossScreenDropGuide | null {
  const rect = args.hit.anchorRect;
  if (!rect) return null;
  const placement = args.hit.placement ?? "inside";
  const axis = args.hit.axis ?? "y";
  const scaleX =
    args.targetGeometry.width / Math.max(1, args.targetMetadata.width);
  const scaleY =
    args.targetGeometry.height / Math.max(1, args.targetMetadata.height);
  return {
    placement,
    axis,
    boardRect: {
      x: args.targetGeometry.x + rect.left * scaleX,
      y: args.targetGeometry.y + rect.top * scaleY,
      width: Math.max(1, rect.width * scaleX),
      height: Math.max(1, rect.height * scaleY),
    },
  };
}

export function getCrossScreenDropGuideStyle(args: {
  guide: CrossScreenDropGuide;
  pan: Point;
  scale: number;
}): CSSProperties {
  const { boardRect, placement, axis } = args.guide;
  const left = args.pan.x + (SURFACE_PADDING + boardRect.x) * args.scale;
  const top = args.pan.y + (SURFACE_PADDING + boardRect.y) * args.scale;
  const width = Math.max(1, boardRect.width * args.scale);
  const height = Math.max(1, boardRect.height * args.scale);

  if (placement === "inside") {
    return {
      left,
      top,
      width,
      height,
      border: "2px solid var(--design-editor-accent-color)",
      background:
        "color-mix(in srgb, var(--design-editor-accent-color) 14%, transparent)",
      borderRadius: 2,
      boxShadow: "none",
    };
  }

  if (axis === "x") {
    const x = placement === "before" ? left : left + width;
    return {
      left: x - 1,
      top,
      width: 2,
      height: Math.max(8, height),
      background: "var(--design-editor-accent-color)",
      borderRadius: 999,
      boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
    };
  }

  const y = placement === "before" ? top : top + height;
  return {
    left,
    top: y - 1,
    width: Math.max(8, width),
    height: 2,
    background: "var(--design-editor-accent-color)",
    borderRadius: 999,
    boxShadow: "0 0 0 1px var(--design-editor-accent-color)",
  };
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

/** Live keyboard modifiers for shape-drawing tools: shift constrains rect/
 *  ellipse to a square/circle (and lines/arrows to 45deg increments); alt
 *  draws outward from the start point as the shape's center. */
interface DraftGeometryModifiers {
  shiftKey?: boolean;
  altKey?: boolean;
}

interface DraftPrimitiveInput {
  tool: DraftCreationTool;
  start: Point;
  end: Point;
  moved: boolean;
  toolProps?: CanvasToolProps;
  modifiers?: DraftGeometryModifiers;
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

/** Multi-selection rotate (CV14): rotates every selected frame together
 *  around the group's own center, using rotateFrameGroupAroundCenter. Kept
 *  as a separate drag-state type from the single-frame RotateDragState above
 *  (rather than extending it to optionally hold multiple ids) so the
 *  existing, already-correct single-frame rotate path is never touched. */
interface GroupRotateDragState {
  type: "group-rotate";
  originClient: Point;
  originFrames: FrameGeometryById;
  targetIds: string[];
  groupCenter: Point;
  originPointerAngle: number;
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
  /**
   * True when this drag started on the close-hit-target (the path's first
   * anchor) rather than adding a new node. Figma defers the close commit
   * until mouseup so a drag on the closing click can shape the closing
   * segment's curve (the first anchor's handleIn) instead of the click
   * being an instant, undraggable straight-line close.
   */
  closing?: boolean;
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
  | GroupRotateDragState
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

// PF8: DesignEditor re-renders on nearly every interaction (drag, hover,
// zoom, selection). All call-site props are stabilized in DesignEditor.tsx
// (useMemo/useCallback hoists, cached getLayerSelectorsForFile, hoisted
// renderScreenContent, hoisted board-surface callbacks — see the "PF8"
// comments near those definitions), so a default shallow comparator is
// sufficient and preferred: it will correctly re-render whenever a real
// data/callback identity changes instead of silently masking one.
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
  const pendingChromeSettleRef = useRef(false);
  const chromeSettleTimerRef = useRef<number | null>(null);
  const [chromeSettling, setChromeSettling] = useState(false);
  const previousPreviewDeviceFrameRef = useRef(previewDeviceFrame);

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
    const rect = surfaceRef.current?.getBoundingClientRect();
    const cursor = rect
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
      x: visualLeft - SURFACE_PADDING * nextScale,
      y: visualTop - SURFACE_PADDING * nextScale,
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
      const targetViewportWidth =
        targetIframe.clientWidth || getResolvedMetadata(targetScreen).width;
      const targetViewportHeight =
        targetIframe.clientHeight || getResolvedMetadata(targetScreen).height;
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
      const targetViewportWidth =
        targetIframe?.clientWidth || getResolvedMetadata(targetScreen).width;
      const targetViewportHeight =
        targetIframe?.clientHeight || getResolvedMetadata(targetScreen).height;
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
        const guide = targetScreen
          ? getCrossScreenDropGuideForHitTest({
              hit,
              targetGeometry: candidate.geometry,
              targetMetadata: getResolvedMetadata(targetScreen),
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
        ({ anchorNodeId, placement, dropMode, anchorRect }) => {
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
        crossScreenDragMsgRef.current = {
          selector: selector ?? "",
          sourceId,
          sourcePointerOffset:
            sourcePointerOffset ??
            crossScreenDragMsgRef.current?.sourcePointerOffset,
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
        if (state?.type === "marquee" && !state.hasMoved && !state.additive) {
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
        if (state.tool === "frame" && onCreateScreenFrame) {
          onCreateScreenFrame(
            getDraftGeometryForTool(
              state.tool,
              state.originCanvas,
              endCanvas,
              modifiers,
            ),
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
        commitDraftPrimitive(nextDraft, state.originFrameId);
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
      resolvePrimitiveScreenId,
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
              preserveAspectRatio: ev.shiftKey,
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
            // Snapping x and y independently can each pull toward a
            // different sibling edge, which would distort a shift-held
            // (aspect-locked) resize away from its ratio — see
            // computeAspectPreservingResizeSnap in canvas-math.ts.
            preserveAspectRatio: ev.shiftKey,
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
        // Skip committing any transform until the drag threshold is crossed —
        // see the matching comment in beginFrameDrag's move handler.
        if (!state.hasMoved) return;

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
      dragState.current = {
        type: "group-rotate",
        originClient: { x: e.clientX, y: e.clientY },
        originFrames: Object.fromEntries(
          originEntries.map((entry) => [entry.id, entry.geometry]),
        ) as FrameGeometryById,
        targetIds: originEntries.map((entry) => entry.id),
        groupCenter,
        originPointerAngle: angleBetween(groupCenter, pointer),
        hasMoved: false,
      };
      setIsDragging(true);
      setDragCursor("grabbing");

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
      claimKeyboardFocus,
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
      }
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
        ? "crosshair"
        : penActive || getDraftCreationTool(effectiveTool)
          ? "crosshair"
          : effectiveTool === "hand"
            ? "grab"
            : "default";
  // PF19: canvasFrames (and everything derived from it below) used to be
  // plain per-render recomputation over `screens`/`frameGeometry`, which are
  // large arrays/maps for boards with many screens. Memoize so a render that
  // doesn't touch screens/geometry (e.g. a hover-only or unrelated state
  // update) doesn't re-walk and re-allocate the whole frame list.
  const canvasFrames = useMemo(
    () =>
      screens.map((screen, index) => {
        const metadata = getResolvedMetadata(screen);
        return {
          screen,
          metadata,
          geometry:
            frameGeometry[screen.id] ??
            getInitialFrameGeometry(index, metadata),
        };
      }),
    [frameGeometry, getResolvedMetadata, screens],
  );
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
  const singleSelectedDraft =
    selectedDraftEntries.length === 1 && !selectedDraftGroupBounds
      ? selectedDraftEntries[0]
      : null;
  const rootSelectedEntryCount =
    selectedFrameEntries.length + selectedDraftEntries.length;
  const showPassiveRootSelectionBoxes = rootSelectedEntryCount > 1;
  return (
    <div
      ref={surfaceRef}
      tabIndex={-1}
      className="relative h-full w-full select-none overflow-hidden outline-none"
      onMouseDownCapture={handleMouseDown}
      onMouseMove={handleMouseMove}
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
              isActive={screen.id === activeId}
              isTopScreen={screen.id === topScreenId}
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
              // Pass the id-first callbacks straight through (PF18): Screen
              // itself binds screen.id when it calls these, so every screen
              // instance gets the exact same stable function reference here
              // instead of a fresh per-screen closure allocated on every
              // MultiScreenCanvas render, which used to defeat memo(Screen).
              onAddBreakpoint={onAddBreakpoint}
              onActiveBreakpointChange={onActiveBreakpointChange}
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
      </div>

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
        rotationDeg={draft.geometry.rotation ?? 0}
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
  const childHoverActive =
    hasHoveredChild && !creationToolActive && !canvasGestureActive;
  const suppressFrameChromeForChild =
    hasHoveredChild && !directlyHovered && !isDirectlyHovered;
  const emphasized = isSelected || frameDirectlyHovered;
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
  const fullViewOutsideFrame =
    frameScreenWidth < FRAME_HEADER_BUTTON_OUTSIDE_WIDTH;
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
      className="group/frame pointer-events-auto absolute"
      style={{
        left: SURFACE_PADDING + geometry.x,
        top: SURFACE_PADDING + geometry.y - frameLabelHeight,
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
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              emphasized ? "bg-primary" : "bg-muted-foreground/40",
            )}
          />
          <span
            data-frame-title
            className={cn(
              "min-w-0 flex-1 truncate !text-[11px] font-medium",
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
          rotationDeg={geometry.rotation ?? 0}
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
    prev.isTopScreen === next.isTopScreen &&
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
    prev.onStartDuplicateGesture === next.onStartDuplicateGesture &&
    // Now id-first (screenId, widthPx) callbacks passed straight through
    // from MultiScreenCanvas's own props (PF18) instead of a fresh
    // per-screen arrow allocated in the render loop, so these are expected
    // to be referentially stable across renders and are safe to compare.
    prev.onAddBreakpoint === next.onAddBreakpoint &&
    prev.onActiveBreakpointChange === next.onActiveBreakpointChange
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
   * their own distinct [data-screen-iframe-id] (see getBreakpointIframeId)
   * by the cross-screen drop-into-container handler when that breakpoint is
   * the active edit scope (see getActiveScreenIframeId).
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
                    "truncate !text-[11px] font-medium",
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
