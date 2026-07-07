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
  // Mix inlineStyles the same way as computedStyles so authoredStyleValue()
  // sees a proper Mixed sentinel across a multi-selection instead of
  // silently inheriting the last-selected element's raw inline value
  // (spreading ...base alone would leak that stale single-element value).
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
  return {
    ...base,
    tagName: sameOrMixed(elements.map((element) => element.tagName)),
    id: undefined,
    sourceId: undefined,
    selector: base.selector,
    classes: [],
    computedStyles,
    inlineStyles,
    // Mix like tagName above — otherwise isTextElement() would trust
    // base.primitiveKind alone and misclassify a mixed text+shape selection.
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
  };
}
