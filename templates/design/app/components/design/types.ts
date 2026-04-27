export interface ElementInfo {
  tagName: string;
  id?: string;
  classes: string[];
  computedStyles: Record<string, string>;
  boundingRect: { x: number; y: number; width: number; height: number };
  textContent?: string;
  isFlexChild: boolean;
  isFlexContainer: boolean;
  parentDisplay?: string;
}

export type DeviceFrameType = "none" | "desktop" | "tablet" | "mobile";

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
