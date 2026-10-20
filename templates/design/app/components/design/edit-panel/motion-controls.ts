import type { ElementInfo } from "../types";
import {
  defaultDropShadowLayer,
  parseShadowLayers,
  serializeShadowLayers,
} from "./effects-properties";
import { isBoxlessText, isTextElement } from "./element-classification";
import { NEW_FILL_COLOR } from "./fill-gradient-helpers";
import { shouldUseTextFill } from "./fill-properties";
import {
  colorHasVisibleAlpha,
  strokeIsVisible,
  vectorStrokeIsVisible,
} from "./position-helpers";
import { isVectorShapeSelection } from "./selection-helpers";
import { addBorderPatch } from "./stroke-properties";

export const MOTION_MENU_BASIC_PROPERTIES = [
  "translate",
  "scale",
  "rotate",
  "opacity",
] as const;

export const MOTION_MENU_MORE_PROPERTIES = [
  "border-radius",
  "background-color",
  "border-color",
  "border-width",
  "box-shadow",
] as const;

export type MotionMenuProperty =
  | (typeof MOTION_MENU_BASIC_PROPERTIES)[number]
  | (typeof MOTION_MENU_MORE_PROPERTIES)[number];

const OPEN_PATH_PRIMITIVE_KINDS = new Set(["path", "line", "arrow"]);

/**
 * The keyframe-able controls the inspector offers for one layer. Mirrors the
 * inspector's own branching: text swaps the fill, stroke, and corner controls
 * for its own, vectors and groups keep paint on other properties, and every
 * layer keeps move, scale, rotate, and opacity. Unlike a diamond, a control is
 * offered even when the layer lacks the look, because its add button is shown.
 */
export function motionControlsOffered(
  element: ElementInfo,
): MotionMenuProperty[] {
  const text = isTextElement(element);
  const vector = isVectorShapeSelection(element);
  const offered = new Set<MotionMenuProperty>(MOTION_MENU_BASIC_PROPERTIES);
  if (!isBoxlessText(element)) offered.add("border-radius");
  if (
    !element.isGroup &&
    !vector &&
    !shouldUseTextFill(element, element.computedStyles)
  ) {
    offered.add("background-color");
  }
  if (!text && !vector) {
    offered.add("border-color");
    offered.add("border-width");
  }
  if (!text) offered.add("box-shadow");
  return [
    ...MOTION_MENU_BASIC_PROPERTIES,
    ...MOTION_MENU_MORE_PROPERTIES,
  ].filter((property) => offered.has(property));
}

/**
 * The look the inspector's add-fill, add-stroke, and add-shadow buttons give a
 * layer, or null when the layer already has it (or the property has none).
 */
export function motionStarterStyles(
  element: ElementInfo,
  property: MotionMenuProperty,
): Record<string, string> | null {
  const styles = element.computedStyles;
  switch (property) {
    case "background-color":
      return colorHasVisibleAlpha(styles.backgroundColor)
        ? null
        : { backgroundColor: NEW_FILL_COLOR };
    case "border-color":
    case "border-width":
      return strokeIsVisible(styles.borderWidth, styles.borderStyle)
        ? null
        : addBorderPatch(styles);
    case "box-shadow":
      return parseShadowLayers(styles.boxShadow).length > 0
        ? null
        : { boxShadow: serializeShadowLayers([defaultDropShadowLayer(0)]) };
    default:
      return null;
  }
}

/**
 * Outline drawing trims an open path's stroke with a dash pattern, so it needs
 * an open vector with a visible, solid, centered stroke.
 */
export function isOutlineDrawingEligible(
  element: Pick<
    ElementInfo,
    "tagName" | "primitiveKind" | "vectorStrokeCanAlign" | "computedStyles"
  >,
): boolean {
  if (
    element.tagName?.toLowerCase() !== "svg" ||
    !OPEN_PATH_PRIMITIVE_KINDS.has(element.primitiveKind ?? "") ||
    element.vectorStrokeCanAlign
  ) {
    return false;
  }
  const styles = element.computedStyles;
  if (!vectorStrokeIsVisible(styles.stroke, styles.strokeWidth)) return false;
  const position = styles["--an-vector-stroke-position"];
  if (position && position !== "center") return false;
  const dashes = (
    styles.strokeDasharray ??
    styles["stroke-dasharray"] ??
    ""
  ).trim();
  return dashes === "" || dashes === "none" || /^0(px)?$/.test(dashes);
}
