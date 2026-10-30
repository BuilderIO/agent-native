import {
  LAYOUT_AXES,
  availableSizing,
  layoutPatchesById,
  readLayoutModel,
  roundGeometryStylePx,
  writeLayoutChange,
  type FrameLayout,
  type LayoutAlign,
  type LayoutAxis,
  type LayoutBoxModel,
  type LayoutChildrenInput,
  type LayoutInsets,
  type LayoutModel,
  type LayoutNodeInput,
  type LayoutParentInput,
  type LayoutRect,
  type LayoutSizing,
  type LayoutStylePatch,
  type LayoutStyles,
  type LayoutWrite,
} from "@agent-native/toolkit/canvas-interactions/layout-model";

import {
  createSlideObjectId,
  isSlideObjectGroup,
  resolveFreeformSizing,
  SLIDE_OBJECT_GROUP_CLASS,
} from "./slide-object-interactions";

/**
 * Auto layout for Slides groups. A group (`div[data-slide-group]`) either
 * places its members absolutely or lays them out as a flex row or column;
 * every decision about which, and every style it writes, comes from the
 * toolkit's shared layout model so Slides and Design write the same CSS.
 */

const OBJECT_ID = "data-slide-object-id";

/**
 * The untransformed border box of an element relative to its offset parent's
 * padding box, in the slide's own px. A group is positioned, so that is the
 * group for each member. Null when the element is not rendered, so nothing
 * can say where or how big it is.
 */
export type SlideLayoutMeasure = (element: HTMLElement) => LayoutRect | null;

