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

/**
 * Structural equality via JSON — good enough for the small, JSON-serializable
 * parent-layout snapshots (`parentDisplay`/`parentAutoLayout`/`parentLayout`)
 * this is used for below; not intended as a general deep-equal.
 */
function sameStructure<T>(a: T | undefined, b: T | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Returns `value` when every element in `values` is structurally identical
 * to it, else `undefined`. Used for object/optional-string fields where a
 * `MIXED_VALUE` string sentinel doesn't apply (they aren't rendered as text)
 * but silently leaking one arbitrary element's value across a selection with
 * genuinely different values would still be wrong — see `parentDisplay` /
 * `parentAutoLayout` / `parentLayout` below.
 */
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
  // Only report a shared component name when every selected element is the
  // *same* named component instance (mirrors Figma: a multi-instance
  // same-component selection still reads as a component). Anything else —
  // including a component mixed with a plain element — collapses to
  // undefined rather than a "Mixed" sentinel string: elementIsComponentSelection()
  // in element-classification.ts only checks `.length > 0`, so leaking
  // MIXED_VALUE ("Mixed", a non-empty string) through here would make a
  // component+non-component multi-selection misreport as "is a component"
  // (wrong purple icon/tint in SelectionHeader) instead of falling back to
  // undefined the way an actual mismatch should.
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
    // A merged/synthetic multi-selection has no single stable pending id
    // either — clear it like id/sourceId above instead of leaking whichever
    // element happened to be last, which isTextElement()'s nodeId-prefix
    // fallback (for older payloads without primitiveKind) would otherwise
    // read as if it belonged to the whole selection.
    pendingNodeId: undefined,
    componentName,
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
    // Same treatment as isFlexContainer above: isContainerElement() checks
    // isFlexContainer || isGridContainer, so leaving isGridContainer to leak
    // from `base` alone (via the ...base spread) let a mixed grid+non-grid
    // selection misclassify as a uniform container based on selection order.
    isGridContainer: elements.every((element) => element.isGridContainer),
    // isParentFlex/isParentGrid/parentFlexDirection (element-classification.ts)
    // read these three fields to decide whether LayoutContextProperties shows
    // FlexChildControls/GridChildControls at all, and with which direction.
    // Left unhandled, `...base` above leaked whichever element was selected
    // LAST: multi-selecting elements from two different parents (e.g. one
    // flex child + one plain block child, or two flex children with
    // different flexDirection) rendered/hid those controls based on an
    // arbitrary member of the selection, and any align-self/flex-grow edit
    // made through them would apply to every selected element regardless of
    // whether its own parent actually supports that property. Falling back
    // to undefined when the selection's parents disagree matches the
    // isFlexContainer/isGridContainer treatment above: hide the
    // parent-relative controls rather than guess from one element.
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
