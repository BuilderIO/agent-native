import {
  availableSizing,
  canHugContent as layoutCanHugContent,
  CONTAINER_TAGS,
  isOutOfFlow,
  LEAF_TAGS,
  layoutPatchesById,
  parentLayoutKind,
  parentMainAxis,
  readLayoutModel,
  readNodeSizing,
  TEXT_TAGS,
  writeLayoutChange,
  type LayoutChildrenInput,
  type LayoutModel,
  type LayoutNodeInput,
  type LayoutParentInput,
  type LayoutStylePatch,
} from "@shared/layout-model";

import { trace } from "../design-trace";
import {
  type AlignmentMatrixValue,
  type AutoLayoutMatrixValue,
  type AutoLayoutSizing,
  type AutoLayoutSizingAxis,
} from "../inspector";
import type { ElementInfo } from "../types";
import { normalizedElementTagName } from "./code-inspect-helpers";
import { commitStylePatch } from "./field-primitives";
import { splitCssLayers } from "./fill-gradient-helpers";
import { colorHasVisibleAlpha } from "./position-helpers";
import type {
  ApplyLayoutFlowHandler,
  StyleChangeHandler,
  StyleChangeMeta,
  StylesChangeHandler,
} from "./style-change-types";

export { TEXT_TAGS };

const PRIMITIVE_TITLES: Readonly<Record<string, string>> = {
  rect: "Rectangle",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  circle: "Ellipse",
  oval: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  polygon: "Polygon",
  star: "Star",
  image: "Image",
};

export function inspectorObjectTitle(element: ElementInfo): string {
  const componentName = componentNameForElementInfo(element);
  if (componentName) return componentName;
  if (element.isGroup) return "Group";
  const tag = normalizedElementTagName(element.tagName);
  if (isTextElement(element)) return "Text";
  const primitiveTitle =
    PRIMITIVE_TITLES[element.primitiveKind?.trim().toLowerCase() ?? ""];
  if (primitiveTitle) return primitiveTitle;
  if (tag === "img" || tag === "picture") return "Image";
  if (tag === "video") return "Video";
  if (tag === "svg" || isVectorShapeElement(element)) return "Vector";
  return layoutModelForElement(element).frame.mode === "none"
    ? "Frame"
    : "Auto layout frame";
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
  if (primitiveKind === "frame") return true;
  if (primitiveKind === "rectangle" || primitiveKind === "rect") {
    return (element.childElementCount ?? 0) > 0;
  }
  if (primitiveKind) return false;
  if (element.isFlexContainer || element.isGridContainer) return true;
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag) || LEAF_TAGS.has(tag)) return false;
  return CONTAINER_TAGS.has(tag);
}

function elementNodeId(element: ElementInfo): string | null {
  return element.sourceId || element.pendingNodeId || null;
}

function elementDisplay(element: ElementInfo): string | undefined {
  const display = (
    element.computedStyles.display ||
    element.inlineStyles?.display ||
    ""
  ).toLowerCase();
  if (element.isGridContainer && !display.includes("grid")) return "grid";
  if (element.isFlexContainer && !display.includes("flex")) return "flex";
  return display || undefined;
}

function layoutNodeForElement(element: ElementInfo): LayoutNodeInput {
  const declared = (property: "width" | "height") =>
    element.authoredSizeStyles?.[property]?.trim() ||
    element.inlineStyles?.[property]?.trim() ||
    element.computedStyles[property]?.trim() ||
    undefined;
  return {
    id: elementNodeId(element),
    tagName: element.tagName,
    primitiveKind: element.primitiveKind,
    styles: {
      ...element.computedStyles,
      display: elementDisplay(element),
      position:
        element.computedStyles.position || element.inlineStyles?.position,
    },
    declaredSize: { width: declared("width"), height: declared("height") },
    classes: element.classes,
    resolvedSize: {
      horizontal: measuredElementSize(element, "horizontal"),
      vertical: measuredElementSize(element, "vertical"),
    },
    rect: element.boundingRect,
  };
}

function layoutParentForElement(
  element: ElementInfo,
): LayoutParentInput | null {
  let display = (
    element.parentDisplay ||
    element.parentLayout?.display ||
    ""
  ).toLowerCase();
  if (element.isFlexChild && !display.includes("flex")) display = "flex";
  if (!display) return null;
  return {
    display,
    flexDirection: element.parentLayout?.flexDirection,
    alignItems: element.parentLayout?.alignItems,
  };
}

function layoutChildrenForElement(element: ElementInfo): LayoutChildrenInput {
  const layouts = element.childLayouts;
  if (!layouts) {
    return {
      status: "unreadable",
      childCount: element.childElementCount ?? null,
      hasText:
        element.textContent === undefined
          ? null
          : Boolean(element.textContent.trim()),
    };
  }
  return {
    status: "read",
    looseText: layouts.looseText,
    complete: layouts.complete,
    children: layouts.children.map((child) => ({
      id: child.nodeId ?? null,
      tagName: child.tagName,
      styles: {
        position: child.position,
        display: child.display,
        flexGrow: child.flexGrow,
        alignSelf: child.alignSelf,
        justifySelf: child.justifySelf,
        float: child.float,
      },
      declaredSize: { width: child.width, height: child.height },
      rect: child.rect,
    })),
  };
}

export function layoutModelForElement(element: ElementInfo): LayoutModel {
  return readLayoutModel({
    node: layoutNodeForElement(element),
    parent: layoutParentForElement(element),
    children: layoutChildrenForElement(element),
  });
}

