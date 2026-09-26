import type {
  ElementProvenance,
  RuntimeComponentIdentity,
} from "@shared/source-mode";

export interface PortableStyleSnapshotNode {
  sourceId?: string;
  path: number[];
  styles: Record<string, string>;
}

export interface PortableStyleSnapshot {
  version: 1;
  rootSourceId?: string;
  nodes: PortableStyleSnapshotNode[];
}

export interface RuntimeStructureMove {
  subject: { selector: string; sourceId?: string | null };
  anchor: { selector: string; sourceId?: string | null };
  placement: "before" | "after" | "inside";
  transactionId?: string;
  gridPlacement?: {
    column: number;
    columnEnd: number;
    row: number;
    rowEnd: number;
  };
  gridDisplacements?: Array<{
    sourceId?: string;
    selector?: string;
    placement: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
  }>;
}

export interface RuntimeStructureMoveRequest extends RuntimeStructureMove {
  requestId: number;
  moves?: RuntimeStructureMove[];
}

export interface GridGroupStructureMove {
  requestId: string;
  transactionId?: string;
  selector: string;
  sourceId: string;
  anchorSelector: string;
  anchorSourceId: string;
  placement?: "before" | "after" | "inside";
  persistenceAnchorSelector?: string;
  persistenceAnchorSourceId?: string;
  persistencePlacement?: "before" | "after" | "inside";
  gridPlacement: {
    column: number;
    columnEnd: number;
    row: number;
    rowEnd: number;
  };
  gridDisplacements: Array<{
    sourceId: string;
    selector: string;
    placement: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
  }>;
}

/**
 * Insert NEW markup into a live screen's running DOM. Unlike
 * RuntimeStructureMoveRequest there is no subject in the running app yet —
 * the html is the subject, already positioned by the host.
 */
export interface RuntimeStructureInsertRequest {
  requestId: number;
  transactionId?: string;
  /** Owning screen for host-side routing of the live insert. */
  screenId?: string;
  /** Source screen identity used to distinguish a same-screen reorder from a cross-screen insert. */
  sourceScreenId?: string;
  /** Remint only ids already used by the destination live document. */
  remintCollidingNodeIds?: boolean;
  html: string;
  /** Additional clipboard roots inserted by the same paste gesture. */
  additionalHtml?: string[];
  /** Replace the resolved anchor instead of inserting beside/inside it. */
  replaceAnchor?: boolean;
  anchor: {
    selector: string;
    sourceId?: string | null;
    /** Hit-test-minted id, live-DOM only. The only handle on an id-less anchor. */
    pendingNodeId?: string | null;
  };
  placement: "before" | "after" | "inside";
}

export interface RuntimeStructureDeleteRequest {
  requestId: string;
  transactionId?: string;
  selector: string;
  selectorCandidates?: string[];
  /** Cross-screen moves delete the source only after the destination insert ack. */
  waitForInsertTransaction?: boolean;
  rollbackScreenId?: string;
  rollbackSelector?: string;
  rollbackSourceId?: string;
  /** Cancel a source delete and restore its DOM before rolling back the insert. */
  cancelRequested?: boolean;
}

export interface RuntimeStructureRollbackRequest {
  requestId: string;
  transactionId?: string;
  selector: string;
  sourceId?: string;
  /** A target lost across canvas unmount is already rolled back if absent. */
  idempotent?: boolean;
  retryCount?: number;
}

export interface RuntimeLayerRenameRequest {
  requestId: number;
  selector: string;
  sourceId?: string | null;
  routePath?: string;
  name: string;
}

export interface RuntimeVerificationRequest {
  requestId: number;
}

