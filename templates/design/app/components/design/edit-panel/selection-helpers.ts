import type { ElementInfo } from "../types";

export const MIXED_VALUE = "Mixed";

export function isMixedValue(value: string | undefined): boolean {
  return value === MIXED_VALUE;
}

export function sameOrMixed(values: string[]): string {
  if (values.length === 0) return "";
  const first = values[0] ?? "";
  return values.every((value) => value === first) ? first : MIXED_VALUE;
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
      sameOrMixed(elements.map((element) => element.computedStyles[key] ?? "")),
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
            sameOrMixed(
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

  return {
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
    parentLayout: sameValueOrUndefined(
      elements.map((element) => element.parentLayout),
      base.parentLayout,
    ),
  };
}