/** Margin moves only a layer in flow; a screen root or a placed layer ignores it. */
export function marginApplies(element: ElementInfo): boolean {
  const tag = normalizedElementTagName(element.tagName);
  if (tag === "body" || tag === "html") return false;
  return !isOutOfFlow(layoutNodeForElement(element));
}

export function canHugContent(element: ElementInfo): boolean {
  return layoutCanHugContent(layoutModelForElement(element));
}

export function isParentFlex(element: ElementInfo): boolean {
  return parentLayoutKind(layoutParentForElement(element)) === "flex";
}

export function isParentGrid(element: ElementInfo): boolean {
  return parentLayoutKind(layoutParentForElement(element)) === "grid";
}

export function parentFlexDirection(
  element: ElementInfo,
): AutoLayoutSizingAxis | null {
  return parentMainAxis(layoutParentForElement(element));
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

/** Line and arrow layers: a stroked segment with no fill or corners. */
export function isLineElement(element: ElementInfo): boolean {
  const kind = element.primitiveKind?.trim().toLowerCase();
  return kind === "line" || kind === "arrow";
}

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

const BORDER_SIDES = ["Top", "Right", "Bottom", "Left"];

function hasVisibleEdge(
  width: string | undefined,
  style: string | undefined,
  color: string | undefined,
): boolean {
  return (
    (Number.parseFloat(width ?? "") || 0) > 0 &&
    Boolean(style) &&
    style !== "none" &&
    style !== "hidden" &&
    colorHasVisibleAlpha(color)
  );
}

function isSetEffect(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed) && trimmed !== "none";
}

// Border radius has no visible effect on text without a painted box, so keep
// the control available when its background, border, or effects create one.
export function isBoxlessText(element: ElementInfo): boolean {
  if (!isTextElement(element)) return false;
  const styles = element.computedStyles;
  const clips = splitCssLayers(styles.backgroundClip || "");
  const hasBoxBackgroundImage = splitCssLayers(
    styles.backgroundImage || "",
  ).some(
    (layer, index) =>
      isSetEffect(layer) &&
      clips[index % Math.max(clips.length, 1)]?.trim().toLowerCase() !== "text",
  );
  const hasBorder = BORDER_SIDES.some((side) =>
    hasVisibleEdge(
      styles["border" + side + "Width"] ?? styles.borderWidth,
      styles["border" + side + "Style"] ?? styles.borderStyle,
      styles["border" + side + "Color"] ?? styles.borderColor,
    ),
  );
  return !(
    colorHasVisibleAlpha(styles.backgroundColor) ||
    hasBoxBackgroundImage ||
    hasBorder ||
    hasVisibleEdge(
      styles.outlineWidth,
      styles.outlineStyle,
      styles.outlineColor,
    ) ||
    isSetEffect(styles.boxShadow) ||
    isSetEffect(styles.backdropFilter)
  );
}

export function availableSizingForElement(
  element: ElementInfo,
): Partial<Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>> {
  return availableSizing(layoutModelForElement(element));
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
  return readNodeSizing(
    layoutNodeForElement(element),
    layoutParentForElement(element),
    axis,
  );
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

export function commitElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
  sizing: AutoLayoutSizing,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
  onApplyLayoutFlow?: ApplyLayoutFlowHandler,
) {
  commitElementSizingForAxes(
    element,
    { [axis]: sizing },
    onStyleChange,
    onStylesChange,
    onApplyLayoutFlow,
  );
}

type AxisSizings = Partial<Record<AutoLayoutSizingAxis, AutoLayoutSizing>>;
type AxisSizes = Partial<Record<AutoLayoutSizingAxis, number>>;

/**
 * Commits a sizing change as the layout model writes it. Hug on an axis the
 * children fill freezes them there too, and the frame and its children land
 * as one edit; a change that only touches the layer keeps the ordinary style
 * path, so previews, breakpoints and interaction states still apply.
 */
export function commitElementSizingForAxes(
  element: ElementInfo,
  sizing: AxisSizings,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
  onApplyLayoutFlow?: ApplyLayoutFlowHandler,
  px?: AxisSizes,
  meta?: StyleChangeMeta,
) {
  const write = writeLayoutChange(layoutModelForElement(element), {
    kind: "sizing",
    sizing,
    ...(px ? { px } : {}),
  });
  if (write.status !== "ok") {
    trace("structure", "sizing-refused", {
      reason: write.reason,
      nodeIds: write.nodeIds,
    });
    return;
  }
  if (write.children.size === 0) {
    commitStylePatch(
      definedStyles(write.frame),
      onStyleChange,
      onStylesChange,
      meta,
    );
    return;
  }
  const frameId = elementNodeId(element);
  const outcome =
    frameId && onApplyLayoutFlow
      ? onApplyLayoutFlow(frameId, {}, layoutPatchesById(write, frameId))
      : "unsupported";
  if (outcome !== "applied") {
    trace("structure", "sizing-refused", {
      reason: "children-not-writable",
      outcome,
      nodeId: frameId,
    });
  }
}

export function commitFixedElementSizes(
  element: ElementInfo,
  sizes: AxisSizes,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
  meta?: StyleChangeMeta,
) {
  const sizing: AxisSizings = {};
  for (const axis of ["horizontal", "vertical"] as const) {
    if (sizes[axis] !== undefined) sizing[axis] = "fixed";
  }
  commitElementSizingForAxes(
    element,
    sizing,
    onStyleChange,
    onStylesChange,
    undefined,
    sizes,
    meta,
  );
}

function definedStyles(patch: LayoutStylePatch): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const [property, value] of Object.entries(patch)) {
    if (value !== null) styles[property] = value;
  }
  return styles;
}