export const measureSlideLayoutBox: SlideLayoutMeasure = (element) => {
  if (!element.offsetParent) return null;
  return {
    x: element.offsetLeft,
    y: element.offsetTop,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
};

export type SlideAutoLayoutResult =
  | { status: "applied" }
  | { status: "unchanged" }
  | {
      status: "refused";
      reason:
        | "not-group"
        | "not-in-layout"
        | "unidentified-children"
        | "placed-by-stylesheet"
        | "loose-text"
        | "cannot-wrap"
        | Extract<LayoutWrite, { status: "unreadable" }>["reason"];
      objectIds: readonly string[];
    };

const refused = (
  reason: Extract<SlideAutoLayoutResult, { status: "refused" }>["reason"],
  objectIds: readonly string[] = [],
): SlideAutoLayoutResult => ({ status: "refused", reason, objectIds });

// Insets, sizes and margins are what the author wrote: a computed `right` on an
// absolute box is a resolved px, which would read as an inset-sized child.
const AUTHORED_PROPERTIES = [
  "left",
  "top",
  "right",
  "bottom",
  "inset",
  "width",
  "height",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "flexBasis",
] as const;

const COMPUTED_PROPERTIES = [
  "position",
  "display",
  "boxSizing",
  "flexDirection",
  "flexWrap",
  "flexGrow",
  "alignItems",
  "alignSelf",
  "justifyContent",
  "justifySelf",
  "gap",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "overflow",
  "float",
] as const;

const kebab = (property: string) =>
  property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function computedStyleOf(element: HTMLElement): CSSStyleDeclaration {
  return (element.ownerDocument.defaultView ?? window).getComputedStyle(
    element,
  );
}

function layoutStylesOf(element: HTMLElement): LayoutStyles {
  const computed = computedStyleOf(element);
  const styles: Record<string, string | undefined> = {};
  for (const property of AUTHORED_PROPERTIES) {
    const value = element.style.getPropertyValue(kebab(property)).trim();
    if (value) styles[property] = value;
  }
  for (const property of COMPUTED_PROPERTIES) {
    const value =
      element.style.getPropertyValue(kebab(property)).trim() ||
      computed.getPropertyValue(kebab(property)).trim();
    if (value) styles[property] = value;
  }
  return styles;
}

function boxModelOf(element: HTMLElement): LayoutBoxModel {
  const computed = computedStyleOf(element);
  const px = (property: string) => {
    const value = Number.parseFloat(computed.getPropertyValue(property));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    sizing: computed.boxSizing === "border-box" ? "border-box" : "content-box",
    edges: {
      width:
        px("padding-left") +
        px("padding-right") +
        px("border-left-width") +
        px("border-right-width"),
      height:
        px("padding-top") +
        px("padding-bottom") +
        px("border-top-width") +
        px("border-bottom-width"),
    },
  };
}

function borderOf(element: HTMLElement): LayoutInsets {
  const computed = computedStyleOf(element);
  const px = (property: string) => {
    const value = Number.parseFloat(computed.getPropertyValue(property));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    top: px("border-top-width"),
    right: px("border-right-width"),
    bottom: px("border-bottom-width"),
    left: px("border-left-width"),
  };
}

function elementChildren(element: HTMLElement): HTMLElement[] {
  return Array.from(element.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !["SCRIPT", "STYLE", "TEMPLATE"].includes(child.tagName),
  );
}

function hasLooseText(element: HTMLElement): boolean {
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
}

type SizeSpace = "padding-box" | "sizing-box";

/**
 * `padding-box` is the space a container's children are measured in, which
 * is what padding and gap are inferred from. `sizing-box` is the box the
 * element's own `width`/`height` declare, which Fixed and Hug write.
 */
function resolvedSizeOf(
  element: HTMLElement,
  rect: LayoutRect | null,
  space: SizeSpace,
): Partial<Record<LayoutAxis, number | null>> {
  if (!rect) return { horizontal: null, vertical: null };
  const box = boxModelOf(element);
  if (space === "padding-box") {
    const border = borderOf(element);
    return {
      horizontal: Math.max(0, rect.width - border.left - border.right),
      vertical: Math.max(0, rect.height - border.top - border.bottom),
    };
  }
  if (box.sizing === "border-box") {
    return { horizontal: rect.width, vertical: rect.height };
  }
  return {
    horizontal: Math.max(0, rect.width - box.edges.width),
    vertical: Math.max(0, rect.height - box.edges.height),
  };
}

function layoutNodeOf(
  element: HTMLElement,
  measure: SlideLayoutMeasure,
  space: SizeSpace,
): LayoutNodeInput {
  const measured = measure(element);
  // A 0x0 box is what an element nothing laid out reports.
  const rect =
    measured && (measured.width > 0 || measured.height > 0) ? measured : null;
  const width = element.style.getPropertyValue("width").trim();
  const height = element.style.getPropertyValue("height").trim();
  return {
    id: element.getAttribute(OBJECT_ID),
    tagName: element.tagName.toLowerCase(),
    styles: layoutStylesOf(element),
    declaredSize: {
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    },
    resolvedSize: resolvedSizeOf(element, rect, space),
    rect,
    box: rect ? boxModelOf(element) : null,
  };
}

function positionOf(element: HTMLElement): string {
  return (
    element.style.position || computedStyleOf(element).position || "static"
  );
}

function isPlaced(element: HTMLElement): boolean {
  const position = positionOf(element);
  return position === "absolute" || position === "fixed";
}

/** Whether something inside the element is placed relative to it. */
function anchorsPlacedContent(element: HTMLElement): boolean {
  return elementChildren(element).some(
    (child) =>
      isPlaced(child) ||
      (positionOf(child) === "static" && anchorsPlacedContent(child)),
  );
}

function parentInputOf(element: HTMLElement): LayoutParentInput | null {
  const parent = element.parentElement;
  // A placed element is not laid out by its parent. The slide layer is often
  // flex, and reading it as one would write flex sizing onto a placed group.
  if (!parent || isPlaced(element)) return null;
  const {
    display = "block",
    flexDirection,
    alignItems,
  } = layoutStylesOf(parent);
  return {
    display,
    ...(flexDirection ? { flexDirection } : {}),
    ...(alignItems ? { alignItems } : {}),
  };
}

function childrenInputOf(
  element: HTMLElement,
  measure: SlideLayoutMeasure,
): LayoutChildrenInput {
  return {
    status: "read",
    looseText: hasLooseText(element),
    complete: true,
    children: elementChildren(element).map((child) =>
      layoutNodeOf(child, measure, "sizing-box"),
    ),
  };
}

function readModel(
  element: HTMLElement,
  measure: SlideLayoutMeasure,
  space: SizeSpace,
): LayoutModel {
  return readLayoutModel({
    node: layoutNodeOf(element, measure, space),
    parent: parentInputOf(element),
    children: childrenInputOf(element, measure),
  });
}

/** Whether a group lays its members out with flexbox. */
export function isAutoLayoutSlideGroup(element: HTMLElement): boolean {
  if (!isSlideObjectGroup(element)) return false;
  const display =
    element.style.display || computedStyleOf(element).display || "";
  return display.includes("flex");
}

/** The auto layout group a member is laid out by, or null when it is placed. */
export function slideAutoLayoutGroupOf(
  element: HTMLElement,
): HTMLElement | null {
  const parent = element.parentElement;
  if (!parent || !isAutoLayoutSlideGroup(parent)) return null;
  if (!element.hasAttribute(OBJECT_ID)) return null;
  return isPlaced(element) ? null : parent;
}

/** The group's flow settings, or null when it places its members freely. */
export function readSlideAutoLayoutFrame(
  group: HTMLElement,
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
): FrameLayout | null {
  if (!isAutoLayoutSlideGroup(group)) return null;
  return readModel(group, measure, "sizing-box").frame;
}

function applyStylePatch(element: HTMLElement, patch: LayoutStylePatch): void {
  for (const [property, value] of Object.entries(patch)) {
    const css = kebab(property);
    if (value === null) element.style.removeProperty(css);
    else element.style.setProperty(css, roundGeometryStylePx(property, value));
  }
}

function applyWrite(
  element: HTMLElement,
  write: Extract<LayoutWrite, { status: "ok" }>,
  members: ReadonlyMap<string, HTMLElement>,
  adjust?: (member: HTMLElement, patch: LayoutStylePatch) => LayoutStylePatch,
): void {
  const selfId = element.getAttribute(OBJECT_ID) ?? "";
  for (const [id, patch] of layoutPatchesById(write, selfId)) {
    const target = id === selfId ? element : members.get(id);
    if (!target) continue;
    applyStylePatch(
      target,
      adjust && target !== element ? adjust(target, patch) : patch,
    );
  }
}

function membersById(group: HTMLElement): Map<string, HTMLElement> | null {
  const members = new Map<string, HTMLElement>();
  for (const child of elementChildren(group)) {
    const id = child.getAttribute(OBJECT_ID);
    if (!id) return null;
    members.set(id, child);
  }
  return members;
}

/**
 * Turns a freeform group into auto layout: members are ordered by where they
 * render, and the gap, padding and alignment are inferred from them. Evenly
 * spaced members stay put; uneven gaps settle on the median one and
 * overlapping members are laid side by side, which is what auto layout means.
 * Refuses, writing nothing, when a member cannot be addressed or measured.
 */
export function enableSlideGroupAutoLayout(
  group: HTMLElement,
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
): SlideAutoLayoutResult {
  if (!isSlideObjectGroup(group)) return refused("not-group");
  if (isAutoLayoutSlideGroup(group)) return { status: "unchanged" };
  const members = membersById(group);
  if (!members || members.size === 0) return refused("unidentified-children");
  const model = readModel(group, measure, "padding-box");
  if (model.children.status !== "read") return refused("children-unreadable");
  // Text directly in the group would become a flex item of its own that no
  // member measured or placed.
  if (model.children.looseText) return refused("loose-text");
  // Order, gap and padding come from where each member renders; one nothing
  // measured would be placed by a guess.
  const unmeasured = model.children.items
    .filter((child) => !child.rect)
    .map((child) => child.id ?? "");
  if (unmeasured.length > 0) return refused("unmeasured", unmeasured);
  const write = writeLayoutChange(model, { kind: "enable-auto-layout" });
  if (write.status !== "ok") return refused(write.reason, write.nodeIds);

  // Joining flow clears a member's position, and a nested group's members
  // would then be placed against this group instead and move.
  const anchors = new Set(
    Array.from(members.values()).filter(anchorsPlacedContent),
  );
  const startStyles = [group, ...members.values()].map(
    (element) => [element, element.getAttribute("style")] as const,
  );
  const startOrder = Array.from(group.childNodes);
  // The order is left to right as members render, but a row under rtl lays
  // the first member out on the right.
  const order = write.order ?? [];
  const rightToLeft =
    write.frame.flexDirection === "row" &&
    computedStyleOf(group).direction === "rtl";
  for (const id of rightToLeft ? [...order].reverse() : order) {
    const member = members.get(id);
    if (member) group.append(member);
  }
  const joining = new Set<HTMLElement>();
  applyWrite(group, write, members, (member, patch) => {
    if (patch.position !== null) return patch;
    joining.add(member);
    // A placed member's flex-item styles were inert and would come alive
    // here, resizing or reordering it. It joins at the size it had, which
    // flex would shrink under a smaller group; Fixed means it keeps it.
    return {
      order: null,
      flexGrow: null,
      flexBasis: null,
      alignSelf: null,
      ...patch,
      flexShrink: "0",
      ...(anchors.has(member) ? { position: "relative" } : {}),
    };
  });
  // A stylesheet can carry them too, which clearing inline ones leaves.
  const neutral: Record<string, string> = {
    order: "0",
    "flex-grow": "0",
    "flex-basis": "auto",
    "align-self": "auto",
  };
  for (const member of joining) {
    const computed = computedStyleOf(member);
    for (const [property, value] of Object.entries(neutral)) {
      if (computed.getPropertyValue(property) !== value) {
        member.style.setProperty(property, value);
      }
    }
  }
  // Clearing the inline position leaves a stylesheet one in force, so a
  // member placed by a class is put in flow explicitly; one the stylesheet
  // still places after that cannot join, and nothing is written.
  const paintsPlaced = (member: HTMLElement) =>
    ["absolute", "fixed"].includes(computedStyleOf(member).position);
  const held = Array.from(joining).filter((member) => {
    if (paintsPlaced(member)) member.style.setProperty("position", "static");
    return paintsPlaced(member);
  });
  if (held.length > 0) {
    for (const [element, style] of startStyles) {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }
    group.append(...startOrder);
    return refused(
      "placed-by-stylesheet",
      held.map((member) => member.getAttribute(OBJECT_ID) ?? ""),
    );
  }
  // Flex stretches a member with no cross size of its own, which is every
  // fit text box: pack them to the start unless the layout said otherwise.
  if (!write.frame.alignItems)
    group.style.setProperty("align-items", "flex-start");
  return { status: "applied" };
}

/** Pins every member where it renders and turns the group back to freeform. */
export function disableSlideGroupAutoLayout(
  group: HTMLElement,
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
): SlideAutoLayoutResult {
  if (!isSlideObjectGroup(group)) return refused("not-group");
  if (!isAutoLayoutSlideGroup(group)) return { status: "unchanged" };
  const members = membersById(group);
  if (!members) return refused("unidentified-children");
  const model = readModel(group, measure, "sizing-box");
  if (model.children.status !== "read") return refused("children-unreadable");
  // A member in flow is only pinned where it was measured rendering; one that
  // was not would be left in block flow once the group stops laying out.
  const unmeasured = model.children.items
    .filter((child) => child.positioning === "auto" && !child.rect)
    .map((child) => child.id ?? "");
  if (unmeasured.length > 0) return refused("unmeasured", unmeasured);
  const write = writeLayoutChange(model, { kind: "disable-auto-layout" });
  if (write.status !== "ok") return refused(write.reason, write.nodeIds);
  // A text box that sizes to its text keeps doing so once placed; pinning
  // its rendered height would clip the next edit. A Fill height came from
  // the group, not the text, so that one is pinned.
  const sizesItself = new Set(
    Array.from(members.values()).filter(
      (member) =>
        resolveFreeformSizing(member) !== "fixed" &&
        readModel(member, measure, "sizing-box").frame.sizing.vertical.mode !==
          "fill",
    ),
  );
  applyWrite(group, write, members, (member, patch) => {
    // Flow sizing is inert while placed, but would come back on the next
    // enable and override the size the member was pinned at.
    const next: LayoutStylePatch = {
      ...patch,
      flexGrow: null,
      flexShrink: null,
      flexBasis: null,
      alignSelf: null,
    };
    if (sizesItself.has(member)) delete next.height;
    return next;
  });
  return { status: "applied" };
}

export interface SlideAutoLayoutFrameChange {
  direction?: "horizontal" | "vertical";
  gap?: number;
  padding?: Partial<LayoutInsets>;
  /** Main is along the direction, cross is across it. */
  alignment?: { main?: LayoutAlign; cross?: LayoutAlign };
}

const MAIN_ALIGN: Record<LayoutAlign, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "flex-start",
  baseline: "flex-start",
};

