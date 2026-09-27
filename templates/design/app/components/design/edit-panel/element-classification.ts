import {
  type AlignmentMatrixValue,
  type AutoLayoutMatrixValue,
  type AutoLayoutSizing,
  type AutoLayoutSizingAxis,
} from "../inspector";
import type { ElementInfo } from "../types";
import { normalizedElementTagName } from "./code-inspect-helpers";
import { commitStylePatch } from "./field-primitives";
import type {
  StyleChangeHandler,
  StyleChangeMeta,
  StylesChangeHandler,
} from "./style-change-types";

export const TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "strong",
  "em",
  "label",
  "li",
]);

export function inspectorObjectTitle(element: ElementInfo): string {
  const componentName = componentNameForElementInfo(element);
  if (componentName) return componentName;
  if (element.isGroup) return "Group";
  const tag = normalizedElementTagName(element.tagName);
  if (isTextElement(element)) return "Text";
  if (tag === "img" || tag === "picture") return "Image";
  if (tag === "svg") return "Vector";
  if (element.primitiveKind === "frame") return "Frame";
  return tag;
}

export function componentNameForElementInfo(
  element: ElementInfo | null | undefined,
): string {
  const explicitName = element?.componentName?.trim();
  if (explicitName) return explicitName;
  return element?.provenance?.component?.trim() ?? "";
}

export function elementIsComponentSelection(
  element: ElementInfo | null | undefined,
): boolean {
  return componentNameForElementInfo(element).length > 0;
}

export function elementHasComponentAnnotation(
  element: ElementInfo | null | undefined,
): boolean {
  return Boolean(
    element?.componentAnnotation?.trim() ||
    (!element?.runtimeComponent && element?.componentName?.trim()),
  );
}

export function displayLabel(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === "normal") return "flow";
  return normalized;
}

export function justifyToHorizontal(
  value: string | undefined,
): AlignmentMatrixValue["horizontal"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end" || value === "right") {
    return "right";
  }
  return "left";
}

export function alignToVertical(
  value: string | undefined,
): AlignmentMatrixValue["vertical"] {
  if (value === "center") return "middle";
  if (value === "flex-end" || value === "end" || value === "bottom") {
    return "bottom";
  }
  return "top";
}

export function horizontalToJustify(
  value: AlignmentMatrixValue["horizontal"],
): string {
  if (value === "center") return "center";
  if (value === "right") return "flex-end";
  return "flex-start";
}

export function verticalToAlign(
  value: AlignmentMatrixValue["vertical"],
): string {
  if (value === "middle") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

export function autoLayoutAlignmentFromStyles(
  styles: Record<string, string>,
  direction: AutoLayoutMatrixValue["direction"],
): AlignmentMatrixValue {
  if (direction === "vertical") {
    return {
      horizontal: justifyToHorizontal(styles.alignItems),
      vertical: alignToVertical(styles.justifyContent),
    };
  }
  return {
    horizontal: justifyToHorizontal(styles.justifyContent),
    vertical: alignToVertical(styles.alignItems),
  };
}

const CONTAINER_TAGS = new Set([
  "body",
  "div",
  "section",
  "main",
  "header",
  "footer",
  "nav",
  "article",
  "aside",
  "form",
  "ul",
  "ol",
  "figure",
  "fieldset",
  "details",
  "dialog",
  "blockquote",
  "table",
  "tbody",
  "thead",
  "tr",
]);

const LEAF_TAGS = new Set([
  "img",
  "video",
  "picture",
  "audio",
  "canvas",
  "svg",
  "path",
  "input",
  "textarea",
  "select",
  "br",
  "hr",
  "iframe",
]);

function hasExplicitTextIdentity(element: ElementInfo): boolean {
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) {
    return element.hasOwnText !== false || element.wholeTextStyleRoot === true;
  }
  if (element.primitiveKind) return element.primitiveKind === "text";
  const nodeId = element.sourceId || element.pendingNodeId || "";
  return nodeId.startsWith("draft-text-");
}

export function isContainerElement(element: ElementInfo): boolean {
  if (element.isGroup === true) return false;
  if (hasExplicitTextIdentity(element)) return false;
  const primitiveKind = element.primitiveKind?.trim().toLowerCase();
  if (primitiveKind) {
    return ["frame", "rectangle", "rect"].includes(primitiveKind);
  }
  if (element.isFlexContainer || element.isGridContainer) return true;
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag) || LEAF_TAGS.has(tag)) return false;
  return CONTAINER_TAGS.has(tag);
}

