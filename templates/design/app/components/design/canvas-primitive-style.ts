
import type * as React from "react";


export type CanvasPrimitiveKind =
  | "rect"
  | "rectangle"
  | "ellipse"
  | "text"
  | "frame";

export interface CanvasPrimitiveVisual {
  background: string;
  border: string;
  borderRadius: string;
  color?: string;
}


// guard:allow-raw-color — a drawn shape must not retint with the document theme.
export const DEFAULT_SHAPE_FILL = "rgb(217 217 217)";

const DEFAULT_STROKE = "rgb(168 168 168)";

const DEFAULT_STROKE_WIDTH_PX = 1;

const NO_BORDER = "0 solid transparent";

const TEXT_BORDER = "0 solid transparent";

const FRAME_BORDER = `${DEFAULT_STROKE_WIDTH_PX}px dashed ${DEFAULT_STROKE}`;

const FRAME_FILL = "hsl(var(--primary) / 0.05)";

const RECT_RADIUS = "0px";

export const DEFAULT_LINE_STROKE = "#000000";

export const DEFAULT_LINE_STROKE_WIDTH_PX = 1;

export interface CanvasVectorPaint {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export function canvasVectorPaint(overrides: {
  outline: "shape" | "closed-path" | "open-path";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}): CanvasVectorPaint {
  const { outline, fill, stroke, strokeWidth } = overrides;
  return {
    fill:
      outline === "open-path"
        ? "none"
        : (fill ?? (outline === "shape" ? DEFAULT_SHAPE_FILL : "none")),
    stroke: stroke ?? (outline === "shape" ? "none" : DEFAULT_LINE_STROKE),
    strokeWidth: strokeWidth ?? DEFAULT_LINE_STROKE_WIDTH_PX,
  };
}


export function canvasPrimitiveVisual(
  kind: CanvasPrimitiveKind,
): CanvasPrimitiveVisual {
  switch (kind) {
    case "ellipse":
      return {
        background: DEFAULT_SHAPE_FILL,
        border: NO_BORDER,
        borderRadius: "50%",
      };
    case "frame":
      return {
        background: FRAME_FILL,
        border: FRAME_BORDER,
        borderRadius: RECT_RADIUS,
      };
    case "text":
      return {
        background: "transparent",
        border: TEXT_BORDER,
        borderRadius: RECT_RADIUS,
        color: "currentColor",
      };
    case "rect":
    case "rectangle":
    default:
      return {
        background: DEFAULT_SHAPE_FILL,
        border: NO_BORDER,
        borderRadius: RECT_RADIUS,
      };
  }
}


export function canvasPrimitiveStyleString(
  kind: CanvasPrimitiveKind,
  overrides?: { fill?: string; stroke?: string; strokeWidth?: number },
): string {
  const v = canvasPrimitiveVisual(kind);
  const isText = kind === "text";

  let background = v.background;
  let border = v.border;

  if (overrides?.fill && !isText) {
    background = overrides.fill;
  }
  if (overrides?.stroke || overrides?.strokeWidth !== undefined) {
    const stroke = overrides.stroke ?? DEFAULT_STROKE;
    const width = overrides.strokeWidth ?? DEFAULT_STROKE_WIDTH_PX;
    const style = kind === "frame" || isText ? "dashed" : "solid";
    border = `${width}px ${style} ${stroke}`;
  }

  const parts: string[] = [
    `background:${background}`,
    `border:${border}`,
    `border-radius:${v.borderRadius}`,
  ];

  const color = isText ? overrides?.fill || v.color || "currentColor" : v.color;
  if (color) {
    parts.push(`color:${color}`);
  }

  return parts.join(";");
}


export function canvasPrimitiveReactStyle(
  kind: CanvasPrimitiveKind,
  overrides?: { fill?: string; stroke?: string; strokeWidth?: number },
): React.CSSProperties {
  const v = canvasPrimitiveVisual(kind);
  const isText = kind === "text";

  let background = v.background as string | undefined;
  let borderColor: string | undefined;
  let borderWidth: number | string | undefined = v.border.startsWith("0 ")
    ? 0
    : DEFAULT_STROKE_WIDTH_PX;
  let borderStyle: string | undefined = "solid";

  if (kind === "frame" || isText) {
    borderStyle = "dashed";
  }

  if (isText && !overrides?.stroke && overrides?.strokeWidth === undefined) {
    borderWidth = 0;
    borderStyle = "solid";
  }

  if (overrides?.fill && !isText) {
    background = overrides.fill;
  }
  if (overrides?.stroke) {
    borderColor = overrides.stroke;
    if (overrides.strokeWidth === undefined) {
      borderWidth = DEFAULT_STROKE_WIDTH_PX;
    }
  } else if (overrides?.strokeWidth !== undefined) {
    borderColor = DEFAULT_STROKE;
  } else {
    const borderParts = v.border.split(" ");
    borderColor = borderParts.slice(2).join(" ");
  }
  if (overrides?.strokeWidth !== undefined) {
    borderWidth = overrides.strokeWidth;
  }

  const style: React.CSSProperties = {
    background,
    border: undefined,
    borderColor,
    borderWidth,
    borderStyle,
    borderRadius: v.borderRadius,
  };

  if (v.color) {
    style.color = v.color;
  }

  if (isText) {
    style.background = "transparent";
    style.outline = "none";
    style.outlineOffset = 0;
    style.color = overrides?.fill || "currentColor";
  }

  return style;
}