const CROSS_ALIGN: Record<LayoutAlign, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};

const wholeNonNegative = (value: number) =>
  `${Math.max(0, Math.round(Number.isFinite(value) ? value : 0))}px`;

/** Changes direction, gap, padding or alignment of an auto layout group. */
export function updateSlideAutoLayoutFrame(
  group: HTMLElement,
  change: SlideAutoLayoutFrameChange,
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
): SlideAutoLayoutResult {
  if (!isAutoLayoutSlideGroup(group)) return refused("not-in-layout");
  const model = readModel(group, measure, "sizing-box");
  const frame: Record<string, string> = {};
  if (change.direction) {
    frame.flexDirection = change.direction === "horizontal" ? "row" : "column";
  }
  if (change.gap !== undefined) frame.gap = wholeNonNegative(change.gap);
  if (change.padding) {
    const { top, right, bottom, left } = {
      ...model.frame.padding,
      ...change.padding,
    };
    frame.padding = [top, right, bottom, left].map(wholeNonNegative).join(" ");
  }
  if (change.alignment?.main) {
    frame.justifyContent = MAIN_ALIGN[change.alignment.main];
  }
  if (change.alignment?.cross) {
    frame.alignItems = CROSS_ALIGN[change.alignment.cross];
  }
  if (Object.keys(frame).length === 0) return { status: "unchanged" };
  const write = writeLayoutChange(model, { kind: "enable-auto-layout", frame });
  if (write.status !== "ok") return refused(write.reason, write.nodeIds);
  // A member's Fill or Fixed is written for the axis it was set on: flex-grow
  // on the main axis, align-self across it. Switching direction swaps which
  // is which, so each member's sizing is read before and written again after.
  const turns =
    change.direction !== undefined && change.direction !== mainAxisOf(group);
  const sizings = turns
    ? flowMembers(group).map((member) => {
        const { sizing } = readModel(member, measure, "sizing-box").frame;
        return {
          member,
          sizing: {
            horizontal: sizing.horizontal.mode,
            vertical: sizing.vertical.mode,
          },
          px: {
            ...(sizing.horizontal.px !== null
              ? { horizontal: sizing.horizontal.px }
              : {}),
            ...(sizing.vertical.px !== null
              ? { vertical: sizing.vertical.px }
              : {}),
          },
        };
      })
    : [];
  const groupStyle = group.getAttribute("style");
  applyWrite(group, write, new Map());
  const memberWrites = sizings.map(({ member, sizing, px }) => ({
    member,
    write: writeLayoutChange(readModel(member, measure, "sizing-box"), {
      kind: "sizing",
      sizing,
      px,
    }),
  }));
  const failed = memberWrites.find(({ write }) => write.status !== "ok");
  if (failed && failed.write.status !== "ok") {
    if (groupStyle === null) group.removeAttribute("style");
    else group.setAttribute("style", groupStyle);
    return refused(failed.write.reason, failed.write.nodeIds);
  }
  for (const { member, write } of memberWrites) {
    // A nested group that hugs freezes its own Fill members; those patches
    // are addressed to them.
    if (write.status === "ok") {
      applyWrite(member, write, membersById(member) ?? new Map());
    }
  }
  return { status: "applied" };
}

