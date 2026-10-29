/**
 * The one reading of a frame's layout and the one writer of changes to it.
 *
 * Every surface that decides auto layout, Hug, Fill, Fixed or freeform goes
 * through here: Design's inspector, code layer and editor commands, and Slides'
 * auto layout groups. Each
 * used to re-derive "is this frame auto layout, is this child in flow, what is
 * its sizing, what size does it render at" on its own, and the same bug kept
 * shipping from whichever copy disagreed. Flexbox stays the CSS this writes;
 * grid only appears for the Grid layout mode.
 *
 * Inputs are plain values so the server and the client can both build them.
 * An input the caller could not read is a distinct state (`unreadable`), never
 * an empty list or a default size.
 */

const GEOMETRY_PX_PROPERTY =
  /^(?:left|top|right|bottom|inset(?:-(?:inline|block)(?:-(?:start|end))?)?|(?:min-|max-)?(?:width|height)|translate)$/;
const PX_LENGTH_TOKEN = /^(?:-?(?:\d+\.?\d*|\.\d+)px|0)$/i;

/**
 * Lands a plain px value of a layer geometry property on whole pixels.
 * Strokes, type, effects and non-px lengths keep their authored precision.
 */
export function roundGeometryStylePx(property: string, value: string): string {
  const cssProperty = property
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .toLowerCase();
  if (!GEOMETRY_PX_PROPERTY.test(cssProperty)) return value;
  const tokens = value.trim().split(/\s+/);
  if (!tokens.every((t) => PX_LENGTH_TOKEN.test(t))) return value;
  const fractional = (token: string) => {
    const parsed = Number.parseFloat(token);
    return token !== "0" && Math.round(parsed) !== parsed;
  };
  if (!tokens.some(fractional)) return value;
  return tokens
    .map((token) =>
      token === "0" ? token : `${Math.round(Number.parseFloat(token)) || 0}px`,
    )
    .join(" ");
}

export type LayoutAxis = "horizontal" | "vertical";
export type LayoutSizing = "fixed" | "hug" | "fill";
export type FrameLayoutMode = "none" | "horizontal" | "vertical" | "grid";
export type LayoutAlign = "start" | "center" | "end" | "stretch" | "baseline";
export type LayoutAxisConstraint = "start" | "end" | "start-end";

export const LAYOUT_AXES = ["horizontal", "vertical"] as const;

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** camelCase CSS properties; undefined means nothing sets the property. */
export type LayoutStyles = Readonly<Record<string, string | undefined>>;

export interface LayoutNodeInput {
  /** The node id patches are keyed by; null when the node has none. */
  id: string | null;
  tagName?: string;
  primitiveKind?: string;
  /** Styles as the node is laid out: display, position, flex, alignment. */
  styles: LayoutStyles;
  /**
   * The width/height an author declared, before layout resolves it. This is
   * what decides Fixed, Hug or Fill; a resolved px only measures it.
   */
  declaredSize?: Readonly<Partial<Record<"width" | "height", string>>>;
  classes?: readonly string[];
  /** Resolved px per axis; null when layout did not resolve a plain px. */
  resolvedSize?: Readonly<Partial<Record<LayoutAxis, number | null>>>;
  /**
   * Rendered box. A child's is relative to its container's padding box, the
   * origin absolute positioning uses. Null when the node was not measured.
   */
  rect?: LayoutRect | null;
  /** Computed box model; null when the node was not measured. */
  box?: LayoutBoxModel | null;
}

export interface LayoutBoxModel {
  sizing: "border-box" | "content-box";
  /** Padding plus border along each axis, in px. */
  edges: { width: number; height: number };
}

export interface LayoutParentInput {
  display: string;
  flexDirection?: string;
  alignItems?: string;
}

export type LayoutChildrenInput =
  | {
      status: "read";
      children: readonly LayoutNodeInput[];
      looseText: boolean;
      /** False when the reader stopped early; absent children are unknown. */
      complete: boolean;
    }
  | {
      status: "unreadable";
      childCount: number | null;
      hasText: boolean | null;
    };

export interface ChildLayout {
  id: string | null;
  positioning: "auto" | "absolute";
  sizing: Record<LayoutAxis, LayoutSizing>;
  rect: LayoutRect | null;
  /** Which edges an absolute child is pinned to; null for a child in flow. */
  constraints: Record<LayoutAxis, LayoutAxisConstraint> | null;
  node: LayoutNodeInput;
}

export type LayoutChildren =
  | {
      status: "read";
      items: ChildLayout[];
      looseText: boolean;
      complete: boolean;
    }
  | {
      status: "unreadable";
      childCount: number | null;
      hasText: boolean | null;
    };

export interface AxisSizing {
  mode: LayoutSizing;
  /** Rendered px; null when the node was not measured on this axis. */
  px: number | null;
}