export interface ElementInfo {
  tagName: string;
  componentName?: string;
  /** The durable inline/component annotation, distinct from runtime labels. */
  componentAnnotation?: string;
  /** Framework-derived identity for an unannotated runtime component. */
  runtimeComponent?: RuntimeComponentIdentity;
  id?: string;
  sourceId?: string;
  /**
   * Source location reported by the canvas bridge. React development builds
   * derive this from jsxDEV/Fiber debug frames; instrumented runtimes may emit
   * the equivalent data-source-* attributes. This is provenance only, not a
   * stable source identity: callers must still verify the file contents and
   * location before any write.
   */
  provenance?: ElementProvenance;
  /**
   * Node-id integrity (id-on-demand): a durable candidate id the bridge minted
   * for this element because it has no stable `data-agent-native-node-id`
   * (or other stable source id) at all — common on AI-generated screens,
   * where every id-keyed host operation (move/reorder, style commits that
   * resolve a targetNode, motion tracks, scrub) otherwise silently no-ops or
   * throws `Node with data-agent-native-node-id="" not found in sourceHtml`.
   * Only present when `sourceId` is absent/empty. The host should persist
   * this value into the source as the element's real
   * `data-agent-native-node-id` the moment it sees one (see
   * DesignEditor.tsx's selection handlers), through the same guarded write
   * path every other edit uses — after that every subsequent id-keyed op
   * against this element resolves normally via `sourceId`.
   */
  pendingNodeId?: string;
  /**
   * Set when this element is one rendered row of an `x-for`. `selector`
   * addresses the row (so overlays and geometry follow the row clicked);
   * `sourceSelector` addresses the single element in the template body that
   * every row was stamped from, which is the only place a write can land.
   */
  repeat?: {
    sourceSelector: string;
    instanceCount: number;
    instanceIndex: number;
    /** The owning `x-for` expression, so a data edit can find its array. */
    xFor: string;
    /** 0-based position in that array; -1 when it could not be determined. */
    itemIndex: number;
    /** The `x-text` this element renders; empty when its text is literal. */
    textBinding: string;
    /** The repeat's `:key` expression, e.g. `task.id`. */
    keyExpression: string;
    /** This row's rendered key value; empty when Alpine did not report one. */
    itemKey: string;
  };
  selector?: string;
  /**
   * Whether this element holds text directly. A row of dot + label + checkbox
   * holds none, so it is a container even though `li` usually carries text.
   * Absent only on hand-built payloads, which keep the tag-only reading.
   */
  hasOwnText?: boolean;
  /** The selected element owns an all-inline text subtree that can be styled as one text layer. */
  wholeTextStyleRoot?: boolean;
  /**
   * The `selector` / `sourceId` the canvas bridge originally reported, kept
   * verbatim when the host canonicalizes the selection onto its own source
   * projection (canonicalElementInfoForCodeLayerNode). For a live/localhost
   * screen the two are DIFFERENT node-id namespaces — the running document
   * carries the ids the bridge assigned there, the fetched source snapshot
   * carries the ones ensureCodeLayerNodeIdsInHtml stamped — so the canonical
   * selector cannot address the live DOM. Any host-initiated mutation of the
   * running document (currently only delete) must target these instead.
   */
  runtimeSelector?: string;
  runtimeSourceId?: string;
  /** Exact source-projection target and Screen that resolved this selection. */
  sourceLayerIdentity?: { screenId: string; nodeId: string };
  classes: string[];
  computedStyles: Record<string, string>;
  /**
   * Raw authored `el.style` values (not computed) for a bounded set of
   * layout- and text-edit-relevant properties: position, left, right, top,
   * bottom, width, height, transform, lineHeight, whiteSpace. Populated on SELECTION payloads only
   * (not hover). Optional because older/hover payloads omit it — callers
   * must fall back to computedStyles-based inference when absent.
   */
  inlineStyles?: Record<string, string>;
  /**
   * Winning width/height values from the active CSS computed style map.
   * Unlike `inlineStyles`, these values are not safe write targets; they only
   * preserve sizing intent when computed styles have resolved them to pixels.
   */
  authoredSizeStyles?: Partial<Record<"width" | "height", string>>;
  /**
   * Value of the element's `data-an-primitive` attribute (e.g. "text",
   * "rectangle", "frame", "ellipse") when present. Canvas-drawn primitives —
   * including T-tool text, which is a plain `div` — carry this marker so the
   * inspector can identify them without relying on tagName alone. Optional
   * because older payloads and non-primitive/source-backed elements omit it.
   */
  primitiveKind?: string;
  /** Set only on explicit Cmd+G wrappers, so Group paint targets descendants. */
  isGroup?: boolean;
  /** Closed SVG vectors can render their stroke inside or outside the path. */
  vectorStrokeCanAlign?: boolean;
  portableStyleSnapshot?: PortableStyleSnapshot;
  /** Present only when a portable snapshot could not be captured completely. */
  styleSnapshotCaptureFailed?: boolean;
  boundingRect: { x: number; y: number; width: number; height: number };
  /** Exact bounds of the selected element's direct parent in the same
   * document coordinate space as `boundingRect`. Constraint edits use this
   * to preserve edge gaps, center offsets, and proportional Scale geometry. */
  parentBoundingRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Capped at 200 chars by the editor-chrome bridge. `apply-visual-edit`
   *  kind:"textContent" replaces the element's whole text, so writing this
   *  value back when `textContentTruncated` is true destroys everything past
   *  the cap. Read the full text before any textContent overwrite. */
  textContent?: string;
  textContentTruncated?: boolean;
  /** Capped at 4000 chars; same overwrite hazard as `textContent`. */
  htmlContent?: string;
  htmlContentTruncated?: boolean;
  /** An `<img>`'s authored src, for the Image fill thumbnail. */
  imageSource?: string;
  /** Direct element children; text nodes are ignored. */
  childElementCount?: number;
  isFlexChild: boolean;
  isFlexContainer: boolean;
  isGridContainer?: boolean;
  parentDisplay?: string;
  parentAutoLayout?: {
    display?: string;
    selector?: string;
    sourceId?: string;
    boundingRect: { x: number; y: number; width: number; height: number };
  };
  parentLayout?: {
    display?: string;
    flexDirection?: string;
    alignItems?: string;
    justifyContent?: string;
    gap?: string;
    gridAutoFlow?: string;
    gridTemplateColumns?: string;
    gridTemplateRows?: string;
    position?: string;
  };
  editCapabilities?: Array<{
    kind:
      | "deterministic-style-edit"
      | "deterministic-class-edit"
      | "agent-structural-edit"
      | "unsupported";
    label: string;
    confidence: number;
    reason?: string;
  }>;
  confidence?: number;
}

