export interface ElementInfo {
  tagName: string;
  componentName?: string;
  id?: string;
  sourceId?: string;
  selector?: string;
  classes: string[];
  computedStyles: Record<string, string>;
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