export interface FrameLayout {
  mode: FrameLayoutMode;
  wrap: boolean;
  /** Null when the gap is not a plain px length. */
  gap: number | null;
  padding: LayoutInsets;
  alignment: { main: LayoutAlign; cross: LayoutAlign };
  spacing: "packed" | "space-between";
  sizing: Record<LayoutAxis, AxisSizing>;
  clipContent: boolean;
}

export interface LayoutModel {
  node: LayoutNodeInput;
  parent: LayoutParentInput | null;
  frame: FrameLayout;
  children: LayoutChildren;
}

/** A null value removes the declaration. */
export type LayoutStylePatch = Record<string, string | null>;

export type LayoutChange =
  | {
      kind: "sizing";
      sizing: Partial<Record<LayoutAxis, LayoutSizing>>;
      /** Fixed sizes to write; an axis without one keeps its rendered px. */
      px?: Partial<Record<LayoutAxis, number>>;
    }
  | {
      kind: "enable-auto-layout";
      /**
       * The container styles the caller decided. Omitted, they are inferred
       * from where the children render.
       */
      frame?: Readonly<Record<string, string>>;
    }
  | { kind: "disable-auto-layout" }
  | {
      kind: "child-positioning";
      childId: string;
      positioning: "auto" | "absolute";
    };

export type LayoutWrite =
  | {
      status: "ok";
      frame: LayoutStylePatch;
      children: ReadonlyMap<string, LayoutStylePatch>;
      /** Child ids in the flow order the change wants; absent keeps source order. */
      order?: readonly string[];
    }
  | {
      status: "unreadable";
      reason: "children-unreadable" | "unmeasured" | "unknown-child";
      nodeIds: readonly string[];
    };