/** Current text-edit session state reported by one canvas bridge. */
export interface TextEditingState {
  active: boolean;
  selector?: string;
  sourceId?: string;
  hasRange?: boolean;
  computedStyles?: Record<string, string>;
  inlineStyles?: Record<string, string>;
  /** The edited text box's live size; typing grows a hug-sized text. */
  rect?: { width: number; height: number };
  /** Added by the host so overview iframes cannot exchange range styles. */
  screenId?: string;
}

export interface ElementSelectionIntent {
  additive?: boolean;
  range?: boolean;
  source?: "pointer" | "keyboard" | "marquee";
  final?: boolean;
  /** Ends a marquee lifecycle without changing the current selection. */
  cancelled?: boolean;
  /** Restores the host selection captured before an Escape-cancelled marquee. */
  restoreHostSelection?: boolean;
  /** Retires any pending marquee history before the next gesture starts. */
  resetHistory?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface CanvasLayerHitCandidate {
  key: string;
  label: string;
  screenId?: string;
  breakpointWidthPx?: number;
  info: ElementInfo;
}

export type DeviceFrameType = "none" | "desktop" | "tablet" | "mobile";

export const DEVICE_FRAME_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const satisfies Record<
  Exclude<DeviceFrameType, "none">,
  { width: number; height: number }
>;

export interface ViewportTab {
  id: string;
  filename: string;
}

export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const;

export type ZoomPreset = (typeof ZOOM_PRESETS)[number];

export interface DrawAnnotation {
  id: string;
  type: "path" | "text";
  /** SVG path data for freehand strokes */
  pathData?: string;
  /** Text content for text annotations */
  text?: string;
  /** Position on the canvas */
  position: { x: number; y: number };
  /** Stroke color */
  color: string;
  /** Stroke width */
  lineWidth: number;
  /** Bounding rect of the element being annotated, if any */
  elementContext?: ElementInfo;
}
