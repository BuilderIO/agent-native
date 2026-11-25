/**
 * Painted-style capture, shared by the gallery's parity runner and the
 * row style check. Values are normalized so that layers and borders that
 * paint nothing compare equal however a stylesheet spells them.
 */

export const PAINTED_PROPERTIES = [
  "display",
  "position",
  "align-items",
  "justify-content",
  "gap",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "background-color",
  "background-image",
  "color",
  "box-shadow",
  "font-family",
  "font-size",
  "line-height",
  "font-weight",
  "letter-spacing",
  "text-align",
  "white-space",
  "user-select",
  "cursor",
  "opacity",
  "pointer-events",
  "outline-style",
  "outline-width",
  "outline-color",
  "outline-offset",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "scale",
  "transform",
  "translate",
  "text-decoration-line",
  "text-underline-offset",
  "overflow-x",
  "overflow-y",
  "z-index",
  "backdrop-filter",
] as const;

export const ICON_PROPERTIES = [
  "width",
  "height",
  "flex-shrink",
  "pointer-events",
];

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

function normalizeShadow(value: string): string {
  const layers = value
    .split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .filter(
      (layer) =>
        layer !== "none" &&
        !/^(?:rgba?\([^)]*\)|oklab\([^)]*\)|\S+) 0px 0px 0px 0px(?: inset)?$/.test(
          layer,
        ),
    );
  return layers.length > 0 ? layers.join(", ") : "none";
}

function paintedValue(style: CSSStyleDeclaration, property: string): string {
  const value = style.getPropertyValue(property);
  if (property === "box-shadow") return normalizeShadow(value);
  if (
    (property === "outline-width" || property === "outline-color") &&
    style.getPropertyValue("outline-style") === "none"
  ) {
    return "(no outline)";
  }
  const side = BORDER_SIDES.find((name) => property === `border-${name}-color`);
  if (side && style.getPropertyValue(`border-${side}-width`) === "0px") {
    return "(no border)";
  }
  return value;
}

export type CapturedStyles = Record<string, string>;

/** Every painted property of an element and its first icon. */
export function captureStyles(element: Element): CapturedStyles {
  const style = getComputedStyle(element);
  const captured: CapturedStyles = {};
  for (const property of PAINTED_PROPERTIES) {
    captured[property] = paintedValue(style, property);
  }
  const icon = element.querySelector("svg");
  if (icon) {
    const iconStyle = getComputedStyle(icon);
    for (const property of ICON_PROPERTIES) {
      captured[`svg ${property}`] = iconStyle.getPropertyValue(property);
    }
  }
  return captured;
}

export interface StyleDifference {
  case: string;
  property: string;
  part: string;
  legacy: string;
}

/** Every property whose painted value differs between two captures. */
export function diffStyles(
  key: string,
  part: CapturedStyles,
  legacy: CapturedStyles,
): StyleDifference[] {
  const differences: StyleDifference[] = [];
  for (const property of new Set([
    ...Object.keys(part),
    ...Object.keys(legacy),
  ])) {
    if (part[property] !== legacy[property]) {
      differences.push({
        case: key,
        property,
        part: part[property] ?? "(missing)",
        legacy: legacy[property] ?? "(missing)",
      });
    }
  }
  return differences;
}

/**
 * Where a row lives in a source rendering that has no `data-rid`, such as a
 * screen drawn before it had a model. One selector per row id.
 */
export interface RowLocator {
  rowId: string;
  selector: string;
}

export interface LocatorReport {
  tagged: string[];
  /** Selectors that matched nothing. */
  missing: string[];
  /** Selectors that matched more than one element; none of these is tagged. */
  ambiguous: string[];
}

/**
 * Writes `data-rid` onto the elements the locators find, so a source
 * rendering can be captured with the same keys as the part sets. A selector that
 * matches nothing or several elements is reported, never guessed.
 */
export function applyRowLocators(
  root: ParentNode,
  locators: readonly RowLocator[],
): LocatorReport {
  const report: LocatorReport = { tagged: [], missing: [], ambiguous: [] };
  for (const { rowId, selector } of locators) {
    const matches = root.querySelectorAll(selector);
    if (matches.length === 0) report.missing.push(rowId);
    else if (matches.length > 1) report.ambiguous.push(rowId);
    else {
      matches[0]?.setAttribute("data-rid", rowId);
      report.tagged.push(rowId);
    }
  }
  return report;
}

/** Painted styles of every row under `root`, keyed by row id. */
export function captureRowStyles(
  root: ParentNode,
): Record<string, CapturedStyles> {
  const captured: Record<string, CapturedStyles> = {};
  for (const element of root.querySelectorAll("[data-rid]")) {
    const rowId = element.getAttribute("data-rid");
    if (!rowId) continue;
    if (rowId in captured) {
      throw new Error(`Row ${rowId} is rendered twice`);
    }
    captured[rowId] = captureStyles(element);
  }
  return captured;
}

export interface RowStyleReport {
  compared: number;
  /** Rows the source has and the target does not render. */
  missing: string[];
  differences: Array<{
    rowId: string;
    property: string;
    source: string;
    target: string;
  }>;
}

/**
 * The row style check: a target part set's painted styles against a source
 * rendering of the same model, row by row. `properties` narrows the
 * comparison to what the target is meant to carry over.
 */
export function compareRowStyles(
  source: Readonly<Record<string, CapturedStyles>>,
  target: Readonly<Partial<Record<string, CapturedStyles>>>,
  properties?: readonly string[],
): RowStyleReport {
  const report: RowStyleReport = { compared: 0, missing: [], differences: [] };
  for (const [rowId, sourceStyles] of Object.entries(source)) {
    const targetStyles = target[rowId];
    if (!targetStyles) {
      report.missing.push(rowId);
      continue;
    }
    report.compared++;
    for (const property of properties ?? Object.keys(sourceStyles)) {
      const sourceValue = sourceStyles[property] ?? "(missing)";
      const targetValue = targetStyles[property] ?? "(missing)";
      if (sourceValue !== targetValue) {
        report.differences.push({
          rowId,
          property,
          source: sourceValue,
          target: targetValue,
        });
      }
    }
  }
  return report;
}