export interface SlideLayoutSizingState {
  sizing: Record<LayoutAxis, LayoutSizing>;
  available: Record<LayoutAxis, LayoutSizing[]>;
}

function sizingSubject(element: HTMLElement): boolean {
  return (
    isAutoLayoutSlideGroup(element) || slideAutoLayoutGroupOf(element) !== null
  );
}

/**
 * Hug, Fill or Fixed per axis for an auto layout group or one of its members
 * in flow, and the modes it can switch to. Null for anything else: a freeform
 * object has no layout to size against.
 */
export function readSlideLayoutSizing(
  element: HTMLElement,
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
): SlideLayoutSizingState | null {
  if (!sizingSubject(element)) return null;
  const model = readModel(element, measure, "sizing-box");
  return {
    sizing: {
      horizontal: model.frame.sizing.horizontal.mode,
      vertical: model.frame.sizing.vertical.mode,
    },
    available: availableSizing(model),
  };
}

export function setSlideLayoutSizing(
  element: HTMLElement,
  axis: LayoutAxis,
  sizing: LayoutSizing,
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
): SlideAutoLayoutResult {
  if (!sizingSubject(element)) return refused("not-in-layout");
  const model = readModel(element, measure, "sizing-box");
  if (!availableSizing(model)[axis].includes(sizing)) {
    return refused("not-in-layout");
  }
  if (model.frame.sizing[axis].mode === sizing) return { status: "unchanged" };
  const write = writeLayoutChange(model, {
    kind: "sizing",
    sizing: { [axis]: sizing },
  });
  if (write.status !== "ok") return refused(write.reason, write.nodeIds);
  applyWrite(element, write, membersById(element) ?? new Map());
  return { status: "applied" };
}

