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

export interface ElementInfo {
  tagName: string;
  componentName?: string;
  id?: string;
  sourceId?: string;
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
  selector?: string;
  classes: string[];
  computedStyles: Record<string, string>;
  /**
   * Raw authored `el.style` values (not computed) for a bounded set of
   * layout-relevant properties: position, left, right, top, bottom, width,
   * height, transform, whiteSpace. Populated on SELECTION payloads only
   * (not hover). Optional because older/hover payloads omit it — callers
   * must fall back to computedStyles-based inference when absent.
   */
  inlineStyles?: Record<string, string>;
  /**
   * Value of the element's `data-an-primitive` attribute (e.g. "text",
   * "rectangle", "frame", "ellipse") when present. Canvas-drawn primitives —
   * including T-tool text, which is a plain `div` — carry this marker so the
   * inspector can identify them without relying on tagName alone. Optional
   * because older payloads and non-primitive/source-backed elements omit it.
   */
  primitiveKind?: string;
  portableStyleSnapshot?: PortableStyleSnapshot;
  boundingRect: { x: number; y: number; width: number; height: number };
  textContent?: string;
  htmlContent?: string;
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

export interface ElementSelectionIntent {
  additive?: boolean;
  range?: boolean;
  source?: "pointer" | "keyboard" | "marquee";
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
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