export function canHugContent(element: ElementInfo): boolean {
  const primitiveKind = element.primitiveKind?.trim().toLowerCase();
  const tag = (element.tagName || "").toLowerCase();
  const isAutoLayoutContainer =
    element.isFlexContainer || element.isGridContainer;
  if (primitiveKind === "text" || TEXT_TAGS.has(tag)) return true;
  if (primitiveKind) {
    if (!["frame", "rectangle", "rect"].includes(primitiveKind)) return false;
    return isAutoLayoutContainer || hasMeasurableContent(element);
  }
  if (LEAF_TAGS.has(tag)) return false;
  return isAutoLayoutContainer || hasMeasurableContent(element);
}

function hasMeasurableContent(element: ElementInfo): boolean {
  const children = element.childElementCount;
  const text = element.textContent?.trim();
  if (children === undefined && element.textContent === undefined) return true;
  return (children ?? 0) > 0 || Boolean(text);
}

export function isParentFlex(element: ElementInfo): boolean {
  return (
    element.isFlexChild ||
    Boolean(element.parentDisplay?.toLowerCase().includes("flex"))
  );
}

export function isParentGrid(element: ElementInfo): boolean {
  return Boolean(element.parentDisplay?.toLowerCase().includes("grid"));
}

export function parentFlexDirection(
  element: ElementInfo,
): AutoLayoutSizingAxis | null {
  const direction = element.parentLayout?.flexDirection;
  if (direction)
    return direction.includes("column") ? "vertical" : "horizontal";
  return isParentFlex(element) ? "horizontal" : null;
}

const VECTOR_PRIMITIVE_KINDS = new Set([
  "pasted-svg",
  "path",
  "line",
  "arrow",
  "polygon",
  "star",
  "rect",
  "rectangle",
  "ellipse",
  "circle",
  "boolean",
  "boolean-operand",
]);

export function isVectorShapeElement(element: ElementInfo): boolean {
  const tag = (element.tagName || "").toLowerCase();
  if (
    tag === "path" ||
    tag === "polygon" ||
    tag === "polyline" ||
    tag === "ellipse" ||
    tag === "circle" ||
    tag === "rect" ||
    tag === "line"
  ) {
    return true;
  }
  if (tag !== "svg") return false;
  return VECTOR_PRIMITIVE_KINDS.has(element.primitiveKind ?? "");
}

export function isTextElement(element: ElementInfo): boolean {
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) {
    return element.hasOwnText !== false || element.wholeTextStyleRoot === true;
  }
  if (element.primitiveKind) return element.primitiveKind === "text";
  const nodeId = element.sourceId || element.pendingNodeId || "";
  if (nodeId.startsWith("draft-text-")) return true;
  if (nodeId.startsWith("draft-rect-") || nodeId.startsWith("draft-frame-")) {
    return false;
  }
  if (element.hasOwnText !== undefined) return element.hasOwnText;
  if (
    tag === "div" &&
    (element.childElementCount ?? 0) === 0 &&
    Boolean(element.textContent?.trim())
  ) {
    return true;
  }
  return false;
}

export function availableSizingForElement(
  element: ElementInfo,
): Partial<Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>> {
  const canHug = canHugContent(element);
  const isFlexChildEl = isParentFlex(element) || isParentGrid(element);
  const position = (
    element.computedStyles.position || element.inlineStyles?.position
  )?.toLowerCase();
  const isOutOfFlowLayoutChild =
    isFlexChildEl && (position === "absolute" || position === "fixed");
  const isBlockChild = Boolean(element.parentDisplay) && !isFlexChildEl;

  const buildAxis = (axis: AutoLayoutSizingAxis): AutoLayoutSizing[] => {
    const options: AutoLayoutSizing[] = ["fixed"];
    if (canHug) options.push("hug");
    if (
      (isFlexChildEl && !isOutOfFlowLayoutChild) ||
      (isBlockChild && axis === "horizontal")
    ) {
      options.push("fill");
    }
    return options;
  };

  return {
    horizontal: buildAxis("horizontal"),
    vertical: buildAxis("vertical"),
  };
}

export function readElementMinMax(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): { min: number | null; max: number | null } {
  const styles = element.computedStyles;
  const minRaw = axis === "horizontal" ? styles.minWidth : styles.minHeight;
  const maxRaw = axis === "horizontal" ? styles.maxWidth : styles.maxHeight;
  return {
    min: parseConstraintLength(minRaw),
    max: parseConstraintLength(maxRaw),
  };
}