/**
 * Pins the axes a resize changed on a member in flow: a resized member is
 * Fixed at its new size. Its insets are left alone, since a relatively
 * positioned member was authored with them. `borderBox` gives an axis's new
 * outer size, as a resize measures it; an axis without one keeps the size it
 * renders at.
 */
export function fixSlideLayoutSizing(
  element: HTMLElement,
  axes: readonly LayoutAxis[],
  measure: SlideLayoutMeasure = measureSlideLayoutBox,
  borderBox: Partial<Record<LayoutAxis, number>> = {},
): SlideAutoLayoutResult {
  if (!slideAutoLayoutGroupOf(element)) return refused("not-in-layout");
  const model = readModel(element, measure, "sizing-box");
  const sizing: Partial<Record<LayoutAxis, LayoutSizing>> = {};
  for (const axis of axes) sizing[axis] = "fixed";
  // A content-box size excludes padding and border, which the outer size
  // a resize measures includes.
  const box = boxModelOf(element);
  const px: Partial<Record<LayoutAxis, number>> = {};
  for (const axis of axes) {
    const outer = borderBox[axis];
    if (outer === undefined) continue;
    const edges = axis === "horizontal" ? box.edges.width : box.edges.height;
    px[axis] = Math.max(0, box.sizing === "border-box" ? outer : outer - edges);
  }
  const write = writeLayoutChange(model, { kind: "sizing", sizing, px });
  if (write.status !== "ok") return refused(write.reason, write.nodeIds);
  applyWrite(element, write, new Map());
  return { status: "applied" };
}

