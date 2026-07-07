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
  const tag = normalizedElementTagName(element.tagName);
  if (TEXT_TAGS.has(tag)) return "Text";
  return tag;
}

export function componentNameForElementInfo(
  element: ElementInfo | null | undefined,
): string {
  return element?.componentName?.trim() ?? "";
}

export function elementIsComponentSelection(
  element: ElementInfo | null | undefined,
): boolean {
  return componentNameForElementInfo(element).length > 0;
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

/**
 * Block-level container tags that act the same way frames. Selecting any of
 * these shows the Auto layout section (in an "add" state when not yet flex),
 * mirroring the editor pattern where any frame/container exposes auto-layout controls.
 */
const CONTAINER_TAGS = new Set([
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

/** Leaf tags that never get auto-layout (text, media, vectors, controls). */
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

/**
 * Whether the element should expose the Auto layout section. True for anything
 * already laid out with flexbox, or any block-level container tag that isn't a
 * known leaf/text element. This is what makes a plain frame/container with
 * children show the full Auto layout section the same way does.
 */
export function isContainerElement(element: ElementInfo): boolean {
  if (element.isFlexContainer || element.isGridContainer) return true;
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag) || LEAF_TAGS.has(tag)) return false;
  return CONTAINER_TAGS.has(tag);
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

export function elementHasLayoutChildren(element: ElementInfo): boolean {
  if (typeof element.childElementCount === "number") {
    return element.childElementCount > 0;
  }
  return Boolean(element.htmlContent?.match(/<\s*[a-zA-Z][^>]*>/));
}

export function parentFlexDirection(
  element: ElementInfo,
): AutoLayoutSizingAxis {
  return element.parentLayout?.flexDirection?.includes("column")
    ? "vertical"
    : "horizontal";
}

export function isTextElement(element: ElementInfo): boolean {
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag)) return true;
  // T-tool text primitives are plain `div`s stamped with
  // data-an-primitive="text" (see DesignEditor primitive creation). The
  // bridge forwards that marker as ElementInfo.primitiveKind — prefer it
  // when present since it's exact.
  if (element.primitiveKind) return element.primitiveKind === "text";
  // Canvas-drawn primitives carry a `draft-<tool>-<timestamp>-<random>` node
  // id (see MultiScreenCanvas's draft-id minting). Some selection payloads —
  // notably board/overview layer-panel selections built by parsing the source
  // HTML rather than by the in-iframe bridge — omit `primitiveKind` entirely
  // even though the DOM node carries data-an-primitive="text". The id prefix
  // identifies the tool that drew the element just as exactly for those
  // payloads.
  const nodeId = element.sourceId || element.pendingNodeId || "";
  if (nodeId.startsWith("draft-text-")) return true;
  if (nodeId.startsWith("draft-rect-") || nodeId.startsWith("draft-frame-")) {
    return false;
  }
  // Fallback for payloads with no primitive marker at all: approximate a
  // text node with a content heuristic — a childless div that has its own
  // text content. This intentionally excludes empty frames/shapes (no text)
  // and containers with element children. NOTE: deliberately no
  // isFlexContainer/isGridContainer exclusion here — the T-tool's own text
  // primitives are `display: flex` divs (flex is how their vertical
  // alignment works), so "is a flex container" does NOT imply "not text" for
  // a leaf node. Excluding flex containers made the Typography section
  // vanish for exactly those text nodes whenever the payload lacked
  // primitiveKind (B5-12: text nested in a rectangle via nest-on-drop).
  if (
    tag === "div" &&
    (element.childElementCount ?? 0) === 0 &&
    Boolean(element.textContent?.trim())
  ) {
    return true;
  }
  return false;
}

/**
 * Per-axis sizing availability following the design editor's contextual rules:
 *   - Fixed: always.
 *   - Hug contents: only CONTAINERS (flex/container frames) and TEXT can hug
 *     their content. Leaves like img/svg/input cannot.
 *   - Fill container: only when the element is a CHILD of a flex/grid (auto
 *     layout) parent, OR a block-flow child (which fills via width:100%).
 * Hug applies to width and height independently; the same set is offered on
 * both axes here and the per-axis CSS in `commitElementSizing` resolves the
 * exact behavior (main-axis grow vs cross-axis stretch).
 */