export function parseConstraintLength(
  value: string | undefined,
): number | null {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "none" ||
    normalized === "auto" ||
    normalized === "0px" ||
    normalized === "0"
  ) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function commitElementMinMax(
  axis: AutoLayoutSizingAxis,
  kind: "min" | "max",
  value: number | null,
  onStyleChange: StyleChangeHandler,
  meta?: StyleChangeMeta,
) {
  const isHorizontal = axis === "horizontal";
  const property =
    kind === "min"
      ? isHorizontal
        ? "minWidth"
        : "minHeight"
      : isHorizontal
        ? "maxWidth"
        : "maxHeight";
  if (value == null) {
    onStyleChange(property, kind === "min" ? "0px" : "none", meta);
    return;
  }
  onStyleChange(
    property,
    `${Math.max(0, Math.round(value * 10) / 10)}px`,
    meta,
  );
}

export function inferElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): AutoLayoutSizing {
  const styles = element.computedStyles;
  const property = axis === "horizontal" ? "width" : "height";
  const authoredSize =
    element.authoredSizeStyles?.[property]?.trim().toLowerCase() ||
    element.inlineStyles?.[property]?.trim().toLowerCase();
  const size = authoredSize || styles[property];
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const isCrossFlexAxis =
    isFlex && parentDirection !== null && parentDirection !== axis;
  const alignSelf = (styles.alignSelf || "").toLowerCase();

  if (
    size === "100%" ||
    (isMainFlexAxis && Number.parseFloat(styles.flexGrow || "0") > 0) ||
    (isCrossFlexAxis && alignSelf === "stretch")
  ) {
    return "fill";
  }
  if (size === "auto" || size === "fit-content" || size === "max-content") {
    return "hug";
  }
  return "fixed";
}

export function measuredElementSize(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): number | null {
  const reported =
    axis === "horizontal"
      ? element.computedStyles.width
      : element.computedStyles.height;
  const parsed = resolvedPxSize(reported);
  if (parsed !== null) return parsed;
  if (reported?.trim()) return null;
  const rect =
    axis === "horizontal"
      ? element.boundingRect.width
      : element.boundingRect.height;
  return Number.isFinite(rect) && rect > 0 ? rect : null;
}

export function resolvedPxSize(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(trimmed)) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sizeNeedsMeasurement(styles: Record<string, string>): boolean {
  return (["width", "height"] as const).some((property) => {
    const value = styles[property]?.trim();
    return Boolean(value) && resolvedPxSize(value) === null;
  });
}

export function cssElementSize(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): number {
  const isHorizontal = axis === "horizontal";
  const cssValue = isHorizontal
    ? element.computedStyles.width
    : element.computedStyles.height;
  const parsed = parseFloat(cssValue || "");
  const fallback = isHorizontal
    ? element.boundingRect.width
    : element.boundingRect.height;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function commitElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
  sizing: AutoLayoutSizing,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
) {
  commitStylePatch(
    elementSizingStylePatch(element, axis, sizing),
    onStyleChange,
    onStylesChange,
  );
}

export function commitFixedElementSizes(
  element: ElementInfo,
  sizes: Partial<Record<AutoLayoutSizingAxis, number>>,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
  meta?: StyleChangeMeta,
) {
  const patch: Record<string, string> = {};
  for (const axis of ["horizontal", "vertical"] as const) {
    const size = sizes[axis];
    if (size === undefined) continue;
    Object.assign(patch, elementSizingStylePatch(element, axis, "fixed", size));
  }
  commitStylePatch(patch, onStyleChange, onStylesChange, meta);
}

function elementSizingStylePatch(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
  sizing: AutoLayoutSizing,
  fixedSizePx?: number,
): Record<string, string> {
  const isHorizontal = axis === "horizontal";
  const sizeProperty = isHorizontal ? "width" : "height";
  const resolvedSize =
    fixedSizePx ?? Math.max(1, Math.round(cssElementSize(element, axis)));
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isGrid = isParentGrid(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const stretchProperty = isFlex || !isHorizontal ? "alignSelf" : "justifySelf";
  const patch: Record<string, string> = {};

  if (sizing === "fixed") {
    patch[sizeProperty] = `${resolvedSize}px`;
    if (isMainFlexAxis) {
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    } else if (isFlex || isGrid) {
      patch[stretchProperty] = "auto";
    }
  } else if (sizing === "hug") {
    patch[sizeProperty] = "fit-content";
    if (isMainFlexAxis) {
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    } else if (isFlex || isGrid) {
      patch[stretchProperty] = "auto";
    }
  } else {
    if (isMainFlexAxis) {
      patch.flexGrow = "1";
      patch.flexShrink = "0";
      patch.flexBasis = "0";
      patch[sizeProperty] = "auto";
    } else if (isFlex || isGrid) {
      patch[stretchProperty] = "stretch";
      patch[sizeProperty] = "auto";
    } else {
      patch[sizeProperty] = "100%";
    }
  }

  return patch;
}