function flowMembers(group: HTMLElement): HTMLElement[] {
  return elementChildren(group).filter(
    (child) => slideAutoLayoutGroupOf(child) === group,
  );
}

function mainAxisOf(group: HTMLElement): LayoutAxis {
  const direction =
    group.style.flexDirection || computedStyleOf(group).flexDirection || "row";
  return direction.startsWith("column") ? "vertical" : "horizontal";
}

function paintedCentreOf(member: HTMLElement): { x: number; y: number } {
  const rect = member.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The screen direction the group's flow runs in, first member to last; its
 * length means nothing. Pointer and keyboard reordering both go by it, so a
 * reversed, rotated or flipped group reorders the way it looks.
 */
export function slideFlowScreenAxis(group: HTMLElement): {
  x: number;
  y: number;
} {
  const computed = computedStyleOf(group);
  const horizontal = mainAxisOf(group) === "horizontal";
  // A row runs the way the text does, so right to left under rtl.
  const reversed =
    (group.style.flexDirection || computed.flexDirection).endsWith(
      "reverse",
    ) !== (horizontal && computed.direction === "rtl");
  const sign = reversed ? -1 : 1;
  // Each element up to the root paints its own rotate, scale and transform
  // over its children; together they take the group's main axis to the
  // screen, mirrors included. Translation and origin move it, not turn it.
  let painted = new DOMMatrix();
  for (
    let element: HTMLElement | null = group;
    element;
    element = element.parentElement
  ) {
    painted = paintedLinearMatrix(element).multiply(painted);
  }
  const { x, y } = painted.transformPoint(
    new DOMPoint(horizontal ? sign : 0, horizontal ? 0 : sign, 0, 0),
  );
  return { x, y };
}

const ANGLE_DEGREES: Record<string, number> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

function paintedLinearMatrix(element: HTMLElement): DOMMatrix {
  const computed = computedStyleOf(element);
  const matrix = new DOMMatrix();
  const rotate = computed.getPropertyValue("rotate").trim();
  if (rotate && rotate !== "none") {
    const tokens = rotate.split(/\s+/);
    const angle = /^(-?[\d.]+(?:e[+-]?\d+)?)(deg|grad|rad|turn)$/i.exec(
      tokens.at(-1) ?? "",
    );
    const named: Record<string, [number, number, number]> = {
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0, 1],
    };
    const rotationAxis =
      tokens.length === 4
        ? (tokens.slice(0, 3).map(Number) as [number, number, number])
        : (named[tokens.length === 2 ? (tokens[0] ?? "z") : "z"] ?? [0, 0, 1]);
    if (angle?.[1] && angle[2]) {
      matrix.rotateAxisAngleSelf(
        ...rotationAxis,
        Number(angle[1]) * (ANGLE_DEGREES[angle[2].toLowerCase()] ?? 1),
      );
    }
  }
  const scale = computed.getPropertyValue("scale").trim();
  if (scale && scale !== "none") {
    const [sx = 1, sy = sx, sz = 1] = scale.split(/\s+/).map(Number);
    matrix.scaleSelf(sx, sy, sz);
  }
  const transform = computed.transform;
  if (transform && transform !== "none") {
    matrix.multiplySelf(new DOMMatrix(transform));
  }
  return matrix;
}

