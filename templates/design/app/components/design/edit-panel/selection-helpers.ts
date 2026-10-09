import { parseCssColorExtended, rgbaToHex } from "@shared/color-utils";

import type { ElementInfo } from "../types";
import { isVectorShapeElement } from "./element-classification";

const vectorShapeSelections = new WeakSet<ElementInfo>();

export const MIXED_VALUE = "Mixed";

export function isMixedValue(value: string | undefined): boolean {
  return value === MIXED_VALUE;
}

export function isVectorShapeSelection(element: ElementInfo): boolean {
  return vectorShapeSelections.has(element) || isVectorShapeElement(element);
}

export function sameOrMixed(values: string[]): string {
  if (values.length === 0) return "";
  const first = values[0] ?? "";
  return values.every((value) => value === first) ? first : MIXED_VALUE;
}

const COLOR_STYLE_PROPERTIES = new Set([
  "backgroundcolor",
  "bordercolor",
  "color",
  "fill",
  "floodcolor",
  "lightingcolor",
  "outlinecolor",
  "stopcolor",
  "stroke",
  "textdecorationcolor",
]);

function sameOrMixedColorStyle(property: string, values: string[]): string {
  const propertyKey = property.replace(/-/g, "").toLowerCase();
  if (!COLOR_STYLE_PROPERTIES.has(propertyKey) || values.length === 0) {
    return sameOrMixed(values);
  }
  const keys = values.map((value) => {
    const parsed = parseCssColorExtended(value.trim());
    return parsed ? rgbaToHex(parsed, true).toUpperCase() : undefined;
  });
  const firstKey = keys[0];
  return firstKey && keys.every((key) => key === firstKey)
    ? (values[0] ?? "")
    : sameOrMixed(values);
}

function sameStructure<T>(a: T | undefined, b: T | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function sameValueOrUndefined<T>(values: T[], candidate: T): T | undefined {
  return values.every((value) => sameStructure(value, candidate))
    ? candidate
    : undefined;
}

export function mixedElementFromSelection(
  elements: ElementInfo[],
): ElementInfo | null {
  const base = elements[elements.length - 1];
  if (!base) return null;
  const styleKeys = new Set<string>();
  elements.forEach((element) => {
    Object.keys(element.computedStyles).forEach((key) => styleKeys.add(key));
  });
  const computedStyles = Object.fromEntries(
    Array.from(styleKeys).map((key) => [
      key,
      sameOrMixedColorStyle(
        key,
        elements.map((element) => element.computedStyles[key] ?? ""),
      ),
    ]),
  );
  const inlineStyleKeys = new Set<string>();
  elements.forEach((element) => {
    Object.keys(element.inlineStyles ?? {}).forEach((key) =>
      inlineStyleKeys.add(key),
    );
  });
  const inlineStyles =
    inlineStyleKeys.size > 0
      ? Object.fromEntries(
          Array.from(inlineStyleKeys).map((key) => [
            key,
            sameOrMixedColorStyle(
              key,
              elements.map((element) => element.inlineStyles?.[key] ?? ""),
            ),
          ]),
        )
      : undefined;
  const authoredSizeStyles: ElementInfo["authoredSizeStyles"] = {};
  for (const property of ["width", "height"] as const) {
    const value = sameValueOrUndefined(
      elements.map((element) => element.authoredSizeStyles?.[property]),
      base.authoredSizeStyles?.[property],
    );
    if (value !== undefined) authoredSizeStyles[property] = value;
  }
  const minX = Math.min(...elements.map((element) => element.boundingRect.x));
  const minY = Math.min(...elements.map((element) => element.boundingRect.y));
  const maxX = Math.max(
    ...elements.map(
      (element) => element.boundingRect.x + element.boundingRect.width,
    ),
  );
  const maxY = Math.max(
    ...elements.map(
      (element) => element.boundingRect.y + element.boundingRect.height,
    ),
  );
  const firstComponentName = elements[0]?.componentName;
  const componentName =
    firstComponentName &&
    elements.every((element) => element.componentName === firstComponentName)
      ? firstComponentName
      : undefined;

  const merged: ElementInfo = {
    ...base,
    tagName: sameOrMixed(elements.map((element) => element.tagName)),
    id: undefined,
    sourceId: undefined,
    pendingNodeId: undefined,
    componentName,
    selector: base.selector,
    classes: [],
    computedStyles,
    inlineStyles,
    authoredSizeStyles:
      Object.keys(authoredSizeStyles).length > 0
        ? authoredSizeStyles
        : undefined,
    primitiveKind: sameOrMixed(
      elements.map((element) => element.primitiveKind ?? ""),
    ),
    boundingRect: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    textContent: sameOrMixed(
      elements.map((element) => element.textContent ?? ""),
    ),
    htmlContent: undefined,
    childElementCount: undefined,
    isFlexChild: elements.every((element) => element.isFlexChild),
    isFlexContainer: elements.every((element) => element.isFlexContainer),
    isGridContainer: elements.every((element) => element.isGridContainer),
    parentDisplay: sameValueOrUndefined(
      elements.map((element) => element.parentDisplay),
      base.parentDisplay,
    ),
    parentAutoLayout: sameValueOrUndefined(
      elements.map((element) => element.parentAutoLayout),
      base.parentAutoLayout,
    ),
    parentBoundingRect: sameValueOrUndefined(
      elements.map((element) => element.parentBoundingRect),
      base.parentBoundingRect,
    ),
    positionReferenceRect: sameValueOrUndefined(
      elements.map((element) => element.positionReferenceRect),
      base.positionReferenceRect,
    ),
    positionContainingBlockOrigin: sameValueOrUndefined(
      elements.map((element) => element.positionContainingBlockOrigin),
      base.positionContainingBlockOrigin,
    ),
    positionContainingBlockTransform: sameValueOrUndefined(
      elements.map((element) => element.positionContainingBlockTransform),
      base.positionContainingBlockTransform,
    ),
    parentLayout: sameValueOrUndefined(
      elements.map((element) => element.parentLayout),
      base.parentLayout,
    ),
  };
  if (elements.every(isVectorShapeElement)) {
    vectorShapeSelections.add(merged);
  }
  return merged;
}