export const TEXT_TAGS: ReadonlySet<string> = new Set([
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

export const CONTAINER_TAGS: ReadonlySet<string> = new Set([
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

export const LEAF_TAGS: ReadonlySet<string> = new Set([
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

const FRAME_PRIMITIVE_KINDS = new Set(["frame", "rectangle", "rect"]);
const BLOCK_FLOW_DISPLAYS = new Set(["block", "flow-root", "list-item"]);
const BLOCK_LEVEL_DISPLAYS = new Set([
  "block",
  "flow-root",
  "list-item",
  "flex",
  "grid",
]);
const BLOCK_DEFAULT_TAGS = new Set([
  ...Array.from(CONTAINER_TAGS).filter(
    (tag) => !["table", "tbody", "thead", "tr"].includes(tag),
  ),
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
]);
const UTILITY_SIZE_KEYWORDS: Record<string, string> = {
  auto: "auto",
  full: "100%",
  fit: "fit-content",
  max: "max-content",
  min: "min-content",
};
const HUG_SIZES = new Set(["auto", "fit-content", "max-content"]);
const INSET_PROPERTIES = [
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "inset",
];

const MARGIN_PROPERTIES = [
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
];

const lower = (value: string | undefined) => value?.trim().toLowerCase() ?? "";
const sizeProperty = (axis: LayoutAxis) =>
  axis === "horizontal" ? "width" : "height";

function displayOf(node: LayoutNodeInput): string {
  const display = lower(node.styles.display);
  if (display) return display;
  for (const token of node.classes ?? []) {
    if (/^(?:inline-)?(?:flex|grid)$/.test(token)) return token;
  }
  return "";
}

function frameModeOf(node: LayoutNodeInput): FrameLayoutMode {
  const display = displayOf(node);
  if (display.includes("grid")) return "grid";
  if (!display.includes("flex")) return "none";
  const direction =
    lower(node.styles.flexDirection) ||
    ((node.classes ?? []).some((token) => token.startsWith("flex-col"))
      ? "column"
      : "row");
  return direction.startsWith("column") ? "vertical" : "horizontal";
}

export function isOutOfFlow(node: LayoutNodeInput): boolean {
  const position = lower(node.styles.position).replace(/\s*!important$/, "");
  if (position) return position === "absolute" || position === "fixed";
  return (node.classes ?? []).some((token) => {
    const utility = token.slice(token.lastIndexOf(":") + 1).replace(/^!/, "");
    return utility === "absolute" || utility === "fixed";
  });
}

export function parentLayoutKind(
  parent: LayoutParentInput | null,
): "flex" | "grid" | "flow" | null {
  const display = lower(parent?.display);
  if (!display) return null;
  if (display.includes("flex")) return "flex";
  if (display.includes("grid")) return "grid";
  return "flow";
}

/** The flex parent's main axis; null when the parent is not flex. */
export function parentMainAxis(
  parent: LayoutParentInput | null,
): LayoutAxis | null {
  if (parentLayoutKind(parent) !== "flex") return null;
  return lower(parent?.flexDirection).includes("column")
    ? "vertical"
    : "horizontal";
}

function parentFromFrame(node: LayoutNodeInput): LayoutParentInput {
  const mode = frameModeOf(node);
  return {
    display: displayOf(node) || "block",
    flexDirection:
      mode === "vertical" ? "column" : mode === "horizontal" ? "row" : "",
    alignItems: node.styles.alignItems,
  };
}

// The authored value decides the mode. A code-layer refresh drops the resolved
// sizes too, so a size nothing declares reads as auto, or the same layer flips
// from Hug or Fill to Fixed after every edit.
function declaredSizeOf(
  node: LayoutNodeInput,
  axis: LayoutAxis,
): string | undefined {
  const declared = node.declaredSize?.[sizeProperty(axis)]?.trim();
  if (declared) return declared.toLowerCase();
  if (LEAF_TAGS.has(lower(node.tagName))) return undefined;
  const prefix = axis === "horizontal" ? "w-" : "h-";
  let utility: string | undefined;
  for (const token of node.classes ?? []) {
    const base = token.slice(token.lastIndexOf(":") + 1);
    if (!base.startsWith(prefix) && !base.startsWith("size-")) continue;
    if (base !== token) return undefined;
    utility = base.slice(base.indexOf("-") + 1);
  }
  if (utility === undefined) return "auto";
  return UTILITY_SIZE_KEYWORDS[utility] ?? undefined;
}

// Fill comes from the parent's layout as often as from the layer's own size:
// flex-grow on the main axis, stretch on the cross axis, block flow across.
function fillsAxis(
  node: LayoutNodeInput,
  parent: LayoutParentInput | null,
  axis: LayoutAxis,
  size: string | undefined,
): boolean {
  if (isOutOfFlow(node)) return false;
  const styles = node.styles;
  const kind = parentLayoutKind(parent);
  if (kind === "flex") {
    if (parentMainAxis(parent) === axis) {
      return Number.parseFloat(styles.flexGrow || "0") > 0;
    }
    const alignSelf = lower(styles.alignSelf) || "auto";
    if (alignSelf === "stretch") return true;
    if (alignSelf !== "auto" && alignSelf !== "normal") return false;
    const alignItems = lower(parent?.alignItems);
    return (
      size === "auto" && (alignItems === "normal" || alignItems === "stretch")
    );
  }
  if (kind === "grid") {
    const self = axis === "horizontal" ? styles.justifySelf : styles.alignSelf;
    return lower(self) === "stretch";
  }
  if (axis !== "horizontal" || size !== "auto") return false;
  if (!BLOCK_FLOW_DISPLAYS.has(lower(parent?.display))) return false;
  const float = lower(styles.float);
  if (float && float !== "none") return false;
  const display = lower(styles.display);
  if (display) return BLOCK_LEVEL_DISPLAYS.has(display);
  return BLOCK_DEFAULT_TAGS.has(lower(node.tagName));
}

export function readNodeSizing(
  node: LayoutNodeInput,
  parent: LayoutParentInput | null,
  axis: LayoutAxis,
): LayoutSizing {
  const size = declaredSizeOf(node, axis);
  if (size === "100%" || fillsAxis(node, parent, axis, size)) return "fill";
  if (size !== undefined && HUG_SIZES.has(size)) return "hug";
  return "fixed";
}

/** The px a node renders at on an axis, or null when it was not measured. */
export function renderedSize(
  node: LayoutNodeInput,
  axis: LayoutAxis,
): number | null {
  const resolved = node.resolvedSize?.[axis];
  if (typeof resolved === "number" && Number.isFinite(resolved)) {
    return Math.max(0, resolved);
  }
  // A 0x0 rect is the projection's placeholder for a node nobody measured.
  const fromRect = node.rect?.[sizeProperty(axis)];
  return typeof fromRect === "number" &&
    Number.isFinite(fromRect) &&
    fromRect > 0
    ? fromRect
    : null;
}

function pxValue(value: string | undefined): number | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]!);
  if (!Number.isFinite(parsed)) return null;
  return match[2] || parsed === 0 ? parsed : null;
}

function readPadding(styles: LayoutStyles): LayoutInsets {
  const [top = "0", right = top, bottom = top, left = right] = (
    styles.padding ?? ""
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const side = (longhand: string | undefined, shorthand: string) =>
    Math.max(0, pxValue(longhand ?? shorthand) ?? 0);
  return {
    top: side(styles.paddingTop, top),
    right: side(styles.paddingRight, right),
    bottom: side(styles.paddingBottom, bottom),
    left: side(styles.paddingLeft, left),
  };
}

function alignOf(value: string | undefined): LayoutAlign {
  const normalized = lower(value);
  if (normalized === "center") return "center";
  if (["flex-end", "end", "right", "bottom"].includes(normalized)) return "end";
  if (normalized === "stretch") return "stretch";
  if (normalized === "baseline") return "baseline";
  return "start";
}

function constraintOf(
  start: string | undefined,
  end: string | undefined,
  inset: string | undefined,
): LayoutAxisConstraint {
  const set = (value: string | undefined) =>
    Boolean(value?.trim()) && lower(value) !== "auto";
  if (set(inset) || (set(start) && set(end))) return "start-end";
  return set(end) && !set(start) ? "end" : "start";
}

function readChild(
  node: LayoutNodeInput,
  frameAsParent: LayoutParentInput,
): ChildLayout {
  const absolute = isOutOfFlow(node);
  const styles = node.styles;
  return {
    id: node.id,
    positioning: absolute ? "absolute" : "auto",
    sizing: {
      horizontal: readNodeSizing(node, frameAsParent, "horizontal"),
      vertical: readNodeSizing(node, frameAsParent, "vertical"),
    },
    rect: node.rect ?? null,
    constraints: absolute
      ? {
          horizontal: constraintOf(styles.left, styles.right, styles.inset),
          vertical: constraintOf(styles.top, styles.bottom, styles.inset),
        }
      : null,
    node,
  };
}

export function readLayoutModel(input: {
  node: LayoutNodeInput;
  parent: LayoutParentInput | null;
  children: LayoutChildrenInput;
}): LayoutModel {
  const { node, parent, children } = input;
  const styles = node.styles;
  const mode = frameModeOf(node);
  const justify = lower(styles.justifyContent);
  const overflow = lower(styles.overflow);
  const frameAsParent = parentFromFrame(node);
  return {
    node,
    parent,
    frame: {
      mode,
      wrap: lower(styles.flexWrap) === "wrap",
      gap: pxValue(styles.gap),
      padding: readPadding(styles),
      alignment: {
        main: alignOf(justify === "space-between" ? "" : justify),
        cross: alignOf(styles.alignItems),
      },
      spacing: justify === "space-between" ? "space-between" : "packed",
      sizing: {
        horizontal: {
          mode: readNodeSizing(node, parent, "horizontal"),
          px: renderedSize(node, "horizontal"),
        },
        vertical: {
          mode: readNodeSizing(node, parent, "vertical"),
          px: renderedSize(node, "vertical"),
        },
      },
      clipContent: overflow === "hidden" || overflow === "clip",
    },
    children:
      children.status === "read"
        ? {
            status: "read",
            items: children.children.map((child) =>
              readChild(child, frameAsParent),
            ),
            looseText: children.looseText,
            complete: children.complete,
          }
        : children,
  };
}

// Without auto layout, Hug measures only what the container lays out in flow:
// absolutely placed children leave it 0x0 under the layers it still paints.
export function hasInFlowContent(model: LayoutModel): boolean {
  const children = model.children;
  if (children.status === "read") {
    if (children.looseText) return true;
    if (children.items.some((child) => child.positioning === "auto")) {
      return true;
    }
    if (children.complete) return false;
  }
  const childCount =
    children.status === "read" ? children.items.length : children.childCount;
  const hasText = children.status === "read" ? false : children.hasText;
  if (childCount === 0) return hasText === true;
  // The frame tools and Remove auto layout place a frame's children absolutely.
  if (model.node.primitiveKind) return false;
  if (childCount === null && hasText === null) return true;
  return (childCount ?? 0) > 0 || hasText === true;
}

export function canHugContent(model: LayoutModel): boolean {
  const primitiveKind = lower(model.node.primitiveKind);
  const tag = lower(model.node.tagName);
  if (primitiveKind === "text" || TEXT_TAGS.has(tag)) return true;
  if (primitiveKind) {
    if (!FRAME_PRIMITIVE_KINDS.has(primitiveKind)) return false;
  } else if (LEAF_TAGS.has(tag)) {
    return false;
  }
  if (model.frame.mode !== "none") return true;
  return hasInFlowContent(model);
}

// A child whose size along an axis is derived from its parent's size along
// it cannot stay that way while the parent sizes itself from the child:
// percentages resolve against the parent, and main-axis grow shares out the
// parent's free space. Cross-axis stretch is not circular — the line's cross
// size is settled before children stretch to it — so a Hug parent keeps it.
function fillDependsOnParent(
  child: ChildLayout,
  frameAsParent: LayoutParentInput,
  axis: LayoutAxis,
): boolean {
  if (child.positioning === "absolute") return false;
  if (child.sizing[axis] !== "fill") return false;
  if (declaredSizeOf(child.node, axis) === "100%") return true;
  return parentMainAxis(frameAsParent) === axis;
}

function circularFillChildren(
  model: LayoutModel,
  axis: LayoutAxis,
): ChildLayout[] {
  if (model.children.status !== "read") return [];
  const frameAsParent = parentFromFrame(model.node);
  return model.children.items.filter((child) =>
    fillDependsOnParent(child, frameAsParent, axis),
  );
}

// Hug has to freeze every child that fills the axis it hugs. A list the
// reader cut short, or children that could not be read at all, may hide one.
function childListComplete(model: LayoutModel): boolean {
  if (model.children.status === "read") return model.children.complete;
  return model.children.childCount === 0;
}

export function availableSizing(
  model: LayoutModel,
): Record<LayoutAxis, LayoutSizing[]> {
  const canHug = canHugContent(model);
  const kind = parentLayoutKind(model.parent);
  const canFill = !isOutOfFlow(model.node);
  const build = (axis: LayoutAxis): LayoutSizing[] => {
    const options: LayoutSizing[] = ["fixed"];
    // Choosing Hug freezes every child that fills the axis at its rendered
    // size, so Hug is only offered while each of them can be frozen.
    if (
      canHug &&
      childListComplete(model) &&
      circularFillChildren(model, axis).every(
        (child) => child.id !== null && renderedSize(child.node, axis) !== null,
      )
    ) {
      options.push("hug");
    }
    if (
      canFill &&
      (kind === "flex" ||
        kind === "grid" ||
        (kind === "flow" && axis === "horizontal"))
    ) {
      options.push("fill");
    }
    return options;
  };
  return { horizontal: build("horizontal"), vertical: build("vertical") };
}

function wholePx(value: number): string {
  return `${Math.round(value)}px`;
}

function roundPatch(patch: LayoutStylePatch): LayoutStylePatch {
  const rounded: LayoutStylePatch = {};
  for (const [property, value] of Object.entries(patch)) {
    rounded[property] =
      value === null ? null : roundGeometryStylePx(property, value);
  }
  return rounded;
}

/** The style patch that puts one node into a sizing mode on one axis. */
export function sizingStylePatch(
  node: LayoutNodeInput,
  parent: LayoutParentInput | null,
  axis: LayoutAxis,
  sizing: LayoutSizing,
  fixedPx: number,
): LayoutStylePatch {
  const isHorizontal = axis === "horizontal";
  const property = sizeProperty(axis);
  const kind = parentLayoutKind(parent);
  const isFlex = kind === "flex";
  const isLayout = isFlex || kind === "grid";
  const isMainFlexAxis = isFlex && parentMainAxis(parent) === axis;
  const stretchProperty = isFlex || !isHorizontal ? "alignSelf" : "justifySelf";
  const patch: LayoutStylePatch = {};

  if (sizing === "fill") {
    if (isMainFlexAxis) {
      patch.flexGrow = "1";
      patch.flexShrink = "0";
      patch.flexBasis = "0";
      patch[property] = "auto";
    } else if (isLayout) {
      patch[stretchProperty] = "stretch";
      patch[property] = "auto";
    } else {
      patch[property] = "100%";
    }
    return patch;
  }
  patch[property] = sizing === "fixed" ? wholePx(fixedPx) : "fit-content";
  if (isMainFlexAxis) {
    patch.flexGrow = "0";
    patch.flexShrink = "0";
    patch.flexBasis = "auto";
  } else if (isLayout) {
    patch[stretchProperty] = "auto";
  }
  return patch;
}

/**
 * A child sized by its insets (`inset: 24px`, `left: 0; right: 0`) has no
 * size of its own once the insets go, so it would collapse in flow. Its
 * rendered size is written first so joining the flow changes nothing visible.
 */
export function joinFlowPatch(child: LayoutNodeInput): LayoutStylePatch | null {
  // An in-flow child is already where flow puts it; a relative offset is
  // part of how it looks, so it stays.
  if (!isOutOfFlow(child)) return {};
  const patch: LayoutStylePatch = {};
  for (const property of INSET_PROPERTIES) patch[property] = null;
  const styles = child.styles;
  const set = (value: string | undefined) =>
    value !== undefined && value.trim() !== "" && lower(value) !== "auto";
  // The measured box an absolute child brings already includes its margin,
  // and padding and gap are inferred from that box; in flow the margin would
  // apply a second time.
  if (
    MARGIN_PROPERTIES.some(
      (property) =>
        set(styles[property]) && !/^0[a-z%]*$/i.test(styles[property]!.trim()),
    )
  ) {
    for (const property of MARGIN_PROPERTIES) patch[property] = null;
    patch.margin = "0";
  }
  const unsized = (value: string | undefined) =>
    !set(value) || lower(value) === "fit-content";
  const hasInset = set(styles.inset);
  const insetWidth =
    (hasInset || (set(styles.left) && set(styles.right))) &&
    unsized(child.declaredSize?.width ?? styles.width);
  const insetHeight =
    (hasInset || (set(styles.top) && set(styles.bottom))) &&
    unsized(child.declaredSize?.height ?? styles.height);
  if (!insetWidth && !insetHeight) return patch;
  // Clearing the insets would collapse it, and nothing says how big it was.
  if (!child.rect) return null;
  if (insetWidth && child.rect.width > 0) {
    patch.width = wholePx(child.rect.width);
  }
  if (insetHeight && child.rect.height > 0) {
    patch.height = wholePx(child.rect.height);
  }
  // The measured rect is a border box, so the written size only holds under
  // border-box sizing. That switch also reinterprets the other axis: an
  // explicit px size there is rewritten to its rendered border box and auto
  // sizes are unaffected. A relative size (vw, em) cannot be rewritten
  // without losing what it means, so it is kept only when the switch leaves
  // it alone, and refused when that is unknown. A percentage resolves against
  // the padding box while absolute but the content box in flow, which the
  // frame's padding changes, so anything that may hold one is refused.
  const other =
    insetWidth && !insetHeight ? "height" : !insetWidth ? "width" : null;
  if (other) {
    const declared = lower(child.declaredSize?.[other] ?? styles[other]);
    if (/^-?(?:\d+\.?\d*|\.\d+)px$/.test(declared)) {
      patch[other] = wholePx(child.rect[other]);
    } else if (
      declared &&
      !HUG_SIZES.has(declared) &&
      (/%|var\(|stretch|fill-available|inherit/.test(declared) ||
        !borderBoxKeepsSize(child, other))
    ) {
      return null;
    }
  }
  patch.boxSizing = "border-box";
  return patch;
}

function borderBoxKeepsSize(
  child: LayoutNodeInput,
  axis: "width" | "height",
): boolean {
  if (lower(child.styles.boxSizing) === "border-box") return true;
  if (!child.box) return false;
  return child.box.sizing === "border-box" || child.box.edges[axis] === 0;
}

/** Pins a child where it renders, relative to its container's padding box. */
export function freezeChildPatch(rect: LayoutRect): LayoutStylePatch {
  return roundPatch({
    boxSizing: "border-box",
    margin: "0",
    position: "absolute",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
}

// A min size that already holds the frame open at its rendered extent is the
// author's; only a missing or smaller one is replaced.
function containingBlockPatch(model: LayoutModel): LayoutStylePatch {
  const position = lower(model.node.styles.position).replace(
    /\s*!important$/,
    "",
  );
  return !position || position === "static" ? { position: "relative" } : {};
}

function writeSizing(
  model: LayoutModel,
  change: Extract<LayoutChange, { kind: "sizing" }>,
): LayoutWrite {
  const frame: LayoutStylePatch = {};
  const children = new Map<string, LayoutStylePatch>();
  const unmeasured: string[] = [];
  const frameAsParent = parentFromFrame(model.node);
  for (const axis of LAYOUT_AXES) {
    const sizing = change.sizing[axis];
    if (!sizing) continue;
    const rendered = renderedSize(model.node, axis);
    const px =
      change.px?.[axis] ?? (rendered === null ? null : Math.max(1, rendered));
    if (sizing === "fixed" && px === null) {
      unmeasured.push(model.node.id ?? "");
      continue;
    }
    Object.assign(
      frame,
      sizingStylePatch(model.node, model.parent, axis, sizing, px ?? 0),
    );
    if (sizing !== "hug") continue;
    if (!childListComplete(model)) {
      unmeasured.push(model.node.id ?? "");
      continue;
    }
    for (const child of circularFillChildren(model, axis)) {
      const childPx = renderedSize(child.node, axis);
      if (child.id === null || childPx === null) {
        unmeasured.push(child.id ?? "");
        continue;
      }
      children.set(child.id, {
        ...children.get(child.id),
        ...sizingStylePatch(child.node, frameAsParent, axis, "fixed", childPx),
      });
    }
  }
  if (unmeasured.length > 0) {
    return { status: "unreadable", reason: "unmeasured", nodeIds: unmeasured };
  }
  return { status: "ok", frame, children };
}

function writeEnable(
  model: LayoutModel,
  change: Extract<LayoutChange, { kind: "enable-auto-layout" }>,
): LayoutWrite {
  // Changing direction, gap or alignment on a frame that already lays out
  // must not drag its intentionally absolute children (badges, overlays)
  // into flow; only the freeform → auto layout transition does that.
  if (model.frame.mode !== "none") {
    return { status: "ok", frame: { ...change.frame }, children: new Map() };
  }
  if (model.children.status !== "read") {
    return {
      status: "unreadable",
      reason: "children-unreadable",
      nodeIds: [model.node.id ?? ""],
    };
  }
  const children = new Map<string, LayoutStylePatch>();
  const unmeasured: string[] = [];
  for (const child of model.children.items) {
    if (child.id === null) continue;
    const patch = joinFlowPatch(child.node);
    if (patch === null) unmeasured.push(child.id);
    else children.set(child.id, patch);
  }
  if (unmeasured.length > 0) {
    return { status: "unreadable", reason: "unmeasured", nodeIds: unmeasured };
  }
  if (change.frame) {
    return { status: "ok", frame: { ...change.frame }, children };
  }
  const width = renderedSize(model.node, "horizontal");
  const height = renderedSize(model.node, "vertical");
  const measured = model.children.items.flatMap((child) =>
    child.id !== null && child.rect ? [{ id: child.id, rect: child.rect }] : [],
  );
  const arrangement = inferFlowArrangement(
    { x: 0, y: 0, width: width ?? 0, height: height ?? 0 },
    measured,
  );
  const frame: LayoutStylePatch = { display: "flex" };
  if (!arrangement) {
    frame.flexDirection = "column";
    frame.gap = "10px";
    return { status: "ok", frame, children };
  }
  frame.flexDirection =
    arrangement.direction === "horizontal" ? "row" : "column";
  frame.gap = `${arrangement.gap}px`;
  if (width !== null && height !== null) {
    const { top, right, bottom, left } = arrangement.padding;
    if (top > 0 || right > 0 || bottom > 0 || left > 0) {
      frame.padding = `${top}px ${right}px ${bottom}px ${left}px`;
      // A content-box size excludes padding: a Fixed axis gives the padding
      // back out of its declared size so the frame keeps its rendered box.
      if (lower(model.node.styles.boxSizing) !== "border-box") {
        for (const [axis, extent, inset] of [
          ["horizontal", width, left + right],
          ["vertical", height, top + bottom],
        ] as const) {
          if (inset === 0) continue;
          if (readNodeSizing(model.node, model.parent, axis) !== "fixed") {
            continue;
          }
          if (!/^-?\d*\.?\d+px$/.test(declaredSizeOf(model.node, axis) ?? "")) {
            continue;
          }
          frame[sizeProperty(axis)] = wholePx(Math.max(0, extent - inset));
        }
      }
    }
  }
  // Auto layout offers no "stretch" alignment: children that span the
  // frame keep their own sizes, so only centred or end-aligned rows say so.
  if (
    arrangement.alignItems === "center" ||
    arrangement.alignItems === "flex-end"
  ) {
    frame.alignItems = arrangement.alignItems;
  }
  return { status: "ok", frame, children, order: arrangement.order };
}

function writeDisable(model: LayoutModel): LayoutWrite {
  if (model.children.status !== "read") {
    return {
      status: "unreadable",
      reason: "children-unreadable",
      nodeIds: [model.node.id ?? ""],
    };
  }
  const width = renderedSize(model.node, "horizontal");
  const height = renderedSize(model.node, "vertical");
  const children = new Map<string, LayoutStylePatch>();
  for (const child of model.children.items) {
    if (child.id !== null && child.rect) {
      children.set(child.id, freezeChildPatch(child.rect));
    }
  }
  // An empty frame has nothing to pin, but its measured size still proves
  // it was seen rendering; a frame with neither cannot be frozen in place.
  if (children.size === 0 && (width === null || height === null)) {
    return {
      status: "unreadable",
      reason: "unmeasured",
      nodeIds: [model.node.id ?? ""],
    };
  }
  const frame: LayoutStylePatch = {
    display: "block",
    ...containingBlockPatch(model),
  };
  // Freeform frames cannot hug (absolute children add no extent), so a Hug
  // axis becomes Fixed at its rendered size. A min-size hold
  // would instead stop the user from ever making the frame smaller.
  for (const [axis, extent] of [
    ["horizontal", width],
    ["vertical", height],
  ] as const) {
    if (extent === null) continue;
    if (readNodeSizing(model.node, model.parent, axis) !== "hug") continue;
    frame[sizeProperty(axis)] = wholePx(extent);
  }
  return { status: "ok", frame, children };
}

function writeChildPositioning(
  model: LayoutModel,
  change: Extract<LayoutChange, { kind: "child-positioning" }>,
): LayoutWrite {
  if (model.children.status !== "read") {
    return {
      status: "unreadable",
      reason: "children-unreadable",
      nodeIds: [change.childId],
    };
  }
  const child = model.children.items.find((item) => item.id === change.childId);
  if (!child) {
    return {
      status: "unreadable",
      reason: "unknown-child",
      nodeIds: [change.childId],
    };
  }
  if (change.positioning === "auto") {
    const patch = joinFlowPatch(child.node);
    if (patch === null) {
      return {
        status: "unreadable",
        reason: "unmeasured",
        nodeIds: [change.childId],
      };
    }
    return {
      status: "ok",
      frame: {},
      children: new Map([[change.childId, patch]]),
    };
  }
  if (!child.rect) {
    return {
      status: "unreadable",
      reason: "unmeasured",
      nodeIds: [change.childId],
    };
  }
  return {
    status: "ok",
    frame: containingBlockPatch(model),
    children: new Map([[change.childId, freezeChildPatch(child.rect)]]),
  };
}

export function writeLayoutChange(
  model: LayoutModel,
  change: LayoutChange,
): LayoutWrite {
  switch (change.kind) {
    case "sizing":
      return writeSizing(model, change);
    case "enable-auto-layout":
      return writeEnable(model, change);
    case "disable-auto-layout":
      return writeDisable(model);
    case "child-positioning":
      return writeChildPositioning(model, change);
  }
}

/** Merges a write into one patch per node id, the frame's under `frameId`. */
export function layoutPatchesById(
  write: Extract<LayoutWrite, { status: "ok" }>,
  frameId: string,
): Map<string, LayoutStylePatch> {
  const patches = new Map(write.children);
  if (Object.keys(write.frame).length > 0) {
    patches.set(frameId, { ...patches.get(frameId), ...write.frame });
  }
  return patches;
}

export function inferFlowAxis(
  rects: readonly LayoutRect[],
): "horizontal" | "vertical" {
  if (rects.length < 2) return "vertical";
  let sideBySidePairs = 0;
  let stackedPairs = 0;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]!;
      const b = rects[j]!;
      const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
      if (overlapsY && !overlapsX) sideBySidePairs += 1;
      else if (overlapsX && !overlapsY) stackedPairs += 1;
    }
  }
  if (sideBySidePairs !== stackedPairs) {
    return sideBySidePairs > stackedPairs ? "horizontal" : "vertical";
  }
  const minX = Math.min(...rects.map((rect) => rect.x));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return maxX - minX >= maxY - minY ? "horizontal" : "vertical";
}

export interface FlowArrangement {
  direction: "horizontal" | "vertical";
  /** Child ids in on-canvas order along the direction. */
  order: string[];
  gap: number;
  /** Insets in the container's own space. */
  padding: LayoutInsets;
  alignItems: "flex-start" | "center" | "flex-end" | "stretch";
  justifyContent: "flex-start" | "space-between";
  /** Whether the children already fill the container tightly on an axis. */
  hugs: Record<LayoutAxis, boolean>;
  overlaps: boolean;
  irregular: boolean;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function relativeVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (Math.abs(average) < 1) return 0;
  return (
    values.reduce((sum, value) => sum + Math.abs(value - average), 0) /
    values.length /
    Math.abs(average)
  );
}

/**
 * How auto layout would flow children that render at `children` inside
 * `container`. Both must be in the same space, the container's own for a
 * frame's children; null when no child has a usable rect.
 */
export function inferFlowArrangement(
  container: LayoutRect,
  children: readonly { id: string; rect: LayoutRect }[],
): FlowArrangement | null {
  const measured = children.filter(
    ({ rect }) =>
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width >= 0 &&
      rect.height >= 0,
  );
  if (measured.length === 0) return null;
  const round = (value: number) => Math.max(0, Math.round(value));
  const rects = measured.map(({ rect }) => rect);
  const minX = Math.min(...rects.map((rect) => rect.x));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  const direction = inferFlowAxis(rects);
  const horizontal = direction === "horizontal";
  const primaryStart = (rect: LayoutRect) => (horizontal ? rect.x : rect.y);
  const primarySize = (rect: LayoutRect) =>
    horizontal ? rect.width : rect.height;
  const crossStart = (rect: LayoutRect) => (horizontal ? rect.y : rect.x);
  const crossSize = (rect: LayoutRect) =>
    horizontal ? rect.height : rect.width;
  // A stable sort: children that start together keep their layer order.
  const ordered = [...measured].sort(
    (a, b) => primaryStart(a.rect) - primaryStart(b.rect),
  );
  const rawGaps = ordered.slice(1).map(({ rect }, index) => {
    const previous = ordered[index]!.rect;
    return (
      primaryStart(rect) - (primaryStart(previous) + primarySize(previous))
    );
  });
  const overlaps = rawGaps.some((gap) => gap < -1);
  const positiveGaps = rawGaps.filter((gap) => gap >= 0);
  const gap =
    measured.length === 1
      ? 10
      : round(median(positiveGaps.length ? positiveGaps : [0]));
  const irregular = relativeVariance(positiveGaps) > 0.35;
  const padding = {
    top: round(minY - container.y),
    right: round(container.x + container.width - maxX),
    bottom: round(container.y + container.height - maxY),
    left: round(minX - container.x),
  };

  const crossContainerStart = horizontal ? container.y : container.x;
  const crossContainerSize = horizontal ? container.height : container.width;
  const crossLeading = horizontal ? padding.top : padding.left;
  const crossTrailing = horizontal ? padding.bottom : padding.right;
  const crossInnerStart = crossContainerStart + crossLeading;
  const innerCrossSize = Math.max(
    0,
    crossContainerSize - crossLeading - crossTrailing,
  );
  const crossInnerEnd = crossInnerStart + innerCrossSize;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  const crossCenters = rects.map(
    (rect) => crossStart(rect) + crossSize(rect) / 2,
  );
  const alignItems = rects.every((rect) =>
    near(crossSize(rect), innerCrossSize),
  )
    ? "stretch"
    : rects.every((rect) => near(crossStart(rect), crossInnerStart))
      ? "flex-start"
      : rects.every((rect) =>
            near(crossStart(rect) + crossSize(rect), crossInnerEnd),
          )
        ? "flex-end"
        : Math.max(...crossCenters) - Math.min(...crossCenters) <= 2
          ? "center"
          : "flex-start";

  const primaryLeading = horizontal ? padding.left : padding.top;
  const primaryTrailing = horizontal ? padding.right : padding.bottom;
  return {
    direction,
    order: ordered.map(({ id }) => id),
    gap,
    padding,
    alignItems,
    justifyContent:
      measured.length > 2 &&
      relativeVariance(positiveGaps) <= 0.08 &&
      near(primaryLeading, primaryTrailing)
        ? "space-between"
        : "flex-start",
    // Padding is measured off the container, so content plus padding always
    // equals its size; even insets are what say the frame wraps its content.
    hugs: {
      horizontal: near(padding.left, padding.right),
      vertical: near(padding.top, padding.bottom),
    },
    overlaps,
    irregular,
  };
}