/**
 * Where a member dragged to a client point lands among the group's other
 * members in flow: the count of those whose centre along the group's
 * direction comes before the point.
 */
export function resolveSlideFlowInsertionIndex(
  group: HTMLElement,
  dragged: HTMLElement,
  point: { x: number; y: number },
): number {
  const axis = slideFlowScreenAxis(group);
  const along = ({ x, y }: { x: number; y: number }) => x * axis.x + y * axis.y;
  const at = along(point);
  return flowMembers(group).filter(
    (member) => member !== dragged && along(paintedCentreOf(member)) < at,
  ).length;
}

/** The member's index among the group's members in flow, or -1. */
export function slideFlowIndexOf(
  group: HTMLElement,
  member: HTMLElement,
): number {
  return flowMembers(group).indexOf(member);
}

/**
 * Moves a member to `index` among the other members in flow. Members placed
 * absolutely keep their DOM slots. Returns whether the order changed.
 */
export function moveSlideFlowMember(
  group: HTMLElement,
  member: HTMLElement,
  index: number,
): boolean {
  const members = flowMembers(group);
  const from = members.indexOf(member);
  if (from < 0) return false;
  const others = members.filter((candidate) => candidate !== member);
  const target = Math.max(0, Math.min(others.length, Math.round(index)));
  if (target === from) return false;
  const anchor = others.at(target);
  if (anchor) group.insertBefore(member, anchor);
  else group.insertBefore(member, others.at(-1)?.nextSibling ?? null);
  return true;
}