export function availableSizingForElement(
  element: ElementInfo,
): Partial<Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>> {
  const canHug = isContainerElement(element) || isTextElement(element);
  const isFlexChildEl = isParentFlex(element) || isParentGrid(element);
  // Block-flow children can still "fill" via width:100% on the horizontal axis.
  const isBlockChild = Boolean(element.parentDisplay) && !isFlexChildEl;

  const buildAxis = (axis: AutoLayoutSizingAxis): AutoLayoutSizing[] => {
    const options: AutoLayoutSizing[] = ["fixed"];
    if (canHug) options.push("hug");
    // Fill: flex/grid child on either axis; block child only fills width.
    if (isFlexChildEl || (isBlockChild && axis === "horizontal")) {
      options.push("fill");
    }
    return options;
  };

  return {
    horizontal: buildAxis("horizontal"),
    vertical: buildAxis("vertical"),
  };
}

/** Read the currently-set min/max constraints (px) for a sizing axis. */
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

/**
 * Parse a min/max CSS length into a px number, or null when unset. Browser
 * computed values are "0px"/"none" for the defaults — both read as "not set"
 * so we don't surface a constraint sub-row the user never added.
 */
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

/** Commit a single min/max constraint (px) or clear it when value is null.
 * `meta` forwards the originating ScrubInput's gesture metadata (phase
 * preview/commit) so constraint scrubs ride the host's live fast path per
 * tick and only persist on release — same threading as padding/gap. */
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
    // Clearing: min → 0 (CSS initial), max → none (CSS initial).
    onStyleChange(property, kind === "min" ? "0px" : "none", meta);
    return;
  }
  onStyleChange(property, `${Math.max(0, Math.round(value))}px`, meta);
}

export function inferElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): AutoLayoutSizing {
  const styles = element.computedStyles;
  const size = axis === "horizontal" ? styles.width : styles.height;
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const isCrossFlexAxis = isFlex && parentDirection !== axis;
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

/**
 * Return the element's geometric dimension on the given axis in CSS pixels.
 *
 * `getComputedStyle().width/height` always resolves to a computed px value
 * (even for `width: auto` the browser returns e.g. "200px"). For rotated
 * elements this is the pre-rotation CSS box size — what Figma shows in the
 * inspector — while `getBoundingClientRect().width/height` would be the
 * axis-aligned bounding box which is inflated by the rotation.
 *
 * Falls back to the bounding-rect dimension only when the computed style is
 * missing or unparseable (e.g. the bridge hasn't populated it yet).
 */
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
  const isHorizontal = axis === "horizontal";
  const sizeProperty = isHorizontal ? "width" : "height";
  // Use CSS computed dimension (pre-rotation box size) as the seed for "fixed"
  // sizing so a rotated element is locked to its actual CSS width/height rather
  // than the inflated axis-aligned bounding rect.
  const resolvedSize = Math.max(1, Math.round(cssElementSize(element, axis)));
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isGrid = isParentGrid(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const patch: Record<string, string> = {};

  if (sizing === "fixed") {
    // Fixed → explicit px dimension. Reset any grow/stretch on the flex
    // main-axis so the pixel value sticks.
    patch[sizeProperty] = `${resolvedSize}px`;
    if (isMainFlexAxis) {
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    }
  } else if (sizing === "hug") {
    // Hug contents → shrink to fit children/content.
    patch[sizeProperty] = "fit-content";
    if (isMainFlexAxis) {
      // A flex container hugging on its main axis uses flex-basis:auto + no
      // stretch (spec: "flex-basis: auto + no stretch").
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    }
  } else {
    // Fill container.
    if (isMainFlexAxis) {
      // Parent main axis → grow into available space: flex: 1 0 0.
      patch.flexGrow = "1";
      patch.flexShrink = "0";
      patch.flexBasis = "0";
      // Clear any explicit dimension so flex-basis governs.
      patch[sizeProperty] = "auto";
    } else if (isFlex) {
      // Parent cross axis → stretch to the parent's cross size.
      patch.alignSelf = "stretch";
      patch[sizeProperty] = "auto";
    } else if (isGrid) {
      patch[isHorizontal ? "justifySelf" : "alignSelf"] = "stretch";
      patch[sizeProperty] = "auto";
    } else {
      // Child of a non-flex (block) parent → fill width with 100%.
      patch[sizeProperty] = "100%";
    }
  }

  commitStylePatch(patch, onStyleChange, onStylesChange);
}