/**
 * Wraps members of an auto layout group in a nested auto layout group that
 * takes their place in its flow, laid out the way the outer group lays
 * them out, so members next to each other stay where they render.
 */
export function wrapSlideFlowMembers(
  group: HTMLElement,
  selected: readonly HTMLElement[],
):
  | { status: "applied"; group: HTMLElement }
  | Extract<SlideAutoLayoutResult, { status: "refused" }> {
  const inFlow = flowMembers(group);
  const wrapped = inFlow.filter((member) => selected.includes(member));
  if (wrapped.length === 0 || wrapped.length !== selected.length) {
    return {
      status: "refused",
      reason: "not-in-layout",
      objectIds: selected.map((member) => member.getAttribute(OBJECT_ID) ?? ""),
    };
  }
  // The wrapper hugs what it holds, so it can stand in for members only
  // where that leaves them in place: side by side in the flow, sized by
  // themselves, in a group that packs them rather than spreading them out.
  const first = inFlow.indexOf(wrapped[0] ?? group);
  const sideBySide = wrapped.every(
    (member, offset) => inFlow[first + offset] === member,
  );
  const fills = wrapped.some((member) => {
    const sizing = readModel(member, measureSlideLayoutBox, "sizing-box").frame
      .sizing;
    return sizing.horizontal.mode === "fill" || sizing.vertical.mode === "fill";
  });
  const spreads =
    readModel(group, measureSlideLayoutBox, "sizing-box").frame.spacing ===
    "space-between";
  if (!sideBySide || fills || spreads) {
    return {
      status: "refused",
      reason: "cannot-wrap",
      objectIds: wrapped.map((member) => member.getAttribute(OBJECT_ID) ?? ""),
    };
  }
  const computed = computedStyleOf(group);
  const vertical = mainAxisOf(group) === "vertical";
  const wrapper = group.ownerDocument.createElement("div");
  wrapper.className = SLIDE_OBJECT_GROUP_CLASS;
  wrapper.setAttribute("data-slide-group", "true");
  wrapper.setAttribute(OBJECT_ID, createSlideObjectId());
  wrapper.style.boxSizing = "border-box";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = computed.flexDirection;
  wrapper.style.gap = vertical ? computed.rowGap : computed.columnGap;
  wrapper.style.alignItems = computed.alignItems;
  wrapper.style.flexShrink = "0";
  group.insertBefore(wrapper, wrapped[0] ?? null);
  wrapper.append(...wrapped);
  return { status: "applied", group: wrapper };
}

export { LAYOUT_AXES };
export type { FrameLayout, LayoutAlign, LayoutAxis, LayoutSizing };
