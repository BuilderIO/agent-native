import {
  clientPointToCanvasPoint,
  resizeCanvasRect,
  type CanvasResizeHandle,
} from "@agent-native/toolkit/canvas-interactions";

import { CROP_TRANSITION_ANIMATION_ID_PREFIX } from "@/lib/slide-image-replacement";
import { stripSourceStamps } from "@/lib/slide-source-map";

import { hasInlineBottom, hasInlineHeight } from "./fit-text-object";
import { stripFreeformReservation } from "./in-place-text-session";
import {
  isRichTextBlock,
  isSlideCanvasShell,
  isTextLeaf,
  shouldStampBuilderId,
} from "./slide-text-targets";

export const MIN_SLIDE_OBJECT_SIZE = 24;

const SLIDE_LAYER_VOID_ELEMENTS = new Set([
  "AREA",
  "BASE",
  "BR",
  "COL",
  "EMBED",
  "HR",
  "IMG",
  "INPUT",
  "LINK",
  "META",
  "PARAM",
  "SOURCE",
  "TRACK",
  "WBR",
]);

const SLIDE_LAYER_NON_CONTAINER_ELEMENTS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BUTTON",
  "CITE",
  "CODE",
  "DATA",
  "DFN",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "I",
  "KBD",
  "LABEL",
  "MARK",
  "P",
  "Q",
  "RP",
  "RT",
  "RUBY",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TEXTAREA",
  "TIME",
  "U",
  "VAR",
]);

const SLIDE_TABLE_STRUCTURE_ELEMENTS = new Set([
  "CAPTION",
  "COL",
  "COLGROUP",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
]);

const SLIDE_CLIPBOARD_STRUCTURAL_CHILDREN = new Set([
  ...SLIDE_TABLE_STRUCTURE_ELEMENTS,
  "DD",
  "DT",
  "LI",
]);

export function isSlideTableStructureElement(element: Element): boolean {
  return SLIDE_TABLE_STRUCTURE_ELEMENTS.has(element.tagName);
}

/**
 * The object a selection or membership check acts on for any element: its slide
 * group, else its table when it sits anywhere inside one (a row, a cell, or text
 * inside a cell), else the element itself.
 */
export function resolveSelectionOwner(
  element: HTMLElement,
  root: HTMLElement,
): HTMLElement {
  const table = element.closest<HTMLElement>("table");
  const part = table && root.contains(table) ? table : element;
  return resolveSlideObjectGroupRoot(part, root) ?? part;
}

export function resolveSelectionOwnerId(
  element: HTMLElement,
  root: HTMLElement,
): string | null {
  return resolveSelectionOwner(element, root).getAttribute("data-builder-id");
}

const SLIDE_LAYER_REQUIRED_CHILDREN = new Map<string, Set<string>>([
  ["COLGROUP", new Set(["COL"])],
  ["DL", new Set(["DD", "DT"])],
  ["OL", new Set(["LI"])],
  ["OPTGROUP", new Set(["OPTION"])],
  ["SELECT", new Set(["OPTION", "OPTGROUP"])],
  ["TABLE", new Set(["CAPTION", "COLGROUP", "THEAD", "TBODY", "TFOOT"])],
  ["TBODY", new Set(["TR"])],
  ["TFOOT", new Set(["TR"])],
  ["THEAD", new Set(["TR"])],
  ["TR", new Set(["TD", "TH"])],
  ["UL", new Set(["LI"])],
]);

export function canDropSlideLayerInside(
  target: Element,
  source?: Element,
): boolean {
  if (
    isRichTextBlock(target as HTMLElement) ||
    SLIDE_LAYER_VOID_ELEMENTS.has(target.tagName) ||
    SLIDE_LAYER_NON_CONTAINER_ELEMENTS.has(target.tagName)
  ) {
    return false;
  }
  const requiredChildren = SLIDE_LAYER_REQUIRED_CHILDREN.get(target.tagName);
  if (!requiredChildren) return true;
  return source ? requiredChildren.has(source.tagName) : false;
}

export function canDropSlideLayerAdjacent(
  source: Element,
  target: Element,
): boolean {
  const parent = target.parentElement;
  return Boolean(parent) && canDropSlideLayerInside(parent!, source);
}

export type ResizeHandle = CanvasResizeHandle;

export interface SlideObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

// `height` is omitted for fit text objects: the caller must leave their inline
// height untouched instead of pinning the measured one.
export type SlideObjectGeometryPlan = Omit<SlideObjectGeometry, "height"> & {
  height?: number;
};

export type SlideObjectGeometryApplier = (
  element: HTMLElement,
  geometry: SlideObjectGeometryPlan,
) => void;

export type FreeformSizing = "fit" | "min" | "fixed";

function readInlineOrComputedStyle(
  element: HTMLElement,
  property: string,
): string {
  return (
    window.getComputedStyle(element).getPropertyValue(property) ||
    element.style.getPropertyValue(property)
  ).trim();
}

function isImportedPptxObject(element: HTMLElement): boolean {
  return (
    element.hasAttribute("data-imported-pptx") ||
    element.hasAttribute("data-pptx-element-kind") ||
    Array.from(element.classList).some((name) => name.startsWith("fmd-pptx-"))
  );
}

function paintsOwnSlideBox(element: HTMLElement): boolean {
  const background = readInlineOrComputedStyle(element, "background-color");
  const image = readInlineOrComputedStyle(element, "background-image");
  const shadow = readInlineOrComputedStyle(element, "box-shadow");
  return (
    (background !== "" &&
      background !== "transparent" &&
      !/^rgba\(.*,\s*0(?:\.0+)?\)$/.test(background.replace(/\s+/g, " "))) ||
    (image !== "" && image !== "none") ||
    (shadow !== "" && shadow !== "none") ||
    hasVisibleBorder(element)
  );
}

export function isFitTextObject(element: HTMLElement): boolean {
  // A bottom-anchored box keeps its height: with `top` written and no
  // height, `top` + `bottom` would stretch it to the slide edge.
  if (
    hasInlineHeight(element) ||
    hasInlineBottom(element) ||
    isImportedPptxObject(element)
  ) {
    return false;
  }
  if (element.classList.contains("fmd-text-box")) return true;
  return isTextLeaf(element) && !paintsOwnSlideBox(element);
}

export function resolveFreeformSizing(element: HTMLElement): FreeformSizing {
  if (isFitTextObject(element)) return "fit";
  if (
    !hasInlineHeight(element) &&
    !hasInlineBottom(element) &&
    !isImportedPptxObject(element) &&
    element.tagName !== "IMG" &&
    !element.classList.contains("fmd-img-placeholder") &&
    Boolean(element.textContent?.trim()) &&
    paintsOwnSlideBox(element)
  ) {
    return "min";
  }
  return "fixed";
}

export function planSlideObjectGeometry(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
): SlideObjectGeometryPlan {
  if (!isFitTextObject(element)) return geometry;
  return { x: geometry.x, y: geometry.y, width: geometry.width };
}

export function hasFitTextMinHeight(element: HTMLElement): boolean {
  return Number.parseFloat(element.style.getPropertyValue("min-height")) > 0;
}

export function setSlideObjectDimension(
  element: HTMLElement,
  property: "width" | "height",
  value: string,
): void {
  if (element.tagName === "IMG") {
    element.style.setProperty(`max-${property}`, "none", "important");
    element.style.setProperty(property, value, "important");
    return;
  }
  const computed = window.getComputedStyle(element);
  const max = computed.getPropertyValue(`max-${property}`);
  if (max && max !== "none") {
    element.style.setProperty(`max-${property}`, "none");
  }
  if (Number.parseFloat(computed.getPropertyValue(`min-${property}`)) > 0) {
    element.style.setProperty(`min-${property}`, "0px");
  }
  element.style.setProperty(property, value);
}

export function restoreSlideObjectStyle(
  element: HTMLElement,
  style: string | null,
): void {
  if (style === null) element.removeAttribute("style");
  else element.setAttribute("style", style);
}

export interface SlideObjectDomSnapshot {
  className: string;
  style: string | null;
  objectId: string | null;
  contentEditable: string | null;
  editingBlock: string | null;
}

export function restoreSlideObjectDomSnapshot(
  element: HTMLElement,
  snapshot: SlideObjectDomSnapshot,
): void {
  element.className = snapshot.className;
  restoreSlideObjectStyle(element, snapshot.style);
  if (snapshot.contentEditable === null) {
    element.removeAttribute("contenteditable");
  } else {
    element.setAttribute("contenteditable", snapshot.contentEditable);
  }
  if (snapshot.editingBlock === null) {
    element.removeAttribute("data-editing-block");
  } else {
    element.setAttribute("data-editing-block", snapshot.editingBlock);
  }
  if (snapshot.objectId === null) {
    element.removeAttribute("data-slide-object-id");
  } else {
    element.setAttribute("data-slide-object-id", snapshot.objectId);
  }
}

export function createSlideObjectPlacementGeometry(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minSize = MIN_SLIDE_OBJECT_SIZE,
): SlideObjectGeometry {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(Math.abs(end.x - start.x), minSize),
    height: Math.max(Math.abs(end.y - start.y), minSize),
  };
}

export function createSlideLinePlacementGeometry(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thickness = 4,
): SlideObjectGeometry & { rotation: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), thickness);
  return {
    x: (start.x + end.x) / 2 - length / 2,
    y: (start.y + end.y) / 2 - thickness / 2,
    width: length,
    height: thickness,
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

export function clampSlideObjectPlacementPosition(
  geometry: SlideObjectGeometry,
  containerWidth: number,
  containerHeight: number,
  rotation = 0,
): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const renderedWidth = geometry.width * cos + geometry.height * sin;
  const renderedHeight = geometry.width * sin + geometry.height * cos;
  const centerX = geometry.x + geometry.width / 2;
  const centerY = geometry.y + geometry.height / 2;
  const clampedCenterX = Math.max(
    renderedWidth / 2,
    Math.min(centerX, containerWidth - renderedWidth / 2),
  );
  const clampedCenterY = Math.max(
    renderedHeight / 2,
    Math.min(centerY, containerHeight - renderedHeight / 2),
  );
  return {
    x: clampedCenterX - geometry.width / 2,
    y: clampedCenterY - geometry.height / 2,
  };
}

export interface SlideLayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlideObjectLayoutSnapshot {
  display: string;
  flexGrow: string;
  flexShrink: string;
  flexBasis: string;
  alignSelf: string;
}

export interface SlideObjectTextPresentationSnapshot {
  color: string;
  direction: string;
  fontFamily: string;
  fontSize: string;
  fontStyle: string;
  fontWeight: string;
  letterSpacing: string;
  lineHeight: string;
  textAlign: string;
  textDecoration: string;
  textShadow: string;
  textTransform: string;
  whiteSpace: string;
  wordSpacing: string;
}

export interface ResizeOptions {
  handle: ResizeHandle;
  dx: number;
  dy: number;
  preserveAspectRatio: boolean;
  minSize?: number;
}

export type SlidesSelectionMode =
  | "single"
  | "multi"
  | "image"
  | "editing"
  | "box-selected"
  | "resizing"
  | "canvas";

export type SlidesSelectionTool = "select" | "draw" | "pin" | "text" | "shape";

export interface SlidesSelectionState<TItem> {
  deckId?: string;
  slideId: string;
  slideIndex: number;
  slideNumber: number;
  mode: SlidesSelectionMode;
  activeTool: SlidesSelectionTool;
  items: TItem[];
}

export interface SlideSelectionIdentity {
  selector: string;
  runtimeSelector?: string;
  objectId?: string;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function getSlideSelectionIdentity(
  element: HTMLElement,
  runtimeSelector: string,
): SlideSelectionIdentity {
  const objectId = element.getAttribute("data-slide-object-id");
  if (!objectId) return { selector: runtimeSelector };
  return {
    selector: `[data-slide-object-id="${escapeAttributeValue(objectId)}"]`,
    runtimeSelector,
    objectId,
  };
}

export function getSlideSelectionMode(
  element: { isImage: boolean; isAbsolute: boolean },
  override?: SlidesSelectionMode,
): SlidesSelectionMode {
  if (override) return override;
  if (element.isImage) return "image";
  return element.isAbsolute ? "box-selected" : "single";
}

export function createSlidesSelectionState<TItem>({
  deckId,
  slideId,
  slideIndex,
  mode,
  items,
  drawMode,
  pinMode,
  textBoxMode,
  shapeMode = false,
  activeTool,
}: {
  deckId?: string;
  slideId: string;
  slideIndex: number;
  mode: SlidesSelectionMode;
  items: TItem[];
  drawMode: boolean;
  pinMode: boolean;
  textBoxMode: boolean;
  shapeMode?: boolean;
  activeTool?: SlidesSelectionTool;
}): SlidesSelectionState<TItem> {
  return {
    deckId,
    slideId,
    slideIndex,
    slideNumber: slideIndex + 1,
    mode,
    activeTool:
      activeTool ??
      (drawMode
        ? "draw"
        : pinMode
          ? "pin"
          : textBoxMode
            ? "text"
            : shapeMode
              ? "shape"
              : "select"),
    items,
  };
}

export function createSlideObjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slide-object-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ensureSlideObjectId(element: HTMLElement): string {
  const existing = element.getAttribute("data-slide-object-id");
  if (existing) return existing;
  const id = createSlideObjectId();
  element.setAttribute("data-slide-object-id", id);
  return id;
}

export function findSlideObjectById(
  root: HTMLElement,
  objectId: string,
): HTMLElement | null {
  return (
    Array.from(
      root.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ).find(
      (element) => element.getAttribute("data-slide-object-id") === objectId,
    ) ?? null
  );
}

export function isLayoutSpacer(element: Element): boolean {
  return (
    element.classList.contains("fmd-layout-spacer") ||
    element.hasAttribute("data-slide-layout-spacer-for")
  );
}

export interface SlideSelectionAnchor {
  objectId: string | null;
  path: number[];
}

// Indexes skip layout spacers so inserting one beside an element never moves it.
export function resolveSelectionIdentity(
  element: HTMLElement,
  root: HTMLElement,
): SlideSelectionAnchor {
  const path: number[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return { objectId: null, path: [] };
    path.unshift(
      Array.from(parent.children)
        .filter((child) => !isLayoutSpacer(child))
        .indexOf(current),
    );
    current = parent;
  }
  return { objectId: element.getAttribute("data-slide-object-id"), path };
}

export function resolveSlideSelectionAnchor(
  root: HTMLElement,
  { objectId, path }: SlideSelectionAnchor,
): HTMLElement | null {
  if (objectId) {
    const object = findSlideObjectById(root, objectId);
    if (object) return object;
  }
  let current: Element | null = root;
  for (const index of path) {
    current =
      Array.from(current?.children ?? []).filter(
        (child) => !isLayoutSpacer(child),
      )[index] ?? null;
    if (!current) return null;
  }
  return current instanceof HTMLElement ? current : null;
}

function establishesSlideObjectContainingBlock(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const position = style.position || "static";
  const hasTransform = Boolean(style.transform && style.transform !== "none");
  const hasPerspective = Boolean(
    style.perspective && style.perspective !== "none",
  );
  const hasFilter = Boolean(style.filter && style.filter !== "none");
  const containment = style.contain ?? "";
  const hasContainment = ["layout", "paint", "strict", "content"].some(
    (value) => containment.split(/\s+/).includes(value),
  );
  const isSet = (property: string, ...inert: string[]) => {
    const value = readInlineOrComputedStyle(element, property);
    return value !== "" && !["none", ...inert].includes(value);
  };
  const willChange = readInlineOrComputedStyle(element, "will-change")
    .split(/\s*,\s*/)
    .some((property) =>
      ["transform", "filter", "perspective", "backdrop-filter"].includes(
        property,
      ),
    );

  return (
    position !== "static" ||
    hasTransform ||
    hasPerspective ||
    hasFilter ||
    hasContainment ||
    isSet("backdrop-filter") ||
    isSet("-webkit-backdrop-filter") ||
    willChange ||
    isSet("translate") ||
    isSet("rotate") ||
    isSet("scale") ||
    isSet("container-type", "normal") ||
    isSet("content-visibility", "visible")
  );
}

// `left`/`top` resolve against the padding box, so a bordered containing block
// would otherwise shift the object by its border width on the first frame.
export function clientPointToContainingBlockOffset(
  clientX: number,
  clientY: number,
  containingBlock: HTMLElement,
): { x: number; y: number } {
  const point = clientPointToSlideCoordinates(
    clientX,
    clientY,
    containingBlock.getBoundingClientRect(),
    containingBlock.offsetWidth,
    containingBlock.offsetHeight,
  );
  return {
    x: point.x - containingBlock.clientLeft,
    y: point.y - containingBlock.clientTop,
  };
}

/**
 * How far the element's own transform carries its layout box centre, in its
 * parent's coordinates. A transform-origin off the centre makes this non-zero
 * even for a pure rotation. Null when the transform is not a readable 2D matrix
 * or the origin is not a value we can resolve.
 */
function ownTransformCentreShift(
  element: HTMLElement,
  { transform, transformOrigin }: SlideObjectTransformSnapshot,
): { x: number; y: number } | null {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const matrix = readSlideObjectTransformMatrix(
    { x: 0, y: 0, width, height },
    transform,
  );
  const origin = parseSlideObjectTransformOrigin(transformOrigin)?.(
    width,
    height,
  );
  if (!matrix || !origin) return null;
  const [a, b, c, d, tx, ty] = matrix;
  const x = width / 2 - origin.x;
  const y = height / 2 - origin.y;
  return { x: a * x + c * y + tx - x, y: b * x + d * y + ty - y };
}

/**
 * The left/top/width/height that reproduce `rect` (an element's client
 * bounding rect) once the element is absolute inside `containingBlock`. When
 * the element or an ancestor transforms, the rect is only the hull of the
 * painted box, so its centre is mapped through the block's probed basis, moved
 * back by the element's own transform, and the size comes from the layout box.
 * Null when the block has no invertible mapping to the screen or the element's
 * transform cannot be read.
 */
export function clientRectToContainingBlockBox(
  rect: DOMRect,
  element: HTMLElement,
  containingBlock: HTMLElement,
  slideCanvas: HTMLElement,
): { x: number; y: number; width: number; height: number } | null {
  const ownTransform = readSlideObjectTransformSnapshot(element);
  const hasOwnTransform = ownTransform.transform !== "none";
  if (hasOwnTransform || hasRotatedAncestor(element, slideCanvas)) {
    const frame = probeScreenFrame(containingBlock);
    const shift = hasOwnTransform
      ? ownTransformCentreShift(element, ownTransform)
      : { x: 0, y: 0 };
    if (!frame || !shift) return null;
    const local = screenDeltaToLocal(frame.basis, {
      x: rect.left + rect.width / 2 - frame.origin.x,
      y: rect.top + rect.height / 2 - frame.origin.y,
    });
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    return {
      x: local.x - shift.x - width / 2,
      y: local.y - shift.y - height / 2,
      width,
      height,
    };
  }
  const layerRect = containingBlock.getBoundingClientRect();
  const { x, y } = clientPointToContainingBlockOffset(
    rect.left,
    rect.top,
    containingBlock,
  );
  return {
    x,
    y,
    width: Math.round(
      rect.width * (containingBlock.offsetWidth / layerRect.width),
    ),
    height: Math.round(
      rect.height * (containingBlock.offsetHeight / layerRect.height),
    ),
  };
}

function findSlideObjectContainingBlock(
  ancestor: HTMLElement | null,
  fallback: HTMLElement,
): HTMLElement {
  while (ancestor) {
    if (establishesSlideObjectContainingBlock(ancestor)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return fallback;
}

export function resolveSlideObjectContainingBlock(
  element: HTMLElement,
  slideLayer: HTMLElement,
): HTMLElement {
  return findSlideObjectContainingBlock(element.parentElement, slideLayer);
}

export function resolveSlideObjectInsertionContainingBlock(
  positioningLayer: HTMLElement,
): HTMLElement {
  return findSlideObjectContainingBlock(positioningLayer, positioningLayer);
}

export interface SlideTextBoxCanvas {
  fmdSlide: HTMLElement;
  positioningLayer: HTMLElement;
}

export function ensureSlideTextBoxCanvas(
  editorRoot: HTMLElement,
): SlideTextBoxCanvas | null {
  const existing = editorRoot.querySelector<HTMLElement>(".fmd-slide");
  if (existing) {
    const positioningLayer =
      Array.from(existing.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute("data-fmd-autofit-content"),
      ) ?? existing;
    return { fmdSlide: existing, positioningLayer };
  }

  const slideContents = Array.from(
    editorRoot.querySelectorAll<HTMLElement>(".slide-content"),
  );
  if (slideContents.length !== 1) return null;
  const slideContent = slideContents[0];
  const canvas = slideContent?.closest<HTMLElement>("[data-slide-canvas]");
  if (!slideContent || !canvas) return null;

  const canvasStyle = window.getComputedStyle(canvas);
  const fmdSlide = document.createElement("div");
  fmdSlide.className = "fmd-slide";
  fmdSlide.style.justifyContent = canvasStyle.justifyContent;
  fmdSlide.style.alignItems = canvasStyle.alignItems;
  fmdSlide.style.padding = canvasStyle.padding;
  fmdSlide.style.textAlign = canvasStyle.textAlign;
  fmdSlide.style.color = canvasStyle.color;
  fmdSlide.style.fontFamily = canvasStyle.fontFamily;
  fmdSlide.append(...Array.from(slideContent.childNodes));
  slideContent.append(fmdSlide);

  return { fmdSlide, positioningLayer: fmdSlide };
}

function hasUsableTextColor(color: string) {
  return (
    Boolean(color) &&
    color !== "transparent" &&
    !/rgba\([^)]*,\s*0\)$/.test(color)
  );
}

function isTextRun(element: HTMLElement) {
  return Boolean(element.textContent?.trim());
}

function isDarkColor(color: string) {
  const channels = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!channels) return false;
  const [, red, green, blue] = channels.map(Number);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 140;
}

export function getSlideTextBoxDefaultColor(
  target: HTMLElement | null,
  positioningLayer: HTMLElement,
): string {
  const candidates = [
    ...Array.from(
      positioningLayer.querySelectorAll<HTMLElement>(
        "h1, h2, h3, h4, h5, h6, p, li, span",
      ),
    ).filter(isTextRun),
    target?.matches("h1, h2, h3, h4, h5, h6, p, li, span") && isTextRun(target)
      ? target
      : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const color = window.getComputedStyle(candidate).color;
    if (hasUsableTextColor(color)) {
      return color;
    }
  }

  // A slide with no text yet still declares its ink on the slide root; the
  // fallback below only knows the canvas, which a dark slide does not paint.
  const slideRoot = positioningLayer.closest<HTMLElement>(".fmd-slide");
  if (slideRoot) {
    const ink =
      slideRoot.style.getPropertyValue("--deck-ink").trim() ||
      window.getComputedStyle(slideRoot).getPropertyValue("--deck-ink").trim();
    if (ink) return ink;
    const rootColor = slideRoot.style.color;
    if (hasUsableTextColor(rootColor)) return rootColor;
  }

  const canvas = positioningLayer.closest<HTMLElement>("[data-slide-canvas]");
  const canvasStyle = canvas ? window.getComputedStyle(canvas) : null;
  const designSystemText = canvasStyle?.getPropertyValue("--ds-text").trim();
  if (designSystemText) return designSystemText;

  const background = canvasStyle?.backgroundColor ?? "";
  return isDarkColor(background) ? "#ffffff" : "#111827";
}

export function removeTransientBuilderIds(element: HTMLElement): void {
  element.removeAttribute("data-builder-id");
  element.querySelectorAll("[data-builder-id]").forEach((node) => {
    node.removeAttribute("data-builder-id");
  });
}

export function stripTransientSlideLayoutSpacers(root: Element): void {
  root
    .querySelectorAll(".fmd-layout-spacer:not([data-slide-layout-preserved])")
    .forEach((spacer) => spacer.remove());
}

const ID_REFERENCE_ATTRIBUTES = [
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createSlideObjectDomId(occupiedIds: Set<string>): string {
  let id = `slide-object-dom-${createSlideObjectId()}`;
  while (occupiedIds.has(id)) {
    id = `slide-object-dom-${createSlideObjectId()}`;
  }
  occupiedIds.add(id);
  return id;
}

function remintSlideObjectDomIds(
  element: HTMLElement,
  occupiedIds: Set<string> = new Set(
    Array.from(element.ownerDocument.querySelectorAll<HTMLElement>("[id]")).map(
      (node) => node.id,
    ),
  ),
): void {
  const idMap = new Map<string, string>();
  const elements = [element, ...element.querySelectorAll<HTMLElement>("[id]")];

  for (const node of elements) {
    const id = node.getAttribute("id");
    if (!id) continue;
    const remintedId = createSlideObjectDomId(occupiedIds);
    if (!idMap.has(id)) idMap.set(id, remintedId);
    node.id = remintedId;
  }

  if (idMap.size === 0) return;

  const remapIdReferences = (value: string): string =>
    value
      .split(/\s+/)
      .map((id) => idMap.get(id) ?? id)
      .join(" ");
  const remapUrlReferences = (value: string): string => {
    let result = value;
    for (const [id, remintedId] of idMap) {
      result = result.replace(
        new RegExp(`url\\(\\s*#${escapeRegExp(id)}\\s*\\)`, "g"),
        `url(#${remintedId})`,
      );
    }
    return result;
  };

  for (const node of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
    const labelFor = node.getAttribute("for");
    if (labelFor) node.setAttribute("for", idMap.get(labelFor) ?? labelFor);

    for (const attribute of ID_REFERENCE_ATTRIBUTES) {
      const value = node.getAttribute(attribute);
      if (value) node.setAttribute(attribute, remapIdReferences(value));
    }

    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name === "id") continue;
      if (attribute.name === "href" || attribute.name === "xlink:href") {
        const remintedId = attribute.value.startsWith("#")
          ? idMap.get(attribute.value.slice(1))
          : undefined;
        if (remintedId) node.setAttribute(attribute.name, `#${remintedId}`);
        continue;
      }
      const remapped = remapUrlReferences(attribute.value);
      if (remapped !== attribute.value) {
        node.setAttribute(attribute.name, remapped);
      }
    }
  }
}

export function cloneSlideObject(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  removeTransientBuilderIds(clone);
  remintSlideObjectDomIds(clone);
  const idMap = new Map<string, string>();
  for (const node of [
    clone,
    ...clone.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
  ]) {
    const fresh = createSlideObjectId();
    const previous = node.getAttribute("data-slide-object-id");
    if (previous) idMap.set(previous, fresh);
    node.setAttribute("data-slide-object-id", fresh);
  }
  // A preserved layout spacer is keyed to its object's id; left alone, the
  // copy's spacer would belong to the original and deleting either would
  // remove or orphan the other's gap.
  clone
    .querySelectorAll<HTMLElement>("[data-slide-layout-spacer-for]")
    .forEach((spacer) => {
      const owner = idMap.get(
        spacer.getAttribute("data-slide-layout-spacer-for") ?? "",
      );
      if (owner) spacer.setAttribute("data-slide-layout-spacer-for", owner);
    });
  return clone;
}

function viewportScale(element: Element | null): { x: number; y: number } {
  if (!(element instanceof HTMLElement)) return { x: 1, y: 1 };
  const rect = element.getBoundingClientRect();
  return {
    x: element.offsetWidth ? rect.width / element.offsetWidth || 1 : 1,
    y: element.offsetHeight ? rect.height / element.offsetHeight || 1 : 1,
  };
}

function readAnchoredInsets(element: HTMLElement) {
  const position = element.style.getPropertyValue("position");
  const priority = element.style.getPropertyPriority("position");
  element.style.setProperty("position", "static", "important");
  const specified = window.getComputedStyle(element);
  const isSet = (side: string) => {
    const value = specified.getPropertyValue(side);
    return value !== "" && value !== "auto";
  };
  const anchors = {
    left: isSet("left"),
    right: isSet("right"),
    top: isSet("top"),
    bottom: isSet("bottom"),
  };
  if (position) element.style.setProperty("position", position, priority);
  else element.style.removeProperty("position");
  return anchors;
}

function restoreViewportPosition(element: HTMLElement, before: DOMRect): void {
  const anchors = readAnchoredInsets(element);
  const after = element.getBoundingClientRect();
  const scale = viewportScale(element.offsetParent);
  const style = window.getComputedStyle(element);
  const shift = (side: "left" | "top" | "right" | "bottom", delta: number) => {
    const value = Number.parseFloat(style.getPropertyValue(side));
    if (Number.isFinite(value)) {
      element.style.setProperty(side, `${Math.round(value + delta)}px`);
    }
  };
  const dLeft = (after.left - before.left) / scale.x;
  const dRight = (after.right - before.right) / scale.x;
  const dTop = (after.top - before.top) / scale.y;
  const dBottom = (after.bottom - before.bottom) / scale.y;
  if ((anchors.left || !anchors.right) && dLeft) shift("left", -dLeft);
  if (anchors.right && dRight) shift("right", dRight);
  if ((anchors.top || !anchors.bottom) && dTop) shift("top", -dTop);
  if (anchors.bottom && dBottom) shift("bottom", dBottom);
}

export function keepAbsoluteDescendantsInPlace(
  element: HTMLElement,
  position: () => void,
): () => void {
  const descendants = Array.from(
    element.querySelectorAll<HTMLElement>("*"),
  ).filter((descendant) => {
    if (window.getComputedStyle(descendant).position !== "absolute") {
      return false;
    }
    const containingBlock = descendant.offsetParent;
    return !containingBlock || !element.contains(containingBlock);
  });
  const styles = descendants.map((descendant) =>
    descendant.getAttribute("style"),
  );
  const before = descendants.map((descendant) =>
    descendant.getBoundingClientRect(),
  );
  position();
  descendants.forEach((descendant, index) =>
    restoreViewportPosition(descendant, before[index]!),
  );
  return () =>
    descendants.forEach((descendant, index) =>
      restoreSlideObjectStyle(descendant, styles[index]!),
    );
}

export function releaseSlideObjectFromLeftBoxes(
  element: HTMLElement,
  layer: HTMLElement,
): boolean {
  const parent = element.parentElement;
  if (
    !parent ||
    parent === layer ||
    !layer.contains(parent) ||
    parent.classList.contains("fmd-slide-group") ||
    SLIDE_CLIPBOARD_STRUCTURAL_CHILDREN.has(element.tagName)
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let home: HTMLElement | null = parent;
  while (home && home !== layer) {
    const box = home.getBoundingClientRect();
    const containsCenter =
      centerX >= box.left &&
      centerX <= box.right &&
      centerY >= box.top &&
      centerY <= box.bottom;
    if (containsCenter && canDropSlideLayerInside(home, element)) break;
    home = home.parentElement;
  }
  if (!home || home === parent) return false;
  home.append(element);
  // The spacer belongs to the original flow slot and survives reparenting.
  restoreViewportPosition(element, rect);
  return true;
}

export function freezeSlideElementForFreeform(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
  layout: SlideObjectLayoutSnapshot,
  textPresentation?: SlideObjectTextPresentationSnapshot,
  { sizing = "fixed" }: { sizing?: FreeformSizing } = {},
): HTMLElement {
  const objectId = ensureSlideObjectId(element);
  const spacer = element.cloneNode(false) as HTMLElement;
  removeTransientBuilderIds(spacer);
  for (const className of Array.from(spacer.classList)) {
    if (className.startsWith("fmd-pptx-")) spacer.classList.remove(className);
  }
  for (const attribute of Array.from(spacer.attributes)) {
    if (
      attribute.name === "data-imported-pptx" ||
      attribute.name.startsWith("data-pptx-")
    ) {
      spacer.removeAttribute(attribute.name);
    }
  }
  spacer.removeAttribute("id");
  spacer.removeAttribute("data-slide-object-id");
  spacer.removeAttribute("contenteditable");
  spacer.removeAttribute("data-editing-block");
  spacer.classList.add("fmd-layout-spacer");
  spacer.setAttribute("data-slide-layout-spacer-for", objectId);
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.visibility = "hidden";
  spacer.style.pointerEvents = "none";
  spacer.style.userSelect = "none";
  spacer.style.boxSizing = "border-box";
  spacer.style.width = `${geometry.width}px`;
  spacer.style.height = `${geometry.height}px`;
  spacer.style.minWidth = "0";
  spacer.style.minHeight = "0";
  spacer.style.maxWidth = "none";
  spacer.style.maxHeight = "none";
  spacer.style.flexGrow = "0";
  spacer.style.flexShrink = "0";
  spacer.style.flexBasis = "auto";
  spacer.style.alignSelf = layout.alignSelf;
  spacer.style.display =
    layout.display === "inline" ? "inline-block" : layout.display;

  element.before(spacer);
  element.classList.add("fmd-freeform-object");
  element.style.position = "absolute";
  element.style.left = `${geometry.x}px`;
  element.style.top = `${geometry.y}px`;
  element.style.width = `${geometry.width}px`;
  if (sizing === "fixed") element.style.height = `${geometry.height}px`;
  if (sizing === "min") element.style.minHeight = `${geometry.height}px`;
  // A flow block edited in place keeps `contain: size`; carried onto a box
  // that sizes itself it would freeze the height at the pre-edit size.
  if (sizing !== "fixed") stripFreeformReservation(element);
  element.style.boxSizing = "border-box";
  element.style.margin = "0";
  if (textPresentation) {
    const properties: Array<
      [keyof SlideObjectTextPresentationSnapshot, string]
    > = [
      ["color", "color"],
      ["direction", "direction"],
      ["fontFamily", "font-family"],
      ["fontSize", "font-size"],
      ["fontStyle", "font-style"],
      ["fontWeight", "font-weight"],
      ["letterSpacing", "letter-spacing"],
      ["lineHeight", "line-height"],
      ["textAlign", "text-align"],
      ["textDecoration", "text-decoration"],
      ["textShadow", "text-shadow"],
      ["textTransform", "text-transform"],
      ["whiteSpace", "white-space"],
      ["wordSpacing", "word-spacing"],
    ];
    for (const [key, property] of properties) {
      if (textPresentation[key] && !element.style.getPropertyValue(property)) {
        element.style.setProperty(property, textPresentation[key]);
      }
    }
  }
  return spacer;
}

export function preserveSlideObjectLayoutSpacer(element: HTMLElement): void {
  const objectId = element.getAttribute("data-slide-object-id");
  if (!objectId) return;
  const owner = element.parentElement ?? element.ownerDocument;
  for (const spacer of Array.from(
    owner.querySelectorAll<HTMLElement>("[data-slide-layout-spacer-for]"),
  )) {
    if (spacer.getAttribute("data-slide-layout-spacer-for") !== objectId) {
      continue;
    }
    spacer.setAttribute("data-slide-layout-preserved", "true");
  }
}

/** Drop the hidden spacer that reserves `element`'s slot in flow layout. */
export function removeSlideObjectLayoutSpacer(
  element: HTMLElement,
  owner: ParentNode = element.parentElement ?? element.ownerDocument,
): void {
  const objectId = element.getAttribute("data-slide-object-id");
  if (!objectId) return;
  for (const spacer of Array.from(
    owner.querySelectorAll<HTMLElement>("[data-slide-layout-spacer-for]"),
  )) {
    if (spacer.getAttribute("data-slide-layout-spacer-for") === objectId) {
      spacer.remove();
    }
  }
}

function preserveSlideElementLayoutSlot(element: HTMLElement): void {
  const computed = window.getComputedStyle(element);
  freezeSlideElementForFreeform(
    element,
    {
      x: 0,
      y: 0,
      width: element.offsetWidth,
      height: element.offsetHeight,
    },
    {
      display: computed.display,
      flexGrow: computed.flexGrow,
      flexShrink: computed.flexShrink,
      flexBasis: computed.flexBasis,
      alignSelf: computed.alignSelf,
    },
  );
  preserveSlideObjectLayoutSpacer(element);
  element.remove();
}

export function removeSlideObjectAndLayoutSpacer(
  element: HTMLElement,
  { preserveLayoutSlot = false }: { preserveLayoutSlot?: boolean } = {},
): void {
  if (
    preserveLayoutSlot &&
    window.getComputedStyle(element).position !== "absolute"
  ) {
    preserveSlideElementLayoutSlot(element);
    return;
  }
  removeSlideObjectLayoutSpacer(
    element,
    element.closest<HTMLElement>(".fmd-slide, [data-slide-canvas]") ??
      element.parentElement ??
      element.ownerDocument,
  );
  element.remove();
}

export function isDeletableSlideElement(element: HTMLElement): boolean {
  return (
    !element.classList.contains("fmd-layout-spacer") &&
    !element.classList.contains("fmd-slide") &&
    !element.classList.contains("fmd-autofit-scale") &&
    !element.hasAttribute("data-fmd-autofit-content") &&
    !element.hasAttribute("data-slide-canvas")
  );
}

export function isDeletableFlowImage(element: HTMLElement): boolean {
  return (
    element.tagName === "IMG" ||
    element.classList.contains("fmd-img-placeholder")
  );
}

export function findPersistedImageObject(
  element: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current && current !== root && root.contains(current)) {
    const isImageWrapper =
      current.classList.contains("fmd-pptx-image") ||
      current.getAttribute("data-pptx-element-kind") === "image";
    if (isImageWrapper && current.getAttribute("data-slide-object-id")) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

const TRANSFORM_PROPERTIES = ["transform", "translate", "rotate", "scale"];
const TRANSFORM_TRANSITION_PROPERTIES = new Set([
  ...TRANSFORM_PROPERTIES,
  "transform-origin",
]);
const CSS_VAR_REFERENCE = /var\(\s*(--(?:[\w-]|[^\u0000-\u007f])+)/giu;
const FONT_RELATIVE_LENGTH =
  /(?:\d+(?:\.\d*)?|\.\d+)(?:em|ex|ch|cap|ic|lh)\b/iu;
const LINE_HEIGHT_RELATIVE_LENGTH = /(?:\d+(?:\.\d*)?|\.\d+)lh\b/iu;

// A value that reads the element's own cascade (a custom property its class
// defines, a length against its font size) means something else on a frame.
const READS_OWN_CASCADE = /var\(|\d(?:em|ex|ch|lh|cap|ic)\b/i;

const ANIMATION_LONGHANDS = [
  "animation-name",
  "animation-duration",
  "animation-timing-function",
  "animation-delay",
  "animation-iteration-count",
  "animation-direction",
  "animation-fill-mode",
  "animation-play-state",
  "animation-composition",
  "animation-timeline",
  "animation-range-start",
  "animation-range-end",
];

// Valid and unlike anything an author writes, so a plain inline write of one
// paints only when nothing in the cascade beats a plain inline declaration.
const TRANSFORM_PROBES: Record<string, string> = {
  transform: "translate(0.37px, 0.53px)",
  translate: "0.37px 0.53px",
  rotate: "0.37deg",
  scale: "1.37",
  "transform-origin": "37% 53%",
};

/**
 * Whether `value` as the inline `property` of `element` is what paints, rather
 * than sitting in the style attribute under a declaration that wins: a
 * stylesheet !important rule or a running animation beats a plain inline value.
 * It compares what a plain write paints with what the same write made
 * !important paints, which beats both, and puts the style attribute back.
 * Transitions are off meanwhile: one started by the !important write would
 * still read as the old value.
 */
function inlineValuePaints(
  element: HTMLElement,
  property: string,
  value = element.style.getPropertyValue(property),
): boolean {
  const { style } = element;
  if (!value) return false;
  if (
    style.getPropertyPriority(property) === "important" &&
    value === style.getPropertyValue(property)
  ) {
    return true;
  }
  const saved = element.getAttribute("style");
  const kept = [
    style.getPropertyValue(property),
    style.getPropertyPriority(property),
  ] as const;
  const computed = window.getComputedStyle(element);
  try {
    style.setProperty("transition", "none", "important");
    style.setProperty(property, value);
    const plain = computed.getPropertyValue(property);
    style.setProperty(property, value, "important");
    return computed.getPropertyValue(property) === plain;
  } finally {
    style.setProperty(property, ...kept);
    // Settled before `transition` returns: put back together, they would start
    // a transition from the probe's value.
    computed.getPropertyValue(property);
    restoreStyleAttribute(element, saved);
  }
}

function restoreStyleAttribute(element: HTMLElement, style: string | null) {
  if (style === null) element.removeAttribute("style");
  else element.setAttribute("style", style);
}

function readCssAnimations(element: HTMLElement): CSSAnimation[] {
  // The unit-test DOM has no Web Animations API.
  if (typeof element.getAnimations !== "function") return [];
  return element
    .getAnimations()
    .filter(
      (animation): animation is CSSAnimation =>
        animation instanceof CSSAnimation,
    );
}

export type SlideObjectAnimationSnapshot = Array<{
  path: number[];
  name: string;
  occurrence: number;
  currentTime: CSSNumberish | null;
  playState: AnimationPlayState;
}>;

function elementPath(root: HTMLElement, element: HTMLElement): number[] | null {
  const path: number[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    path.unshift(Array.from(parent.children).indexOf(current));
    current = parent;
  }
  return current === root ? path : null;
}

function elementAtPath(root: HTMLElement, path: number[]): HTMLElement | null {
  let current: HTMLElement = root;
  for (const index of path) {
    const child = current.children.item(index);
    if (!(child instanceof HTMLElement)) return null;
    current = child;
  }
  return current;
}

export function captureSlideObjectAnimationState(
  root: HTMLElement,
): SlideObjectAnimationSnapshot {
  const snapshot: SlideObjectAnimationSnapshot = [];
  const elements = [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>("*")),
  ];
  for (const element of elements) {
    const path = elementPath(root, element);
    if (!path) continue;
    const occurrences = new Map<string, number>();
    for (const animation of readCssAnimations(element)) {
      const name = animation.animationName;
      const occurrence = occurrences.get(name) ?? 0;
      occurrences.set(name, occurrence + 1);
      snapshot.push({
        path,
        name,
        occurrence,
        currentTime: animation.currentTime,
        playState: animation.playState,
      });
    }
  }
  return snapshot;
}

export function restoreSlideObjectAnimationState(
  root: HTMLElement,
  snapshot: SlideObjectAnimationSnapshot,
): void {
  const byPath = new Map<string, typeof snapshot>();
  for (const state of snapshot) {
    const key = state.path.join(".");
    const states = byPath.get(key) ?? [];
    states.push(state);
    byPath.set(key, states);
  }
  for (const states of byPath.values()) {
    const element = elementAtPath(root, states[0]!.path);
    if (!element) continue;
    // Make CSSAnimation instances for restored declarations available before
    // looking them up. Replacing a crop wrapper recreates these instances.
    void window.getComputedStyle(element).animationName;
    const animations = readCssAnimations(element);
    for (const state of states) {
      const animation = animations.filter(
        (item) => item.animationName === state.name,
      )[state.occurrence];
      if (!animation) continue;
      if (state.currentTime !== null) animation.currentTime = state.currentTime;
      if (state.playState === "running") animation.play();
      else if (state.playState === "paused") animation.pause();
      else if (state.playState === "finished") animation.finish();
      else animation.cancel();
    }
  }
}

type InlineStyleDeclaration = {
  property: string;
  value: string;
  priority: string;
};

function captureInlineTransitions(
  element: HTMLElement,
): InlineStyleDeclaration[] {
  return Array.from({ length: element.style.length }, (_, index) =>
    element.style.item(index),
  )
    .filter((property) => /^transition(?:-|$)/.test(property))
    .map((property) => ({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    }));
}

function restoreInlineTransitions(
  element: HTMLElement,
  declarations: InlineStyleDeclaration[],
): void {
  for (const property of Array.from(
    { length: element.style.length },
    (_, index) => element.style.item(index),
  )) {
    if (/^transition(?:-|$)/.test(property))
      element.style.removeProperty(property);
  }
  for (const { property, value, priority } of declarations) {
    element.style.setProperty(property, value, priority);
  }
}

function restoreInlineTransitionsAfterTransformSettles(
  element: HTMLElement,
  declarations: InlineStyleDeclaration[],
): void {
  element.style.setProperty("transition", "none", "important");
  window.getComputedStyle(element).getPropertyValue("transform");
  restoreInlineTransitions(element, declarations);
}

type CopiedTransition = {
  animation: Animation;
  target: HTMLElement;
  cancel: () => void;
};

type TemporaryInlineStyleOverride = {
  element: HTMLElement;
  property: string;
  originalValue: string;
  originalPriority: string;
  temporaryValue: string;
  temporaryPriority: string;
  animationTarget: HTMLElement;
  active: boolean;
};

function writeInlineStyleDeclaration(
  element: HTMLElement,
  property: string,
  value: string,
  priority: string,
): void {
  if (value) element.style.setProperty(property, value, priority);
  else element.style.removeProperty(property);
}

function restoreTemporaryInlineStyleOverride(
  override: TemporaryInlineStyleOverride,
): void {
  if (!override.active) return;
  override.active = false;
  if (
    override.element.style.getPropertyValue(override.property) ===
      override.temporaryValue &&
    override.element.style.getPropertyPriority(override.property) ===
      override.temporaryPriority
  ) {
    writeInlineStyleDeclaration(
      override.element,
      override.property,
      override.originalValue,
      override.originalPriority,
    );
  }
}

function serializeWithRestoredInlineStyleOverrides(
  overrides: TemporaryInlineStyleOverride[],
  serialize: () => string | null,
): string | null {
  const active = overrides.filter(
    (override) =>
      override.active &&
      override.element.style.getPropertyValue(override.property) ===
        override.temporaryValue &&
      override.element.style.getPropertyPriority(override.property) ===
        override.temporaryPriority,
  );
  for (const override of active) {
    writeInlineStyleDeclaration(
      override.element,
      override.property,
      override.originalValue,
      override.originalPriority,
    );
  }
  try {
    return serialize();
  } finally {
    for (const override of active) {
      if (
        override.active &&
        override.element.style.getPropertyValue(override.property) ===
          override.originalValue &&
        override.element.style.getPropertyPriority(override.property) ===
          override.originalPriority
      ) {
        writeInlineStyleDeclaration(
          override.element,
          override.property,
          override.temporaryValue,
          override.temporaryPriority,
        );
      }
    }
  }
}

function reapplyTemporaryInlineStyleOverrides(
  overrides: TemporaryInlineStyleOverride[],
  animationTarget: HTMLElement,
): void {
  for (const override of overrides) {
    if (override.active && override.animationTarget === animationTarget) {
      writeInlineStyleDeclaration(
        override.element,
        override.property,
        override.temporaryValue,
        override.temporaryPriority,
      );
    }
  }
}

type TransitionSnapshot = {
  property: string;
  keyframes: Keyframe[];
  timing: EffectTiming;
  playbackRate: number;
  currentTime: CSSNumberish | null;
  playState: AnimationPlayState;
};

function snapshotTransition(
  transition: Animation,
  property: string,
): TransitionSnapshot | null {
  const effect = transition.effect;
  if (!(effect instanceof KeyframeEffect)) return null;
  return {
    property,
    keyframes: effect.getKeyframes(),
    timing: effect.getTiming(),
    playbackRate: transition.playbackRate,
    currentTime: transition.currentTime,
    playState: transition.playState,
  };
}

function copyTransitionEffect(
  transition: TransitionSnapshot,
  element: HTMLElement,
  options: {
    underlyingValue?: string;
    restoreImportant?: boolean;
    onCleanup?: () => void;
    temporaryStyleOverrides?: TemporaryInlineStyleOverride[];
  } = {},
): CopiedTransition | null {
  const { property } = transition;
  const originalValue = element.style.getPropertyValue(property);
  const originalPriority = element.style.getPropertyPriority(property);
  const underlyingValue = options.underlyingValue ?? originalValue;
  const temporaryPriority =
    originalPriority === "important" ? "" : originalPriority;
  const importantOverride: TemporaryInlineStyleOverride | null =
    originalPriority === "important" && options.restoreImportant !== false
      ? {
          element,
          property,
          originalValue,
          originalPriority,
          temporaryValue: underlyingValue,
          temporaryPriority,
          animationTarget: element,
          active: true,
        }
      : null;
  if (importantOverride) {
    options.temporaryStyleOverrides?.push(importantOverride);
  }
  if (
    options.underlyingValue !== undefined ||
    temporaryPriority !== originalPriority
  ) {
    element.style.setProperty(property, underlyingValue, temporaryPriority);
  }

  const animation = element.animate(transition.keyframes, transition.timing);
  animation.id = `${CROP_TRANSITION_ANIMATION_ID_PREFIX}${property}`;
  animation.playbackRate = transition.playbackRate;
  if (transition.currentTime !== null) {
    animation.currentTime = transition.currentTime;
  }
  if (transition.playState === "paused") animation.pause();

  let cleanedUp = false;
  const restoreImportant = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (importantOverride)
      restoreTemporaryInlineStyleOverride(importantOverride);
    options.onCleanup?.();
  };
  const cancel = () => {
    animation.cancel();
    restoreImportant();
  };
  void animation.finished.then(cancel, restoreImportant);
  return { animation, target: element, cancel };
}

function transitionTargetValue(transition: TransitionSnapshot): string | null {
  let target: string | null = null;
  for (const frame of transition.keyframes) {
    const value = keyframeValue(frame, transition.property);
    if (value === null) continue;
    target = value;
    const record = frame as Keyframe & { computedOffset?: number };
    if (record.offset === 1 || record.computedOffset === 1) return value;
  }
  return target;
}

/**
 * CSS transitions have higher cascade priority than Web Animations, so clone
 * unrelated in-flight transitions before disabling the source's transition
 * declarations. The copies keep effects such as opacity and filter moving while
 * the crop frame takes over transform.
 */
function preserveUnrelatedTransitions(
  element: HTMLElement,
  frame: HTMLElement,
  transitions: TransitionSnapshot[],
  copies: CopiedTransition[],
  temporaryStyleOverrides: TemporaryInlineStyleOverride[],
): void {
  for (const transition of transitions) {
    const { property } = transition;
    if (
      TRANSFORM_TRANSITION_PROPERTIES.has(property) ||
      transition.playState === "finished"
    ) {
      continue;
    }
    if (
      property === "opacity" &&
      hasMatchingImportantStyleRule(element, property)
    ) {
      const originalValue = element.style.getPropertyValue(property);
      const originalPriority = element.style.getPropertyPriority(property);
      const override: TemporaryInlineStyleOverride = {
        element,
        property,
        originalValue,
        originalPriority,
        temporaryValue: "1",
        temporaryPriority: "important",
        animationTarget: frame,
        active: true,
      };
      temporaryStyleOverrides.push(override);
      element.style.setProperty(property, override.temporaryValue, "important");
      const copy = copyTransitionEffect(transition, frame, {
        onCleanup: () => restoreTemporaryInlineStyleOverride(override),
        temporaryStyleOverrides,
      });
      if (copy) copies.push(copy);
      else restoreTemporaryInlineStyleOverride(override);
      continue;
    }
    const copy = copyTransitionEffect(transition, element, {
      temporaryStyleOverrides,
    });
    if (copy) copies.push(copy);
  }
}

function hasMatchingImportantStyleRule(
  element: HTMLElement,
  property: string,
): boolean {
  let found = false;
  let unreadable = false;
  visitActiveCssRules(
    element.ownerDocument,
    (rule, activity) => {
      if (found || activity === false || rule.type !== CSSRule.STYLE_RULE)
        return;
      const styleRule = rule as CSSStyleRule;
      if (
        styleRule.style.getPropertyPriority(property) === "important" &&
        element.matches(styleRule.selectorText)
      ) {
        found = true;
      }
    },
    () => {
      unreadable = true;
    },
  );
  // An unreadable sheet may contain a matching !important declaration. Move
  // the opacity transition to the frame in that case so the rule cannot hide
  // its WAAPI copy on the image.
  return found || unreadable;
}

function stylesheetValuePaints(
  element: HTMLElement,
  property: string,
  style: CSSStyleDeclaration,
): boolean {
  const probe = TRANSFORM_PROBES[property];
  if (!probe || !style.getPropertyValue(property)) return false;
  const originalCssText = style.cssText;
  const computed = window.getComputedStyle(element);
  const before = computed.getPropertyValue(property);
  try {
    style.setProperty(property, probe, style.getPropertyPriority(property));
    return computed.getPropertyValue(property) !== before;
  } catch {
    return false;
  } finally {
    style.cssText = originalCssText;
  }
}

function transformCustomPropertyReferences(
  source: HTMLElement,
  plans: SplitCssAnimation[],
  keyframes: Map<SplitCssAnimation, Set<string>>,
  authoredByPlan: Map<SplitCssAnimation, AuthoredKeyframe[]>,
  animatedProperties: ReadonlySet<string>,
): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();
  const customPropertyDependencies = new Map<string, Set<string>>();
  const paintedInlineProperties = new Set<string>();
  const cascadeElements: HTMLElement[] = [];
  for (
    let element: HTMLElement | null = source;
    element;
    element = element.parentElement
  ) {
    cascadeElements.push(element);
  }
  const addReferences = (property: string, value: string) => {
    const properties = references.get(property) ?? new Set<string>();
    for (const match of value.matchAll(CSS_VAR_REFERENCE)) {
      properties.add(match[1]);
    }
    if (properties.size > 0) references.set(property, properties);
  };
  const addCustomPropertyDependencies = (property: string, value: string) => {
    const dependencies = customPropertyDependencies.get(property) ?? new Set();
    for (const match of value.matchAll(CSS_VAR_REFERENCE)) {
      dependencies.add(match[1]);
    }
    if (dependencies.size > 0) {
      customPropertyDependencies.set(property, dependencies);
    }
  };
  for (const property of [...TRANSFORM_PROPERTIES, "transform-origin"]) {
    if (animatedProperties.has(property)) continue;
    const value = source.style.getPropertyValue(property);
    if (value && inlineValuePaints(source, property, value)) {
      addReferences(property, value);
      paintedInlineProperties.add(property);
    }
  }
  for (const element of cascadeElements) {
    for (let index = 0; index < element.style.length; index += 1) {
      const property = element.style.item(index);
      if (property.startsWith("--")) {
        addCustomPropertyDependencies(
          property,
          element.style.getPropertyValue(property),
        );
      }
    }
  }
  visitActiveCssRules(
    source.ownerDocument,
    (rule, activity) => {
      if (rule.type !== CSSRule.STYLE_RULE || activity !== true) return;
      const styleRule = rule as CSSStyleRule;
      if (source.matches(styleRule.selectorText)) {
        for (const property of [...TRANSFORM_PROPERTIES, "transform-origin"]) {
          if (
            animatedProperties.has(property) ||
            paintedInlineProperties.has(property)
          ) {
            continue;
          }
          const value = styleRule.style.getPropertyValue(property);
          if (
            value &&
            stylesheetValuePaints(source, property, styleRule.style)
          ) {
            addReferences(property, value);
          }
        }
      }
      if (
        !cascadeElements.some((element) =>
          element.matches(styleRule.selectorText),
        )
      ) {
        return;
      }
      for (let index = 0; index < styleRule.style.length; index += 1) {
        const property = styleRule.style.item(index);
        if (property.startsWith("--")) {
          addCustomPropertyDependencies(
            property,
            styleRule.style.getPropertyValue(property),
          );
        }
      }
    },
    () => {},
  );
  for (const plan of plans) {
    const properties = keyframes.get(plan)!;
    for (const property of properties) {
      if (!property.startsWith("--")) continue;
      for (const value of animationKeyframeValues(
        plan.animation,
        property,
        authoredByPlan.get(plan)!,
      )) {
        addCustomPropertyDependencies(property, value);
      }
    }
    for (const property of animatedProperties) {
      if (!properties.has(property)) continue;
      for (const value of animationKeyframeValues(
        plan.animation,
        property,
        authoredByPlan.get(plan)!,
      )) {
        addReferences(property, value);
      }
    }
  }
  for (const properties of references.values()) {
    const pending = [...properties];
    for (let index = 0; index < pending.length; index += 1) {
      for (const dependency of customPropertyDependencies.get(pending[index]) ??
        []) {
        if (properties.has(dependency)) continue;
        properties.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return references;
}

export function restoreSlideObjectTransformSnapshots(
  snapshots: readonly {
    element: HTMLElement;
    value: string;
    priority: string;
  }[],
): void {
  const transitions = new Map(
    snapshots.map(({ element }) => [
      element,
      captureInlineTransitions(element),
    ]),
  );
  for (const { element } of snapshots) {
    element.style.setProperty("transition", "none", "important");
  }
  for (const { element, value, priority } of snapshots) {
    if (value) element.style.setProperty("transform", value, priority);
    else element.style.removeProperty("transform");
  }
  for (const { element } of snapshots) {
    window.getComputedStyle(element).getPropertyValue("transform");
    restoreInlineTransitions(element, transitions.get(element) ?? []);
  }
}

/** The transform properties the keyframes of these animations set. */
function animatedTransformProperties(animations: CSSAnimation[]): string[] {
  return TRANSFORM_PROPERTIES.filter((property) =>
    animations.some(
      ({ effect }) =>
        effect instanceof KeyframeEffect &&
        effect.getKeyframes().some((keyframe) => property in keyframe),
    ),
  );
}

function hasTransformAnimation(element: HTMLElement): boolean {
  const animations = readCssAnimations(element);
  return animatedTransformProperties(animations).some(
    (property) => element.style.getPropertyPriority(property) !== "important",
  );
}

interface RunningAnimation {
  name: string;
  currentTime: CSSNumberish | null;
  resume: boolean;
}

interface SplitCssAnimation {
  animation: CSSAnimation;
  index: number;
  currentTime: CSSNumberish | null;
  resume: boolean;
  imageName?: string;
  frameName?: string;
}

let cropAnimationId = 0;

function splitCssList(value: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      items.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) items.push(last);
  return items;
}

function cssAnimationName(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function keyframeProperties(animation: CSSAnimation): Set<string> {
  const properties = new Set<string>();
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect)) return properties;
  for (const frame of effect.getKeyframes()) {
    for (const property of Object.keys(frame)) {
      if (
        ["offset", "computedOffset", "easing", "composite"].includes(property)
      )
        continue;
      properties.add(
        property.startsWith("--")
          ? property
          : property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      );
    }
  }
  return properties;
}

function keyframeValue(frame: Keyframe, property: string): string | null {
  const record = frame as Record<string, unknown>;
  const camel = property.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
  const value = record[property] ?? record[camel];
  if (typeof value === "string" || typeof value === "number") {
    // Prevent raw-text HTML from ending an enclosing serialized style element.
    return escapeRawStyleText(String(value));
  }
  return null;
}

function escapeRawStyleText(value: string): string {
  return value.replace(/</g, "\\3c ");
}

type AuthoredKeyframe = {
  keyText: string;
  style: CSSStyleDeclaration;
};

type CssRuleActivity = boolean | null;

function combineCssRuleActivity(
  parent: CssRuleActivity,
  condition: CssRuleActivity,
): CssRuleActivity {
  if (parent === false || condition === false) return false;
  if (parent === null || condition === null) return null;
  return true;
}

function mediaActivity(mediaText: string): CssRuleActivity {
  const query = mediaText.trim();
  if (!query) return true;
  return typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : null;
}

function supportsActivity(conditionText: string): CssRuleActivity {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function"
    ? CSS.supports(conditionText)
    : null;
}

function cssRuleActivity(rule: CSSRule): CssRuleActivity {
  if (rule.type === CSSRule.MEDIA_RULE) {
    return mediaActivity((rule as CSSMediaRule).media.mediaText);
  }
  if (rule.type === CSSRule.SUPPORTS_RULE) {
    return supportsActivity((rule as CSSSupportsRule).conditionText);
  }
  // Container and other conditional rules need layout or browser-specific
  // matching. Their keyframes use the computed fallback until we can tell.
  if ("conditionText" in rule || ("start" in rule && "end" in rule))
    return null;
  return true;
}

function visitActiveCssRules(
  document: Document,
  visit: (rule: CSSRule, activity: CssRuleActivity) => void,
  unreadable: () => void,
): void {
  const visitRules = (
    rules: CSSRuleList,
    parentActivity: CssRuleActivity,
  ): void => {
    if (parentActivity === false) return;
    for (const rule of Array.from(rules)) {
      const activity = combineCssRuleActivity(
        parentActivity,
        cssRuleActivity(rule),
      );
      if (activity === false) continue;
      if (rule.type === CSSRule.IMPORT_RULE) {
        const importRule = rule as CSSImportRule & { supportsText?: string };
        let importActivity = combineCssRuleActivity(
          activity,
          mediaActivity(importRule.media.mediaText),
        );
        if (importRule.supportsText) {
          importActivity = combineCssRuleActivity(
            importActivity,
            supportsActivity(importRule.supportsText),
          );
        }
        const imported = importRule.styleSheet;
        if (importActivity === false || !imported || imported.disabled) {
          continue;
        }
        try {
          visitRules(imported.cssRules, importActivity);
        } catch {
          unreadable();
        }
        continue;
      }

      visit(rule, activity);
      if ("cssRules" in rule) {
        try {
          visitRules((rule as CSSGroupingRule).cssRules, activity);
        } catch {
          unreadable();
        }
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.disabled) continue;
    const activity = mediaActivity(sheet.media.mediaText);
    if (activity === false) continue;
    try {
      visitRules(sheet.cssRules, activity);
    } catch {
      unreadable();
    }
  }
}

function authoredKeyframes(animation: CSSAnimation): AuthoredKeyframe[] {
  const effect = animation.effect;
  const document =
    effect instanceof KeyframeEffect ? effect.target?.ownerDocument : null;
  if (!document) return [];

  let match: CSSKeyframesRule | null = null;
  let matchIsKnown = false;
  visitActiveCssRules(
    document,
    (rule, activity) => {
      if (
        rule.type !== CSSRule.KEYFRAMES_RULE ||
        (rule as CSSKeyframesRule).name !== animation.animationName
      ) {
        return;
      }
      if (activity === true) {
        match = rule as CSSKeyframesRule;
        matchIsKnown = true;
      } else {
        match = null;
        matchIsKnown = false;
      }
    },
    () => {
      match = null;
      matchIsKnown = false;
    },
  );

  const matchedRule = match as CSSKeyframesRule | null;
  if (!matchIsKnown || !matchedRule) return [];
  return Array.from(matchedRule.cssRules).flatMap((rule: CSSRule) =>
    rule.type === CSSRule.KEYFRAME_RULE
      ? [
          {
            keyText: (rule as CSSKeyframeRule).keyText,
            style: (rule as CSSKeyframeRule).style,
          },
        ]
      : [],
  );
}

function animationKeyframeValues(
  animation: CSSAnimation,
  property: string,
  authored: AuthoredKeyframe[],
): string[] {
  if (authored.length > 0) {
    return authored.flatMap((frame) => {
      const value = frame.style.getPropertyValue(property);
      return value ? [value] : [];
    });
  }
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect)) return [];
  return effect.getKeyframes().flatMap((frame) => {
    const value = keyframeValue(frame, property);
    return value ? [value] : [];
  });
}

function serializeKeyframes(
  name: string,
  animation: CSSAnimation,
  properties: Set<string>,
  authored: AuthoredKeyframe[],
): string | null {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect) || properties.size === 0) return null;
  if (authored.length > 0) {
    const rules = authored.flatMap((authoredFrame) => {
      const declarations = [...properties].flatMap((property) => {
        const value = authoredFrame.style.getPropertyValue(property);
        return value === null || value === ""
          ? []
          : [`${property}: ${escapeRawStyleText(value)};`];
      });
      const easing = authoredFrame.style.getPropertyValue(
        "animation-timing-function",
      );
      if (easing) {
        declarations.push(
          `animation-timing-function: ${escapeRawStyleText(easing)};`,
        );
      }
      if (declarations.length === 0) return [];
      return [`${authoredFrame.keyText} { ${declarations.join(" ")} }`];
    });
    return rules.length ? `@keyframes ${name} { ${rules.join(" ")} }` : null;
  }
  const frames = effect.getKeyframes();
  const rules = frames.flatMap((frame) => {
    const record = frame as Keyframe & { computedOffset?: number };
    const offset =
      typeof record.offset === "number"
        ? record.offset
        : typeof record.computedOffset === "number"
          ? record.computedOffset
          : null;
    if (offset === null) return [];
    const declarations = [...properties].flatMap((property) => {
      const value = keyframeValue(frame, property);
      return value === null ? [] : [`${property}: ${value};`];
    });
    if (frame.easing && frame.easing !== "linear") {
      declarations.push(
        `animation-timing-function: ${escapeRawStyleText(frame.easing)};`,
      );
    }
    if (declarations.length === 0) return [];
    return [
      `${Number((offset * 100).toFixed(4))}% { ${declarations.join(" ")} }`,
    ];
  });
  return rules.length ? `@keyframes ${name} { ${rules.join(" ")} }` : null;
}

function nextCropAnimationName(): string {
  cropAnimationId += 1;
  return `fmd_crop_${Date.now().toString(36)}_${cropAnimationId.toString(36)}`;
}

function setAnimationList(
  element: HTMLElement,
  animations: SplitCssAnimation[],
  nameFor: (animation: SplitCssAnimation) => string | undefined,
  computedValues: Map<string, string[]>,
): RunningAnimation[] {
  const selected = animations.flatMap((animation) => {
    const name = nameFor(animation);
    return name ? [{ animation, name }] : [];
  });
  element.style.setProperty(
    "animation-name",
    selected.length ? selected.map(({ name }) => name).join(", ") : "none",
    "important",
  );
  for (const property of ANIMATION_LONGHANDS.slice(1)) {
    const values = computedValues.get(property) ?? [];
    if (selected.length === 0 || values.length === 0) continue;
    element.style.setProperty(
      property,
      selected
        .map(({ animation }) => values[animation.index % values.length])
        .join(", "),
      "important",
    );
  }
  return selected.map(({ animation, name }) => ({
    name,
    currentTime: animation.currentTime,
    resume: animation.resume,
  }));
}

export function pauseCssAnimations(
  element: HTMLElement,
  running: RunningAnimation[],
): () => void {
  const pending = [...running];
  const resumeOccurrences = new Map<string, Set<number>>();
  const occurrences = new Map<string, number>();
  for (const animation of readCssAnimations(element)) {
    const occurrence = occurrences.get(animation.animationName) ?? 0;
    occurrences.set(animation.animationName, occurrence + 1);
    const index = pending.findIndex(
      ({ name }) => name === animation.animationName,
    );
    const [reached] = index < 0 ? [] : pending.splice(index, 1);
    if (!reached) {
      animation.cancel();
      continue;
    }
    if (reached.resume) {
      const resumed =
        resumeOccurrences.get(animation.animationName) ?? new Set();
      resumed.add(occurrence);
      resumeOccurrences.set(animation.animationName, resumed);
    }
    animation.pause();
    if (reached.currentTime !== null)
      animation.currentTime = reached.currentTime;
  }
  return () => {
    const currentOccurrences = new Map<string, number>();
    for (const animation of readCssAnimations(element)) {
      const occurrence = currentOccurrences.get(animation.animationName) ?? 0;
      currentOccurrences.set(animation.animationName, occurrence + 1);
      if (resumeOccurrences.get(animation.animationName)?.has(occurrence)) {
        animation.play();
      }
    }
  };
}

function restoreCssAnimationTimes(
  element: HTMLElement,
  plans: SplitCssAnimation[],
): void {
  const usedNames = new Map<string, number>();
  const current = readCssAnimations(element);
  for (const plan of plans) {
    const name = plan.animation.animationName;
    const occurrence = usedNames.get(name) ?? 0;
    usedNames.set(name, occurrence + 1);
    const animation = current.filter((item) => item.animationName === name)[
      occurrence
    ];
    if (animation && plan.currentTime !== null) {
      animation.currentTime = plan.currentTime;
    }
  }
}

function copyAnimationEnvironment(
  source: HTMLElement,
  frame: HTMLElement,
  customProperties: Set<string>,
): void {
  const computed = window.getComputedStyle(source);
  const parentComputed = source.parentElement
    ? window.getComputedStyle(source.parentElement)
    : null;
  const localValues = new Map<string, { value: string; priority: string }>();
  const uncertainLocalProperties = new Set<string>();
  const registeredPropertySyntax = new Map<string, string>();
  let unreadableStylesheet = false;
  let probeIndex = 0;
  const probeValueForSyntax = (
    syntax: string,
    index: number,
  ): string | null => {
    // i18n-ignore: Internal CSS marker passed to CSSOM, never shown to users.
    const marker = `agent-native-crop-probe-${index}`;
    for (const option of syntax.split("|")) {
      const trimmed = option.trim();
      const multiplier = trimmed.endsWith("#")
        ? ", "
        : trimmed.endsWith("+")
          ? " "
          : "";
      const type = multiplier ? trimmed.slice(0, -1).trim() : trimmed;
      const valueByType: Record<string, string> = {
        "*": marker,
        "<angle>": `${91357 + index}deg`,
        "<basic-shape>": `inset(${91357 + index}px)`,
        // guard:allow-raw-color - synthetic probe only, never painted in the UI
        "<color>": `rgb(${index % 255} 1 2 / 0.5)`,
        "<custom-ident>": marker, // i18n-ignore: CSS syntax label passed to CSSOM.
        // guard:allow-raw-color - synthetic probe only, never painted in the UI
        "<image>": `linear-gradient(rgb(${index % 255} 1 2), rgb(3 4 5))`,
        "<integer>": `${91357 + index}`,
        "<length>": `${91357 + index}px`,
        "<length-percentage>": `${91357 + index}px`,
        "<number>": `${91357 + index}`,
        "<percentage>": `${91357 + index}%`,
        "<position>": `${91357 + index}px ${91358 + index}px`,
        "<resolution>": `${91357 + index}dpi`,
        "<string>": `"${marker}"`,
        "<time>": `${91357 + index}s`,
        "<transform-function>": `translateX(${91357 + index}px)`,
        "<transform-list>": `translateX(${91357 + index}px)`,
        "<url>": `url("${marker}")`,
      };
      const value = valueByType[type];
      if (value) return multiplier ? `${value}${multiplier}${value}` : value;
    }
    return null;
  };
  visitActiveCssRules(
    source.ownerDocument,
    (rule, activity) => {
      if (!("name" in rule) || !("syntax" in rule)) return;
      const propertyRule = rule as CSSRule & { name: string; syntax: string };
      if (activity !== true) {
        uncertainLocalProperties.add(propertyRule.name);
        return;
      }
      const previous = registeredPropertySyntax.get(propertyRule.name);
      if (previous && previous !== propertyRule.syntax) {
        uncertainLocalProperties.add(propertyRule.name);
        registeredPropertySyntax.delete(propertyRule.name);
      } else if (!uncertainLocalProperties.has(propertyRule.name)) {
        registeredPropertySyntax.set(propertyRule.name, propertyRule.syntax);
      }
    },
    () => {
      unreadableStylesheet = true;
    },
  );
  const winningLocalValue = (
    property: string,
    style: CSSStyleDeclaration,
  ): { value: string; priority: string } | null => {
    const value = style.getPropertyValue(property);
    if (!value) return null;
    const priority = style.getPropertyPriority(property);
    const originalCssText = style.cssText;
    const index = probeIndex++;
    const syntax = registeredPropertySyntax.get(property);
    const marker = syntax
      ? probeValueForSyntax(syntax, index)
      : `agent-native-crop-probe-${index}`;
    if (!marker) {
      uncertainLocalProperties.add(property);
      return null;
    }
    try {
      // Ask the browser which matching declaration wins the cascade instead
      // of treating the last source-order rule as the effective value. For
      // registered properties, normalize a valid probe through the browser
      // because arbitrary marker text may be rejected by its declared syntax.
      style.setProperty(property, marker, priority);
      let expected = marker;
      if (syntax) {
        const sourceCssText = source.style.cssText;
        source.style.setProperty(property, marker, "important");
        expected = window
          .getComputedStyle(source)
          .getPropertyValue(property)
          .trim();
        source.style.cssText = sourceCssText;
      }
      return window
        .getComputedStyle(source)
        .getPropertyValue(property)
        .trim() === expected
        ? { value, priority }
        : null;
    } catch {
      uncertainLocalProperties.add(property);
      return null;
    } finally {
      try {
        style.cssText = originalCssText;
      } catch {
        uncertainLocalProperties.add(property);
      }
    }
  };
  const propertiesToInspect = [...customProperties];
  for (let index = 0; index < propertiesToInspect.length; index++) {
    const property = propertiesToInspect[index];
    if (!property.startsWith("--")) continue;
    const addDependencies = (value: string) => {
      for (const match of value.matchAll(CSS_VAR_REFERENCE)) {
        const dependency = match[1];
        if (customProperties.has(dependency)) continue;
        customProperties.add(dependency);
        propertiesToInspect.push(dependency);
      }
    };
    visitActiveCssRules(
      source.ownerDocument,
      (rule, activity) => {
        if (rule.type !== CSSRule.STYLE_RULE) return;
        const styleRule = rule as CSSStyleRule;
        if (
          !source.matches(styleRule.selectorText) ||
          !styleRule.style.getPropertyValue(property)
        )
          return;
        if (activity !== true) {
          uncertainLocalProperties.add(property);
          return;
        }
        const local = winningLocalValue(property, styleRule.style);
        if (!local) return;
        localValues.set(property, local);
        addDependencies(local.value);
      },
      () => {
        unreadableStylesheet = true;
      },
    );
    const local = winningLocalValue(property, source.style);
    if (local) {
      localValues.set(property, local);
      addDependencies(local.value);
    }
  }
  for (const property of customProperties) {
    if (!property.startsWith("--")) continue;
    const value = computed.getPropertyValue(property);
    const inheritedValue = parentComputed?.getPropertyValue(property) ?? "";
    // The frame becomes a sibling of the image. Let inherited tokens keep
    // flowing from their original ancestor instead of freezing them inline.
    const local = localValues.get(property);
    const localInherits =
      local &&
      /^(inherit|unset|revert|revert-layer)$/i.test(local.value.trim());
    if (local && !localInherits) {
      frame.style.setProperty(property, local.value, local.priority);
    } else if (
      value &&
      (value !== inheritedValue ||
        unreadableStylesheet ||
        uncertainLocalProperties.has(property))
    ) {
      frame.style.setProperty(property, value);
    }
  }
  for (const property of [
    "color",
    "font-family",
    "font-size",
    "font-stretch",
    "font-style",
    "font-variant",
    "font-weight",
    "line-height",
    "transform-box",
  ]) {
    const value = computed.getPropertyValue(property);
    if (value) frame.style.setProperty(property, value);
  }
}

interface CropTransformHandoff {
  style: HTMLStyleElement | null;
  activateAnimations: () => () => void;
  restoreTransitions: () => void;
  cancelCopiedTransitions: (preserveOn?: HTMLElement) => void;
  resumeCopiedTransitionOverrides: (element: HTMLElement) => void;
  serializeWithoutCopiedTransitionOverrides: (
    serialize: () => string | null,
  ) => string | null;
}

/**
 * Hands the painted transform to the crop frame. CSS animation keyframes are
 * split into frame transform tracks and image visual tracks, so opacity and
 * other image-only effects stay on the image. The generated keyframes are
 * stored with the frame so the split survives save and reopen.
 */
function moveSlideObjectTransform(
  source: HTMLElement,
  frame: HTMLElement,
): CropTransformHandoff {
  const computed = window.getComputedStyle(source);
  const animations = readCssAnimations(source);
  const savedStyle = source.getAttribute("style");
  const originalTransitions = captureInlineTransitions(source);
  const values = new Map<string, string[]>();
  for (const property of ANIMATION_LONGHANDS) {
    values.set(property, splitCssList(computed.getPropertyValue(property)));
  }
  const names = values.get("animation-name") ?? [];
  const usedNames = new Map<string, number>();
  const plans: SplitCssAnimation[] = animations.map(
    (animation, fallbackIndex) => {
      const name = animation.animationName;
      const occurrence = usedNames.get(name) ?? 0;
      usedNames.set(name, occurrence + 1);
      const matches = names.flatMap((candidate, index) =>
        cssAnimationName(candidate) === name ? [index] : [],
      );
      const index =
        matches[occurrence] ?? Math.min(fallbackIndex, names.length - 1);
      return {
        animation,
        index: Math.max(index, 0),
        currentTime: animation.currentTime,
        resume: animation.playState === "running",
      };
    },
  );
  const authoredByPlan = new Map(
    plans.map((plan) => [plan, authoredKeyframes(plan.animation)]),
  );
  const keyframes = new Map(
    plans.map((plan) => {
      const properties = keyframeProperties(plan.animation);
      for (const frame of authoredByPlan.get(plan) ?? []) {
        for (let index = 0; index < frame.style.length; index++) {
          const property = frame.style.item(index);
          if (property && property !== "animation-timing-function") {
            properties.add(property);
          }
        }
      }
      return [plan, properties] as const;
    }),
  );
  const cropAnimatedProperties = [...TRANSFORM_PROPERTIES, "transform-origin"];
  const keyframedProperties = new Set(
    [...keyframes.values()].flatMap((properties) => [...properties]),
  );
  const candidateAnimatedProperties = cropAnimatedProperties.filter(
    (property) => keyframedProperties.has(property),
  );
  const runningTransitions =
    typeof source.getAnimations === "function"
      ? source
          .getAnimations()
          .filter(
            (animation) =>
              typeof (animation as Animation & { transitionProperty?: string })
                .transitionProperty === "string",
          )
      : [];
  const transitionSnapshots = runningTransitions.flatMap((transition) => {
    const property = (transition as Animation & { transitionProperty: string })
      .transitionProperty;
    const snapshot = snapshotTransition(transition, property);
    return snapshot ? [snapshot] : [];
  });
  const hasCustomPropertyTransition = transitionSnapshots.some(({ property }) =>
    property.startsWith("--"),
  );
  const painted = new Map(
    cropAnimatedProperties.map((property) => [
      property,
      computed.getPropertyValue(property),
    ]),
  );

  // A transition takes precedence over CSS animations and even important
  // declarations. Sample it first, then stop it before suppressing the image's
  // transform so it cannot continue to paint inside the new crop frame.
  const transitions = runningTransitions.filter((animation) =>
    cropAnimatedProperties.includes(
      (animation as Animation & { transitionProperty: string })
        .transitionProperty,
    ),
  );
  const transitionedProperties = new Set(
    transitions.map(
      (animation) =>
        (animation as Animation & { transitionProperty: string })
          .transitionProperty,
    ),
  );
  const copiedTransitions: CopiedTransition[] = [];
  const temporaryStyleOverrides: TemporaryInlineStyleOverride[] = [];
  preserveUnrelatedTransitions(
    source,
    frame,
    transitionSnapshots,
    copiedTransitions,
    temporaryStyleOverrides,
  );
  source.style.setProperty("transition", "none", "important");
  for (const transition of transitions) transition.cancel();

  const possibleAnimatedProperties = candidateAnimatedProperties.filter(
    (property) => source.style.getPropertyPriority(property) !== "important",
  );
  let splitAnimations = possibleAnimatedProperties.length > 0;
  if (splitAnimations) {
    // Disable originals before reading the underneath values. Their current
    // times and keyframes were captured above and are reapplied to split copies.
    source.style.setProperty("animation-name", "none", "important");
  }
  const underlay = window.getComputedStyle(source);
  const winningAnimatedProperties = possibleAnimatedProperties.filter(
    (property) =>
      inlineValuePaints(source, property, TRANSFORM_PROBES[property]),
  );
  const transformCustomProperties = hasCustomPropertyTransition
    ? transformCustomPropertyReferences(
        source,
        plans,
        keyframes,
        authoredByPlan,
        new Set(winningAnimatedProperties),
      )
    : new Map<string, Set<string>>();
  for (const property of cropAnimatedProperties) {
    const dependencies = transformCustomProperties.get(property);
    if (
      dependencies?.size &&
      transitionSnapshots.some(({ property: transitionedProperty }) =>
        dependencies.has(transitionedProperty),
      )
    ) {
      transitionedProperties.add(property);
    }
  }
  if (splitAnimations && winningAnimatedProperties.length === 0) {
    // A stylesheet !important declaration can beat the animation too. In
    // that case leave the authored animations on the image and move only the
    // transform value that actually paints.
    restoreStyleAttribute(source, savedStyle);
    source.style.setProperty("transition", "none", "important");
    restoreCssAnimationTimes(source, plans);
    splitAnimations = false;
  }
  const underlayValues = new Map(
    cropAnimatedProperties.map((property) => [
      property,
      underlay.getPropertyValue(property),
    ]),
  );

  // A canceled transition supplies the painted starting pose, but it must not
  // hide the animation track that continues underneath it.
  const activeFrameProperties = new Set(winningAnimatedProperties);
  const sampledTransitionProperties = new Set(
    [...activeFrameProperties].filter((property) =>
      transitionedProperties.has(property),
    ),
  );
  // A transform keyframe that uses var(--x) must travel with the custom
  // property track that supplies it, including chained custom properties.
  const referencedCustomProperties = new Set<string>();
  for (const plan of plans) {
    const properties = keyframes.get(plan)!;
    for (const property of activeFrameProperties) {
      if (!properties.has(property)) continue;
      for (const value of animationKeyframeValues(
        plan.animation,
        property,
        authoredByPlan.get(plan)!,
      )) {
        for (const match of value.matchAll(CSS_VAR_REFERENCE)) {
          referencedCustomProperties.add(match[1]);
        }
      }
    }
  }
  let foundCustomProperty = true;
  while (foundCustomProperty) {
    foundCustomProperty = false;
    for (const plan of plans) {
      const properties = keyframes.get(plan)!;
      for (const property of referencedCustomProperties) {
        if (!properties.has(property)) continue;
        for (const value of animationKeyframeValues(
          plan.animation,
          property,
          authoredByPlan.get(plan)!,
        )) {
          for (const match of value.matchAll(CSS_VAR_REFERENCE)) {
            if (!referencedCustomProperties.has(match[1])) {
              referencedCustomProperties.add(match[1]);
              foundCustomProperty = true;
            }
          }
        }
      }
    }
  }
  const frameCustomPropertyTransitions = splitAnimations
    ? transitionSnapshots.filter(({ property }) =>
        [...activeFrameProperties].some((frameProperty) =>
          transformCustomProperties.get(frameProperty)?.has(property),
        ),
      )
    : [];
  const frameUsesFontRelativeLength = [
    ...activeFrameProperties,
    ...referencedCustomProperties,
  ].some((property) => {
    if (FONT_RELATIVE_LENGTH.test(computed.getPropertyValue(property))) {
      return true;
    }
    return plans.some(
      (plan) =>
        keyframes.get(plan)!.has(property) &&
        animationKeyframeValues(
          plan.animation,
          property,
          authoredByPlan.get(plan)!,
        ).some((value) => FONT_RELATIVE_LENGTH.test(value)),
    );
  });
  const frameUsesLineHeightRelativeLength = [
    ...activeFrameProperties,
    ...referencedCustomProperties,
  ].some((property) => {
    if (LINE_HEIGHT_RELATIVE_LENGTH.test(computed.getPropertyValue(property))) {
      return true;
    }
    return plans.some(
      (plan) =>
        keyframes.get(plan)!.has(property) &&
        animationKeyframeValues(
          plan.animation,
          property,
          authoredByPlan.get(plan)!,
        ).some((value) => LINE_HEIGHT_RELATIVE_LENGTH.test(value)),
    );
  });
  const cssRules: string[] = [];
  if (splitAnimations) {
    copyAnimationEnvironment(source, frame, referencedCustomProperties);
    for (const transition of frameCustomPropertyTransitions) {
      const targetValue = transitionTargetValue(transition);
      if (targetValue === null) continue;
      const copy = copyTransitionEffect(transition, frame, {
        underlyingValue: targetValue,
        restoreImportant: false,
      });
      if (copy) copiedTransitions.push(copy);
    }
    for (const plan of plans) {
      const properties = keyframes.get(plan)!;
      const imageProperties = new Set(
        [...properties].filter(
          (property) => !cropAnimatedProperties.includes(property),
        ),
      );
      const frameProperties = new Set(
        [...properties].filter((property) =>
          activeFrameProperties.has(property),
        ),
      );
      for (const property of referencedCustomProperties) {
        if (properties.has(property)) frameProperties.add(property);
      }
      if (frameUsesFontRelativeLength && properties.has("font-size")) {
        frameProperties.add("font-size");
      }
      if (frameUsesLineHeightRelativeLength && properties.has("line-height")) {
        frameProperties.add("line-height");
      }
      if (imageProperties.size > 0) {
        plan.imageName = nextCropAnimationName();
        const rule = serializeKeyframes(
          plan.imageName,
          plan.animation,
          imageProperties,
          authoredByPlan.get(plan)!,
        );
        if (rule) cssRules.push(rule);
      }
      if (frameProperties.size > 0) {
        plan.frameName = nextCropAnimationName();
        const rule = serializeKeyframes(
          plan.frameName,
          plan.animation,
          frameProperties,
          authoredByPlan.get(plan)!,
        );
        if (rule) cssRules.push(rule);
      }
    }
  }

  let moved = activeFrameProperties.size > 0;
  for (const property of TRANSFORM_PROPERTIES) {
    const authored = source.style.getPropertyValue(property);
    const value = transitionedProperties.has(property)
      ? painted.get(property)
      : authored &&
          !READS_OWN_CASCADE.test(authored) &&
          inlineValuePaints(source, property)
        ? authored
        : underlayValues.get(property);
    if (value && value !== "none") {
      // A paused copied animation still beats normal inline values. Keep the
      // transition's sampled pose above it until crop commit resumes the track.
      frame.style.setProperty(
        property,
        value,
        sampledTransitionProperties.has(property) ? "important" : "",
      );
      moved = true;
    }
    source.style.setProperty(property, "none", "important");
  }
  const origin = transitionedProperties.has("transform-origin")
    ? painted.get("transform-origin")
    : underlayValues.get("transform-origin");
  if (moved && origin && origin !== "50% 50%")
    frame.style.setProperty(
      "transform-origin",
      origin,
      sampledTransitionProperties.has("transform-origin") ? "important" : "",
    );
  let style: HTMLStyleElement | null = null;
  if (moved && splitAnimations && cssRules.length > 0) {
    style = frame.ownerDocument.createElement("style");
    style.setAttribute("data-fmd-crop-keyframes", "");
    style.textContent = cssRules.join("\n");
  }

  return {
    style,
    cancelCopiedTransitions: (preserveOn) => {
      for (const transition of [...copiedTransitions]) {
        if (preserveOn && transition.target === preserveOn) continue;
        transition.cancel();
        copiedTransitions.splice(copiedTransitions.indexOf(transition), 1);
      }
    },
    resumeCopiedTransitionOverrides: (element) =>
      reapplyTemporaryInlineStyleOverrides(temporaryStyleOverrides, element),
    serializeWithoutCopiedTransitionOverrides: (serialize) =>
      serializeWithRestoredInlineStyleOverrides(
        temporaryStyleOverrides,
        serialize,
      ),
    activateAnimations: () => {
      if (!splitAnimations) return () => {};
      const imageRunning = setAnimationList(
        source,
        plans,
        (plan) => plan.imageName,
        values,
      );
      const frameRunning = setAnimationList(
        frame,
        plans,
        (plan) => plan.frameName,
        values,
      );
      const resumeImage = pauseCssAnimations(source, imageRunning);
      const resumeFrame = pauseCssAnimations(frame, frameRunning);
      return () => {
        for (const property of sampledTransitionProperties) {
          const value = frame.style.getPropertyValue(property);
          if (value) frame.style.setProperty(property, value);
        }
        resumeImage();
        resumeFrame();
      };
    },
    restoreTransitions: () =>
      restoreInlineTransitionsAfterTransformSettles(
        source,
        originalTransitions,
      ),
  };
}

/**
 * Wraps a bare image in the frame that crops it. The frame takes the image's
 * place, box and transform inside its parent, and the image moves into the
 * frame's clipping viewport. Null when the image has no parent to wrap it in.
 */
export function wrapImageInCropFrame(image: HTMLImageElement): {
  frame: HTMLElement;
  viewport: HTMLElement;
  resumeAnimations: () => void;
  restoreTransitions: () => void;
  cancelCopiedTransitions: (preserveOn?: HTMLElement) => void;
  resumeCopiedTransitionOverrides: (element: HTMLElement) => void;
  serializeWithoutCopiedTransitionOverrides: (
    serialize: () => string | null,
  ) => string | null;
} | null {
  const parent = image.parentElement;
  if (!parent) return null;
  const imageWidth = image.offsetWidth;
  const imageHeight = image.offsetHeight;
  const imageLeft = image.offsetLeft;
  const imageTop = image.offsetTop;
  const imageStyle = image.style;
  const inlineParent = Boolean(parent.closest("p"));
  const frame = image.ownerDocument.createElement(
    inlineParent ? "span" : "div",
  );
  frame.className = "fmd-pptx-image";
  frame.setAttribute("data-pptx-element-kind", "image");
  for (const property of [
    "position",
    "left",
    "top",
    "right",
    "bottom",
    "width",
    "height",
  ]) {
    const value = imageStyle.getPropertyValue(property);
    if (value) frame.style.setProperty(property, value);
  }
  const zIndex = imageStyle.zIndex || window.getComputedStyle(image).zIndex;
  if (zIndex && zIndex !== "auto") frame.style.zIndex = zIndex;
  const animationHandoff = moveSlideObjectTransform(image, frame);
  frame.style.position ||= "absolute";
  frame.style.display = "block";
  frame.style.left ||= `${imageLeft}px`;
  frame.style.top ||= `${imageTop}px`;
  frame.style.width ||= `${imageWidth}px`;
  frame.style.height ||= `${imageHeight}px`;
  const objectId =
    image.getAttribute("data-slide-object-id") ?? ensureSlideObjectId(image);
  frame.setAttribute("data-slide-object-id", objectId);
  image.removeAttribute("data-slide-object-id");

  const viewport = image.ownerDocument.createElement(
    inlineParent ? "span" : "div",
  );
  viewport.className = "fmd-image-crop-viewport";
  Object.assign(viewport.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    display: "block",
  });
  parent.insertBefore(frame, image);
  frame.appendChild(viewport);
  viewport.appendChild(image);
  Object.assign(image.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: `${imageWidth}px`,
    height: `${imageHeight}px`,
    maxWidth: "none",
    maxHeight: "none",
    margin: "0",
  });
  if (animationHandoff.style) frame.appendChild(animationHandoff.style);
  const resumeAnimations = animationHandoff.activateAnimations();
  return {
    frame,
    viewport,
    resumeAnimations,
    restoreTransitions: animationHandoff.restoreTransitions,
    cancelCopiedTransitions: animationHandoff.cancelCopiedTransitions,
    resumeCopiedTransitionOverrides:
      animationHandoff.resumeCopiedTransitionOverrides,
    serializeWithoutCopiedTransitionOverrides:
      animationHandoff.serializeWithoutCopiedTransitionOverrides,
  };
}

export function resolveSlideClipboardElement(
  selectedElement: HTMLElement | null,
  selectedImg: HTMLImageElement | null,
  slideContent: HTMLElement,
): HTMLElement | null {
  if (selectedImg) {
    return findPersistedImageObject(selectedImg, slideContent) ?? selectedImg;
  }
  return selectedElement;
}

export function clientPointToSlideCoordinates(
  clientX: number,
  clientY: number,
  rect: SlideLayoutRect,
  slideWidth: number,
  slideHeight: number,
): { x: number; y: number } {
  const point = clientPointToCanvasPoint({ x: clientX, y: clientY }, rect, {
    width: slideWidth,
    height: slideHeight,
  });
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

export function resizeSlideObject(
  start: SlideObjectGeometry,
  {
    handle,
    dx,
    dy,
    preserveAspectRatio,
    minSize = MIN_SLIDE_OBJECT_SIZE,
  }: ResizeOptions,
): SlideObjectGeometry {
  return resizeCanvasRect(start, {
    handle,
    delta: { x: dx, y: dy },
    preserveAspectRatio,
    minWidth: minSize,
    minHeight: minSize,
  });
}

const WIDTH_ONLY_RESIZE_HANDLES = new Set<ResizeHandle>(["e", "w"]);

export function isAutoHeightTextResize(
  element: HTMLElement,
  handle: ResizeHandle,
  preserveAspectRatio: boolean,
): boolean {
  if (isFitTextObject(element)) return true;
  // A box that paints itself (shape, card) or pins its bottom keeps the
  // height it was given; only bare text re-wraps to its content.
  return (
    WIDTH_ONLY_RESIZE_HANDLES.has(handle) &&
    !preserveAspectRatio &&
    isTextLeaf(element) &&
    !hasInlineBottom(element) &&
    !paintsOwnSlideBox(element)
  );
}

export interface FitTextBoxResize {
  x: number;
  y: number;
  width: number;
  minHeight?: number;
}

// Height is derived from the text, so no handle ever returns one; `shift` is
// accepted for call-site symmetry but there is no aspect to lock.
export function resolveFitTextBoxResize({
  handle,
  start,
  delta,
  minWidth = MIN_SLIDE_OBJECT_SIZE,
  hasMinHeight,
  alt = false,
  floorHeight = MIN_SLIDE_OBJECT_SIZE,
}: {
  handle: ResizeHandle;
  start: SlideObjectGeometry;
  delta: { dx: number; dy: number };
  minWidth?: number;
  hasMinHeight: boolean;
  shift?: boolean;
  alt?: boolean;
  floorHeight?: number;
}): FitTextBoxResize {
  const { dx, dy } = delta;
  const east = handle.includes("e");
  const west = handle.includes("w");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const corner = (east || west) && (north || south);

  let { x, y, width } = start;
  if (alt && (east || west)) {
    width = Math.max(minWidth, start.width + 2 * (east ? dx : -dx));
    x = start.x + (start.width - width) / 2;
  } else if (east) {
    width = Math.max(minWidth, start.width + dx);
  } else if (west) {
    width = Math.max(minWidth, start.width - dx);
    x = start.x + start.width - width;
  }

  if (corner) {
    y = start.y + (north ? dy : alt ? -dy : 0);
    return { x, y, width };
  }
  if (!hasMinHeight) {
    if (north) y = start.y + dy;
    return { x, y, width };
  }
  if (north) {
    const minHeight = Math.max(floorHeight, start.height - dy);
    return { x, y: start.y + start.height - minHeight, width, minHeight };
  }
  if (south) {
    return {
      x,
      y,
      width,
      minHeight: Math.max(floorHeight, start.height + dy),
    };
  }
  return { x, y, width };
}

export function resizeSlideObjectMembers(
  members: readonly SlideObjectMoveMember[],
  {
    handle,
    dx,
    dy,
    preserveAspectRatio = false,
    minSize = MIN_SLIDE_OBJECT_SIZE,
  }: {
    handle: ResizeHandle;
    dx: number;
    dy: number;
    preserveAspectRatio?: boolean;
    minSize?: number;
  },
): Map<string, SlideObjectGeometryPlan> {
  const bounds = unionSlideObjectGeometries(
    members.map((member) => member.start),
  );
  if (!bounds) return new Map();

  const resized = resizeSlideObject(bounds, {
    handle,
    dx,
    dy,
    preserveAspectRatio,
    minSize: 0,
  });
  const minimumScaleX = Math.max(
    ...members.map((member) => minSize / member.start.width),
  );
  const minimumScaleY = Math.max(
    ...members.map((member) => minSize / member.start.height),
  );
  const scaleX = Math.max(resized.width / bounds.width, minimumScaleX);
  const scaleY = Math.max(resized.height / bounds.height, minimumScaleY);
  const scale = preserveAspectRatio ? Math.max(scaleX, scaleY) : undefined;
  const width = bounds.width * (scale ?? scaleX);
  const height = bounds.height * (scale ?? scaleY);
  const resizesFromWest = handle === "nw" || handle === "w" || handle === "sw";
  const resizesFromEast = handle === "ne" || handle === "e" || handle === "se";
  const resizesFromNorth = handle === "nw" || handle === "n" || handle === "ne";
  const resizesFromSouth = handle === "sw" || handle === "s" || handle === "se";
  const group = {
    x: resizesFromWest
      ? bounds.x + bounds.width - width
      : resizesFromEast
        ? bounds.x
        : bounds.x + (bounds.width - width) / 2,
    y: resizesFromNorth
      ? bounds.y + bounds.height - height
      : resizesFromSouth
        ? bounds.y
        : bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
  const plan = new Map<string, SlideObjectGeometryPlan>();
  for (const member of members) {
    const { start } = member;
    plan.set(
      member.objectId,
      planSlideObjectGeometry(member.element, {
        x: group.x + ((start.x - bounds.x) / bounds.width) * group.width,
        y: group.y + ((start.y - bounds.y) / bounds.height) * group.height,
        width: (start.width / bounds.width) * group.width,
        height: (start.height / bounds.height) * group.height,
      }),
    );
  }
  return plan;
}

interface SlideObjectGroupBounds {
  width: number;
  height: number;
}

export interface SlideObjectGroupMemberResizePlan {
  geometry: SlideObjectGeometryPlan;
  transform?: string;
  transformOrigin?: string;
}

export function scaleSlideObjectGroupMembers(
  members: readonly SlideObjectGroupResizeMember[],
  originalGroup: SlideObjectGroupBounds,
  nextGroup: SlideObjectGroupBounds,
): Map<HTMLElement, SlideObjectGroupMemberResizePlan> {
  if (
    originalGroup.width <= 0 ||
    originalGroup.height <= 0 ||
    nextGroup.width <= 0 ||
    nextGroup.height <= 0
  ) {
    return new Map();
  }
  const scaleX = nextGroup.width / originalGroup.width;
  const scaleY = nextGroup.height / originalGroup.height;
  const plans = members.map((member) => {
    const { element, start, transform, transformOrigin } = member;
    const geometry = planSlideObjectGeometry(element, {
      x: start.x * scaleX,
      y: start.y * scaleY,
      width: start.width * scaleX,
      height: start.height * scaleY,
    });
    if (!transform || transform === "none") {
      return { element, plan: { geometry } };
    }

    const matrix = readSlideObjectTransformMatrix(start, transform);
    const origin = parseSlideObjectTransformOrigin(transformOrigin)?.(
      start.width,
      start.height,
    );
    if (!matrix || !origin) return null;
    const [a, b, c, d, tx, ty] = matrix;
    const { x: originX, y: originY } = origin;
    const format = (value: number) => {
      const rounded = Number(value.toFixed(8));
      return String(Object.is(rounded, -0) ? 0 : rounded);
    };
    const writable = toTransformProperty(
      element,
      start.width * scaleX,
      start.height * scaleY,
      slideObjectMatrix2dString([
        a,
        (scaleY / scaleX) * b,
        (scaleX / scaleY) * c,
        d,
        scaleX * tx,
        scaleY * ty,
      ]),
    );
    if (writable === null) return null;

    return {
      element,
      plan: {
        geometry,
        transform: writable,
        transformOrigin: `${format(scaleX * originX)}px ${format(scaleY * originY)}px`,
      },
    };
  });
  const validPlans = plans.filter(
    (plan): plan is NonNullable<typeof plan> => plan !== null,
  );
  if (validPlans.length !== plans.length) return new Map();
  return new Map(validPlans.map(({ element, plan }) => [element, plan]));
}

export type SlideObjectZOrderTarget = "front" | "back" | "forward" | "backward";

export function readSlideObjectZIndex(element: HTMLElement): number {
  const raw = element.style.zIndex || window.getComputedStyle(element).zIndex;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export interface SlideObjectZOrderChange {
  value: number;
  shiftPeers: { element: HTMLElement; value: number }[];
}

function isEditableFreeformSlideObject(element: HTMLElement): boolean {
  return (
    element.hasAttribute("data-slide-object-id") &&
    (element.style.position || window.getComputedStyle(element).position) ===
      "absolute"
  );
}

function createsSlideObjectStackingContext(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const inline = element.style;
  const position = inline.position || style.position || "static";
  const zIndex = inline.zIndex || style.zIndex;
  const containment = inline.contain || style.contain || "";
  const willChange = inline.willChange || style.willChange || "";
  const opacity = Number.parseFloat(inline.opacity || style.opacity || "1");
  const transform = inline.transform || style.transform;
  const perspective = inline.perspective || style.perspective;
  const filter = inline.filter || style.filter;
  const backdropFilter = inline.backdropFilter || style.backdropFilter;
  const isolation = inline.isolation || style.isolation;
  const mixBlendMode = inline.mixBlendMode || style.mixBlendMode;

  return (
    position === "fixed" ||
    position === "sticky" ||
    (position !== "static" && zIndex !== "" && zIndex !== "auto") ||
    (Number.isFinite(opacity) && opacity < 1) ||
    (transform !== "" && transform !== "none") ||
    (perspective !== "" && perspective !== "none") ||
    (filter !== "" && filter !== "none") ||
    (backdropFilter !== "" && backdropFilter !== "none") ||
    isolation === "isolate" ||
    (mixBlendMode !== "" && mixBlendMode !== "normal") ||
    /(?:^|\s)(?:layout|paint|strict|content)(?:\s|$)/.test(containment) ||
    /(?:^|,\s*)(?:transform|opacity|filter|perspective)(?:,\s*|$)/.test(
      willChange,
    )
  );
}

function resolveSlideObjectStackingContext(
  element: HTMLElement,
  container: HTMLElement,
): HTMLElement {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== container) {
    if (createsSlideObjectStackingContext(ancestor)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return container;
}

interface SlideObjectZOrderPeer {
  element: HTMLElement;
  zIndex: number;
  order: number;
}

function getSlideObjectZOrderPeers(
  element: HTMLElement,
  container: HTMLElement,
): SlideObjectZOrderPeer[] {
  const containingBlock = resolveSlideObjectContainingBlock(element, container);
  const stackingContext = resolveSlideObjectStackingContext(element, container);

  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
  ).flatMap((peer, order) => {
    if (
      peer === element ||
      element.contains(peer) ||
      !isEditableFreeformSlideObject(peer) ||
      resolveSlideObjectContainingBlock(peer, container) !== containingBlock ||
      resolveSlideObjectStackingContext(peer, container) !== stackingContext
    ) {
      return [];
    }
    const zIndex = readSlideObjectZIndex(peer);
    if (zIndex < 0) return [];
    return [{ element: peer, zIndex, order }];
  });
}

export function persistSlideObjectZOrderFromDom(
  element: HTMLElement,
  container: HTMLElement,
): boolean {
  if (!isEditableFreeformSlideObject(element)) return false;
  if (readSlideObjectZIndex(element) < 0) return false;

  const peers = [
    { element, zIndex: readSlideObjectZIndex(element), order: -1 },
    ...getSlideObjectZOrderPeers(element, container),
  ];
  const domOrder = new Map(
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ).map((peer, order) => [peer, order]),
  );
  peers.sort(
    (left, right) =>
      (domOrder.get(left.element) ?? -1) - (domOrder.get(right.element) ?? -1),
  );

  let changed = false;
  for (const [index, peer] of peers.entries()) {
    if (readSlideObjectZIndex(peer.element) === index) continue;
    peer.element.style.zIndex = String(index);
    changed = true;
  }
  return changed;
}

export function computeSlideObjectZOrder(
  element: HTMLElement,
  container: HTMLElement,
  target: SlideObjectZOrderTarget,
): SlideObjectZOrderChange | null {
  if (!isEditableFreeformSlideObject(element)) return null;
  const peers = getSlideObjectZOrderPeers(element, container);

  if (peers.length === 0) return null;

  const peerZIndexes = peers.map((peer) => peer.zIndex);
  const currentValue = readSlideObjectZIndex(element);

  if (target === "front") {
    const value = Math.max(...peerZIndexes) + 1;
    return value === currentValue ? null : { value, shiftPeers: [] };
  }

  if (target === "forward" || target === "backward") {
    const currentOrder = Array.from(
      container.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ).indexOf(element);
    const all = [
      { element, zIndex: currentValue, order: currentOrder },
      ...peers,
    ].sort(
      (left, right) => left.zIndex - right.zIndex || left.order - right.order,
    );
    const currentIndex = all.findIndex((peer) => peer.element === element);
    const nextIndex = currentIndex + (target === "forward" ? 1 : -1);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= all.length) {
      return null;
    }

    const reordered = [...all];
    const [moved] = reordered.splice(currentIndex, 1);
    if (!moved) return null;
    reordered.splice(nextIndex, 0, moved);

    const change = {
      value: nextIndex,
      shiftPeers: reordered
        .map((peer, index) => ({ element: peer.element, value: index }))
        .filter(
          (peer) =>
            peer.element !== element &&
            readSlideObjectZIndex(peer.element) !== peer.value,
        ),
    };
    return change.value === currentValue && change.shiftPeers.length === 0
      ? null
      : change;
  }

  const minPeer = Math.min(...peerZIndexes);
  const hasTiedPeers = new Set(peerZIndexes).size !== peers.length;
  if (minPeer - 1 >= 0 && !hasTiedPeers) {
    const value = minPeer - 1;
    return value === currentValue ? null : { value, shiftPeers: [] };
  }

  const orderedPeers = [...peers].sort(
    (left, right) => left.zIndex - right.zIndex || left.order - right.order,
  );
  return {
    value: 0,
    shiftPeers: orderedPeers.map((peer, index) => ({
      element: peer.element,
      value: index + 1,
    })),
  };
}

export function computeSlideObjectZOrderForSelection(
  elements: readonly HTMLElement[],
  container: HTMLElement,
  target: SlideObjectZOrderTarget,
): Map<HTMLElement, number> | null {
  const roots = normalizeSlideObjectRoots([...elements]);
  if (roots.length === 0) return null;
  const firstContainingBlock = resolveSlideObjectContainingBlock(
    roots[0],
    container,
  );
  const firstStackingContext = resolveSlideObjectStackingContext(
    roots[0],
    container,
  );
  if (
    roots.some(
      (root) =>
        !isEditableFreeformSlideObject(root) ||
        resolveSlideObjectContainingBlock(root, container) !==
          firstContainingBlock ||
        resolveSlideObjectStackingContext(root, container) !==
          firstStackingContext,
    )
  ) {
    return null;
  }

  const selected = new Set(roots);
  const peers = getSlideObjectZOrderPeers(roots[0], container).filter(
    (peer) => !roots.some((root) => root.contains(peer.element)),
  );
  const domOrder = new Map(
    Array.from(
      container.querySelectorAll<HTMLElement>("[data-slide-object-id]"),
    ).map((element, index) => [element, index]),
  );
  const all = [
    ...roots.map((element) => ({
      element,
      zIndex: readSlideObjectZIndex(element),
      order: domOrder.get(element) ?? -1,
    })),
    ...peers.filter((peer) => !selected.has(peer.element)),
  ].sort(
    (left, right) => left.zIndex - right.zIndex || left.order - right.order,
  );

  const reordered = [...all];
  if (target === "front" || target === "back") {
    const selectedLayers = reordered.filter((entry) =>
      selected.has(entry.element),
    );
    const unselectedLayers = reordered.filter(
      (entry) => !selected.has(entry.element),
    );
    reordered.splice(
      0,
      reordered.length,
      ...(target === "front"
        ? [...unselectedLayers, ...selectedLayers]
        : [...selectedLayers, ...unselectedLayers]),
    );
  } else {
    const step = target === "forward" ? 1 : -1;
    const selectedIndexes = reordered
      .map((entry, index) => (selected.has(entry.element) ? index : -1))
      .filter((index) => index >= 0);
    const indexes =
      step > 0 ? [...selectedIndexes].reverse() : [...selectedIndexes];
    for (const index of indexes) {
      const currentIndex = reordered.findIndex((entry) => entry === all[index]);
      if (currentIndex < 0) continue;
      const nextIndex = currentIndex + step;
      if (
        nextIndex < 0 ||
        nextIndex >= reordered.length ||
        selected.has(reordered[nextIndex]?.element)
      ) {
        continue;
      }
      const [moved] = reordered.splice(currentIndex, 1);
      if (!moved) continue;
      reordered.splice(nextIndex, 0, moved);
    }
  }

  const changes = new Map<HTMLElement, number>();
  reordered.forEach(({ element }, index) => {
    if (readSlideObjectZIndex(element) !== index) changes.set(element, index);
  });
  return changes.size > 0 ? changes : null;
}

function readSlideLayerZIndex(element: HTMLElement): number | null {
  const raw = element.style.zIndex || window.getComputedStyle(element).zIndex;
  if (!raw || raw === "auto") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function ensureSlideLayerCanStack(
  element: HTMLElement,
  parent: HTMLElement,
): void {
  const parentDisplay = window.getComputedStyle(parent).display;
  if (parentDisplay === "flex" || parentDisplay === "grid") return;
  const position =
    element.style.position || window.getComputedStyle(element).position;
  if (!position || position === "static") element.style.position = "relative";
}

function slideLayerSiblings(
  element: HTMLElement,
  parent: HTMLElement,
): HTMLElement[] {
  return Array.from(parent.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child !== element &&
      !isSlideCanvasShell(child) &&
      shouldStampBuilderId(child) &&
      (readSlideLayerZIndex(child) ?? 0) >= 0,
  );
}

export function arrangeSlideLayerInParent(
  element: HTMLElement,
  target: SlideObjectZOrderTarget,
): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  if ((readSlideLayerZIndex(element) ?? 0) < 0) return false;
  const siblings = slideLayerSiblings(element, parent);
  if (siblings.length === 0) return false;

  ensureSlideLayerCanStack(element, parent);

  if (target === "front") {
    const next =
      Math.max(0, ...siblings.map((s) => readSlideLayerZIndex(s) ?? 0)) + 1;
    if (readSlideLayerZIndex(element) === next) return false;
    element.style.zIndex = String(next);
    return true;
  }

  if (target === "forward" || target === "backward") {
    const domOrder = new Map(
      Array.from(parent.children).map((child, index) => [child, index]),
    );
    const all = [
      {
        element,
        zIndex: readSlideLayerZIndex(element) ?? 0,
        order: domOrder.get(element) ?? -1,
      },
      ...siblings.map((sibling) => ({
        element: sibling,
        zIndex: readSlideLayerZIndex(sibling) ?? 0,
        order: domOrder.get(sibling) ?? -1,
      })),
    ].sort(
      (left, right) => left.zIndex - right.zIndex || left.order - right.order,
    );
    const currentIndex = all.findIndex((peer) => peer.element === element);
    const nextIndex = currentIndex + (target === "forward" ? 1 : -1);
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= all.length) {
      return false;
    }

    const reordered = [...all];
    const [moved] = reordered.splice(currentIndex, 1);
    if (!moved) return false;
    reordered.splice(nextIndex, 0, moved);

    let changed = false;
    reordered.forEach((peer, index) => {
      if ((readSlideLayerZIndex(peer.element) ?? 0) === index) return;
      ensureSlideLayerCanStack(peer.element, parent);
      peer.element.style.zIndex = String(index);
      changed = true;
    });
    return changed;
  }

  const domOrder = new Map(
    Array.from(parent.children).map((child, index) => [child, index]),
  );
  const ordered = [...siblings].sort(
    (left, right) =>
      (readSlideLayerZIndex(left) ?? 0) - (readSlideLayerZIndex(right) ?? 0) ||
      (domOrder.get(left) ?? 0) - (domOrder.get(right) ?? 0),
  );

  let changed = readSlideLayerZIndex(element) !== 0;
  element.style.zIndex = "0";
  ordered.forEach((sibling, index) => {
    const value = index + 1;
    if (readSlideLayerZIndex(sibling) === value) return;
    ensureSlideLayerCanStack(sibling, parent);
    sibling.style.zIndex = String(value);
    changed = true;
  });
  return changed;
}

export interface SlideObjectMoveMember {
  objectId: string;
  element: HTMLElement;
  start: SlideObjectGeometry;
}

export interface SlideObjectTransformSnapshot {
  transform: string;
  transformOrigin: string;
}

export interface SlideObjectSelectionFrame {
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  transformOrigin: { x: number; y: number };
}

export interface SlideObjectGroupResizeMember
  extends SlideObjectMoveMember, SlideObjectTransformSnapshot {}

// What an unreadable longhand reads as: a perspective matrix, which every
// consumer already refuses. An arbitrary string would not do, since the
// DOMMatrix fallback may read it as the identity.
const UNREADABLE_TRANSFORM =
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1)";

const CSS_NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?";
const ROTATE_LONGHAND = new RegExp(
  `^(?:z\\s+)?(${CSS_NUMBER})(deg|grad|rad|turn)$`,
);
const SCALE_FACTOR = new RegExp(`^(${CSS_NUMBER})(%?)$`);
const ANGLE_UNIT_RADIANS = new Map([
  ["deg", Math.PI / 180],
  ["grad", Math.PI / 200],
  ["rad", 1],
  ["turn", 2 * Math.PI],
]);

function multiplySlideObjectMatrices(
  m: SlideObjectTransformMatrix2d,
  n: SlideObjectTransformMatrix2d,
): SlideObjectTransformMatrix2d {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Only 2D values are readable: a z translation or a z scale, an axis keyword
// and a 3D axis all return null.
function readTranslateLonghand(
  value: string,
  width: number,
  height: number,
): SlideObjectTransformMatrix2d | null {
  const parts = value.split(/\s+/);
  if (parts.length > 3) return null;
  const x = parseTransformLength(parts[0], width);
  const y = parseTransformLength(parts[1], height);
  return x !== null && y !== null && parseTransformLength(parts[2], 0) === 0
    ? [1, 0, 0, 1, x, y]
    : null;
}

function readRotateLonghand(
  value: string,
): SlideObjectTransformMatrix2d | null {
  const match = ROTATE_LONGHAND.exec(value.toLowerCase());
  const unit = ANGLE_UNIT_RADIANS.get(match?.[2] ?? "");
  if (!match || unit === undefined) return null;
  const radians = Number(match[1]) * unit;
  return [
    Math.cos(radians),
    Math.sin(radians),
    -Math.sin(radians),
    Math.cos(radians),
    0,
    0,
  ];
}

function readScaleLonghand(value: string): SlideObjectTransformMatrix2d | null {
  const parts = value.split(/\s+/);
  const [x, y = x, z = 1] = parts.map((part) => {
    const match = SCALE_FACTOR.exec(part);
    return match ? Number(match[1]) / (match[2] ? 100 : 1) : null;
  });
  return parts.length <= 3 &&
    typeof x === "number" &&
    typeof y === "number" &&
    z === 1
    ? [x, 0, 0, y, 0, 0]
    : null;
}

interface TransformLonghands {
  translate: string;
  rotate: string;
  scale: string;
}

/** The longhands an object sets, or null when it sets none. */
function readTransformLonghands(
  element: HTMLElement,
  computedStyle: CSSStyleDeclaration,
): TransformLonghands | null {
  const read = (property: string) => {
    const value = (
      computedStyle.getPropertyValue(property) ||
      element.style.getPropertyValue(property)
    ).trim();
    return value === "none" ? "" : value;
  };
  const longhands = {
    translate: read("translate"),
    rotate: read("rotate"),
    scale: read("scale"),
  };
  return longhands.translate || longhands.rotate || longhands.scale
    ? longhands
    : null;
}

/** The longhands as one matrix, or null when one is not plain 2D. */
function composeTransformLonghands(
  { translate, rotate, scale }: TransformLonghands,
  width: number,
  height: number,
): SlideObjectTransformMatrix2d | null {
  const identity: SlideObjectTransformMatrix2d = [1, 0, 0, 1, 0, 0];
  const matrices = [
    translate ? readTranslateLonghand(translate, width, height) : identity,
    rotate ? readRotateLonghand(rotate) : identity,
    scale ? readScaleLonghand(scale) : identity,
  ].filter((matrix) => matrix !== null);
  return matrices.length === 3
    ? matrices.reduce(multiplySlideObjectMatrices)
    : null;
}

function invertSlideObjectMatrix([
  a,
  b,
  c,
  d,
  e,
  f,
]: SlideObjectTransformMatrix2d): SlideObjectTransformMatrix2d | null {
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

/**
 * CSS paints `translate`, then `rotate`, then `scale`, then `transform`, all
 * about the transform origin, so the `transform` property alone no longer
 * describes an object that uses one of them. This is the one matrix the four
 * compose to, as a `matrix()` string. Percent translations resolve against the
 * object's own box.
 */
function composeSlideObjectTransform(
  element: HTMLElement,
  computedStyle: CSSStyleDeclaration,
  transform: string,
): string {
  const longhands = readTransformLonghands(element, computedStyle);
  if (!longhands) return transform;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const own = readSlideObjectTransformMatrix(
    { x: 0, y: 0, width, height },
    transform,
  );
  const leading = composeTransformLonghands(longhands, width, height);
  return leading && own
    ? slideObjectMatrix2dString(multiplySlideObjectMatrices(leading, own))
    : UNREADABLE_TRANSFORM;
}

/**
 * What to write to `transform` for an object that paints `effective` (as a
 * snapshot reads it) while its longhands stay in place and still apply first.
 * Null when they cannot be undone. Writing `effective` itself would apply them
 * twice.
 */
function toTransformProperty(
  element: HTMLElement,
  width: number,
  height: number,
  effective: string,
): string | null {
  const longhands = readTransformLonghands(
    element,
    window.getComputedStyle(element),
  );
  if (!longhands) return effective;
  const leading = composeTransformLonghands(longhands, width, height);
  const inverse = leading && invertSlideObjectMatrix(leading);
  const matrix = readSlideObjectTransformMatrix(
    { x: 0, y: 0, width, height },
    effective,
  );
  if (!inverse || !matrix) return null;
  const round = (value: number) => Number(value.toFixed(8)) + 0;
  const [a, b, c, d, e, f] = multiplySlideObjectMatrices(inverse, matrix);
  return slideObjectMatrix2dString([
    round(a),
    round(b),
    round(c),
    round(d),
    round(e),
    round(f),
  ]);
}

function authoredOriginPaints(
  element: HTMLElement,
  authored: string,
  computed: string | undefined,
): boolean {
  const authoredOrigin = parseSlideObjectTransformOrigin(authored);
  if (!authoredOrigin) return false;
  const { offsetWidth: width, offsetHeight: height } = element;
  const painted =
    computed && width > 0 && height > 0
      ? parseSlideObjectTransformOrigin(computed)?.(width, height)
      : null;
  if (!painted) return true;
  const wanted = authoredOrigin(width, height);
  return (
    Math.abs(wanted.x - painted.x) < 0.5 && Math.abs(wanted.y - painted.y) < 0.5
  );
}

export function readSlideObjectTransformSnapshot(
  element: HTMLElement,
): SlideObjectTransformSnapshot {
  const computedStyle = window.getComputedStyle(element);
  const computedTransform = computedStyle.transform;
  const authoredTransformOrigin = element.style.transformOrigin.trim();
  const computedTransformOrigin = computedStyle.transformOrigin?.trim();
  // An authored origin we cannot parse (calc(), var()) is already resolved to
  // pixels in the computed style, and so is one that a stylesheet !important
  // declaration overrides.
  const inlineTransformOrigin = authoredOriginPaints(
    element,
    authoredTransformOrigin,
    computedTransformOrigin,
  )
    ? authoredTransformOrigin
    : "";
  let transformOrigin =
    inlineTransformOrigin ||
    computedTransformOrigin ||
    authoredTransformOrigin ||
    "50% 50%";
  if (
    !inlineTransformOrigin &&
    computedTransformOrigin &&
    element.offsetWidth > 0 &&
    element.offsetHeight > 0
  ) {
    const origin = parseSlideObjectTransformOrigin(computedTransformOrigin)?.(
      element.offsetWidth,
      element.offsetHeight,
    );
    if (origin) {
      const format = (value: number) => {
        const rounded = Number(value.toFixed(8));
        return String(Object.is(rounded, -0) ? 0 : rounded);
      };
      transformOrigin = `${format((origin.x / element.offsetWidth) * 100)}% ${format((origin.y / element.offsetHeight) * 100)}%`;
    }
  }
  return {
    transform: composeSlideObjectTransform(
      element,
      computedStyle,
      // "none" is a transform that paints nothing, whatever the inline one
      // says; only an empty string is a style the browser did not compute.
      computedTransform || element.style.transform || "none",
    ),
    transformOrigin,
  };
}

function normalizeSlideObjectRoots(elements: HTMLElement[]): HTMLElement[] {
  const uniqueElements = Array.from(new Set(elements));
  return uniqueElements.filter(
    (element) =>
      !uniqueElements.some(
        (candidate) => candidate !== element && candidate.contains(element),
      ),
  );
}

function hasVisibleBorder(element: HTMLElement): boolean {
  const computed = window.getComputedStyle(element);
  return [
    [
      computed.borderTopStyle,
      computed.borderTopWidth,
      element.style.borderTopStyle,
      element.style.borderTopWidth,
    ],
    [
      computed.borderRightStyle,
      computed.borderRightWidth,
      element.style.borderRightStyle,
      element.style.borderRightWidth,
    ],
    [
      computed.borderBottomStyle,
      computed.borderBottomWidth,
      element.style.borderBottomStyle,
      element.style.borderBottomWidth,
    ],
    [
      computed.borderLeftStyle,
      computed.borderLeftWidth,
      element.style.borderLeftStyle,
      element.style.borderLeftWidth,
    ],
  ].some(([computedStyle, computedWidth, inlineStyle, inlineWidth]) => {
    const useComputed = computedStyle !== "" || computedWidth !== "";
    const style = useComputed ? computedStyle : inlineStyle;
    const width = useComputed ? computedWidth : inlineWidth;
    return (
      Number.parseFloat(width || "0") > 0 &&
      style !== "" &&
      style !== "none" &&
      style !== "hidden"
    );
  });
}

function hasIndependentlyPositionedDescendant(element: HTMLElement): boolean {
  return Array.from(element.querySelectorAll<HTMLElement>("*")).some(
    (descendant) => {
      const computedPosition = window.getComputedStyle(descendant).position;
      const position = computedPosition || descendant.style.position;
      return position === "absolute" || position === "fixed";
    },
  );
}

export function resolveSlideObjectMoveRoots(
  elements: HTMLElement[],
  selectedIds: ReadonlySet<string>,
  boundary?: HTMLElement,
): HTMLElement[] {
  const roots = normalizeSlideObjectRoots(elements).map((element) => {
    let current: HTMLElement | null = element;
    let promotedRoot: HTMLElement | null = null;
    while (current && current !== boundary) {
      const leaves = Array.from(
        current.querySelectorAll<HTMLElement>("[data-builder-id]"),
      ).filter((descendant) => !descendant.querySelector("[data-builder-id]"));
      const computedPosition = window.getComputedStyle(current).position;
      const position = computedPosition || current.style.position;
      if (
        hasVisibleBorder(current) &&
        (position === "absolute" ||
          !hasIndependentlyPositionedDescendant(current)) &&
        leaves.length > 0 &&
        leaves.every((leaf) => {
          const id = leaf.getAttribute("data-builder-id");
          return id !== null && selectedIds.has(id);
        })
      ) {
        promotedRoot = current;
      }
      current = current.parentElement;
    }
    return promotedRoot ?? element;
  });
  return normalizeSlideObjectRoots(roots);
}

export const SLIDE_OBJECT_GROUP_CLASS = "fmd-slide-group";

export function isSlideObjectGroup(element: HTMLElement): boolean {
  return (
    element.classList.contains(SLIDE_OBJECT_GROUP_CLASS) &&
    element.getAttribute("data-slide-group") === "true"
  );
}

export function resolveSlideObjectGroupRoot(
  element: HTMLElement,
  boundary?: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;
  while (current) {
    if (isSlideObjectGroup(current)) return current;
    if (current === boundary) break;
    current = current.parentElement;
  }
  return null;
}

const ORIGIN_KEYWORD_FRACTION = new Map([
  ["left", 0],
  ["top", 0],
  ["center", 0.5],
  ["right", 1],
  ["bottom", 1],
]);
const ORIGIN_NUMBER = new RegExp(`^(${CSS_NUMBER})(%|px)?$`);

function parseOriginOffset(
  token: string,
): [fraction: number, px: number] | null {
  const keyword = ORIGIN_KEYWORD_FRACTION.get(token);
  if (keyword !== undefined) return [keyword, 0];
  const match = ORIGIN_NUMBER.exec(token);
  const value = Number(match?.[1]);
  // Only a zero may go without a unit.
  if (!match || !Number.isFinite(value) || (!match[2] && value !== 0)) {
    return null;
  }
  return match[2] === "%" ? [value / 100, 0] : [0, value];
}

export type SlideObjectOriginResolver = (
  width: number,
  height: number,
) => { x: number; y: number };

/**
 * Reads a CSS `transform-origin` value (one to three tokens, keywords in either
 * order) into a function of the box it applies to. Null for anything else
 * (`calc()`, `var()`, em units, a malformed list): a guessed centre would move
 * the object, so callers refuse instead. An empty value is the CSS default,
 * the centre.
 */
export function parseSlideObjectTransformOrigin(
  value: string,
): SlideObjectOriginResolver | null {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 3) return null;
  const [first = "center", second = "center", depth] = tokens;
  if (depth !== undefined) {
    const length = ORIGIN_NUMBER.exec(depth);
    if (!length || length[2] === "%") return null;
  }
  const isVertical = (token: string) => token === "top" || token === "bottom";
  const isHorizontal = (token: string) => token === "left" || token === "right";
  // `top left` and `center left` name the axes in reverse, which CSS only
  // allows when both tokens are keywords; one token is the axis it names.
  const reversed = isVertical(first) || isHorizontal(second);
  if (
    reversed &&
    !(ORIGIN_KEYWORD_FRACTION.has(first) && ORIGIN_KEYWORD_FRACTION.has(second))
  ) {
    return null;
  }
  const [xToken, yToken] = reversed ? [second, first] : [first, second];
  if (isVertical(xToken) || isHorizontal(yToken)) return null;
  const x = parseOriginOffset(xToken);
  const y = parseOriginOffset(yToken);
  return x && y
    ? (width, height) => ({
        x: x[0] * width + x[1],
        y: y[0] * height + y[1],
      })
    : null;
}

function transformedSlideObjectBoundsForTransform(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
  transform: string,
  transformOrigin?: string,
): SlideObjectGeometry | null {
  if (!transform || transform === "none") return geometry;

  const computedStyle = window.getComputedStyle(element);
  let parsed = parseSlideObjectMatrix2d(transform);
  if (!parsed) {
    const rotation = transform.match(
      /^rotate(?:z)?\(\s*(-?(?:\d+\.?\d*|\.\d+))deg\s*\)$/i,
    );
    if (!rotation) return null;
    const radians = (Number(rotation[1]) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    parsed = {
      values: [cos, sin, -sin, cos, 0, 0],
      indexes: [0, 1, 2, 3, 4, 5],
    };
  }

  const [aIndex, bIndex, cIndex, dIndex, txIndex, tyIndex] = parsed.indexes;
  const a = parsed.values[aIndex] ?? 1;
  const b = parsed.values[bIndex] ?? 0;
  const c = parsed.values[cIndex] ?? 0;
  const d = parsed.values[dIndex] ?? 1;
  const tx = parsed.values[txIndex] ?? 0;
  const ty = parsed.values[tyIndex] ?? 0;
  const origin = parseSlideObjectTransformOrigin(
    transformOrigin ||
      computedStyle.transformOrigin ||
      element.style.transformOrigin,
  )?.(geometry.width, geometry.height);
  if (!origin) return null;
  const { x: originX, y: originY } = origin;
  const corners = [
    [0, 0],
    [geometry.width, 0],
    [0, geometry.height],
    [geometry.width, geometry.height],
  ];
  const points = corners.map(([x = 0, y = 0]) => ({
    x: originX + a * (x - originX) + c * (y - originY) + tx,
    y: originY + b * (x - originX) + d * (y - originY) + ty,
  }));
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return {
    x: geometry.x + left,
    y: geometry.y + top,
    width: right - left,
    height: bottom - top,
  };
}

export function groupSlideObjects(
  elements: readonly HTMLElement[],
  getGeometry: (element: HTMLElement) => SlideObjectGeometry,
  applyGeometry: SlideObjectGeometryApplier,
): HTMLElement | null {
  const roots = normalizeSlideObjectRoots([...elements]);
  if (roots.length < 2) return null;
  const parent = roots[0]?.parentElement;
  if (
    !parent ||
    roots.some(
      (element) =>
        element.parentElement !== parent ||
        !element.getAttribute("data-slide-object-id") ||
        !isEditableFreeformSlideObject(element),
    )
  ) {
    return null;
  }

  const orderedRoots = [...roots].sort(
    (left, right) =>
      Array.prototype.indexOf.call(parent.children, left) -
      Array.prototype.indexOf.call(parent.children, right),
  );
  const members: {
    element: HTMLElement;
    geometry: SlideObjectGeometry;
    visualBounds: SlideObjectGeometry;
  }[] = [];
  for (const element of orderedRoots) {
    const geometry = getGeometry(element);
    const visualBounds = transformedSlideObjectBoundsForTransform(
      element,
      geometry,
      readSlideObjectTransformSnapshot(element).transform,
    );
    if (!visualBounds) return null;
    members.push({
      element,
      geometry,
      visualBounds,
    });
  }
  const bounds = unionSlideObjectGeometries(
    members.map((member) => member.visualBounds),
  );
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const group = parent.ownerDocument.createElement("div");
  group.className = SLIDE_OBJECT_GROUP_CLASS;
  group.setAttribute("data-slide-group", "true");
  group.setAttribute("data-slide-object-id", createSlideObjectId());
  group.style.position = "absolute";
  group.style.left = `${bounds.x}px`;
  group.style.top = `${bounds.y}px`;
  group.style.width = `${bounds.width}px`;
  group.style.height = `${bounds.height}px`;
  group.style.boxSizing = "border-box";

  const explicitZIndexes = members
    .map(({ element }) => readSlideLayerZIndex(element))
    .filter((value): value is number => value !== null);
  if (explicitZIndexes.length > 0) {
    group.style.zIndex = String(Math.max(...explicitZIndexes));
  }

  const topmostRoot = orderedRoots.at(-1);
  parent.insertBefore(group, topmostRoot?.nextSibling ?? null);
  group.append(...orderedRoots);
  for (const { element, geometry } of members) {
    applyGeometry(
      element,
      planSlideObjectGeometry(element, {
        x: geometry.x - bounds.x,
        y: geometry.y - bounds.y,
        width: geometry.width,
        height: geometry.height,
      }),
    );
  }
  return group;
}

export function ungroupSlideObject(
  group: HTMLElement,
  getGeometry: (element: HTMLElement) => SlideObjectGeometry,
  applyGeometry: SlideObjectGeometryApplier,
): HTMLElement[] | null {
  if (!isSlideObjectGroup(group)) return null;
  const parent = group.parentElement;
  const children = Array.from(group.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (
    !parent ||
    children.length < 2 ||
    children.some(
      (child) =>
        !child.getAttribute("data-slide-object-id") ||
        !isEditableFreeformSlideObject(child),
    )
  ) {
    return null;
  }

  const groupGeometry = getGeometry(group);
  const groupRotation = readSlideObjectRotation(group);
  if (groupRotation === null) return null;
  const groupRotationRadians = (groupRotation * Math.PI) / 180;
  const groupRotationCos = Math.cos(groupRotationRadians);
  const groupRotationSin = Math.sin(groupRotationRadians);
  const groupCenter = {
    x: groupGeometry.x + groupGeometry.width / 2,
    y: groupGeometry.y + groupGeometry.height / 2,
  };
  const childOrder = new Map(
    children.map((element, index) => [element, index]),
  );
  const childGeometries = [...children]
    .sort(
      (left, right) =>
        (readSlideLayerZIndex(left) ?? 0) -
          (readSlideLayerZIndex(right) ?? 0) ||
        (childOrder.get(left) ?? 0) - (childOrder.get(right) ?? 0),
    )
    .map((element) => ({
      element,
      geometry: getGeometry(element),
    }));
  const transforms = new Map<
    HTMLElement,
    {
      nextTransform: string;
      currentCenterOffset: { x: number; y: number };
      nextCenterOffset: { x: number; y: number };
    }
  >();
  if (groupRotation !== 0) {
    for (const { element, geometry } of childGeometries) {
      // The turned transform is written inline below, so one that cannot paint
      // there would leave the member where the group's rotation no longer is.
      if (!inlineTransformPaints(element)) return null;
      const currentMatrix = readSlideObjectTransformMatrix(
        geometry,
        readSlideObjectTransformSnapshot(element).transform,
      );
      if (!currentMatrix) return null;
      const currentCenterOffset = slideObjectTransformCenterOffset(
        element,
        geometry,
        currentMatrix,
      );
      if (!currentCenterOffset) return null;
      const nextTransform = rotatedSlideObjectMatrix(
        slideObjectMatrix2dString(currentMatrix),
        slideObjectMatrixRotation(currentMatrix) + groupRotation,
      );
      if (!nextTransform) return null;
      const nextParsed = parseSlideObjectMatrix2d(nextTransform);
      if (!nextParsed) return null;
      const nextCenterOffset = slideObjectTransformCenterOffset(
        element,
        geometry,
        slideObjectMatrix2dValues(nextParsed),
      );
      if (!nextCenterOffset) return null;
      const writable = toTransformProperty(
        element,
        geometry.width,
        geometry.height,
        nextTransform,
      );
      if (writable === null) return null;
      transforms.set(element, {
        nextTransform: writable,
        currentCenterOffset,
        nextCenterOffset,
      });
    }
  }
  const groupZIndex = readSlideLayerZIndex(group);
  for (const { element } of childGeometries) {
    parent.insertBefore(element, group);
    element.style.zIndex = groupZIndex === null ? "auto" : String(groupZIndex);
  }
  for (const { element, geometry } of childGeometries) {
    const absoluteGeometry = {
      x: groupGeometry.x + geometry.x,
      y: groupGeometry.y + geometry.y,
      width: geometry.width,
      height: geometry.height,
    };
    const memberCenter = {
      x: absoluteGeometry.x + absoluteGeometry.width / 2,
      y: absoluteGeometry.y + absoluteGeometry.height / 2,
    };
    const offset = {
      x: memberCenter.x - groupCenter.x,
      y: memberCenter.y - groupCenter.y,
    };
    const rotatedCenter = {
      x:
        groupCenter.x +
        offset.x * groupRotationCos -
        offset.y * groupRotationSin,
      y:
        groupCenter.y +
        offset.x * groupRotationSin +
        offset.y * groupRotationCos,
    };
    const transform = transforms.get(element);
    const transformCorrection = transform
      ? {
          x:
            transform.currentCenterOffset.x * groupRotationCos -
            transform.currentCenterOffset.y * groupRotationSin -
            transform.nextCenterOffset.x,
          y:
            transform.currentCenterOffset.x * groupRotationSin +
            transform.currentCenterOffset.y * groupRotationCos -
            transform.nextCenterOffset.y,
        }
      : { x: 0, y: 0 };
    applyGeometry(
      element,
      planSlideObjectGeometry(element, {
        x: rotatedCenter.x - absoluteGeometry.width / 2 + transformCorrection.x,
        y:
          rotatedCenter.y - absoluteGeometry.height / 2 + transformCorrection.y,
        width: geometry.width,
        height: geometry.height,
      }),
    );
    if (transform) {
      element.style.setProperty(
        "transform",
        transform.nextTransform,
        element.style.getPropertyPriority("transform"),
      );
    }
  }
  group.remove();
  return childGeometries.map(({ element }) => element);
}

export interface SlideObjectRotationMember
  extends SlideObjectMoveMember, SlideObjectTransformSnapshot {
  /** Null when the object's rotation could not be read. */
  rotation: number | null;
}

function formatSlideObjectRotation(rotation: number): string {
  const value = Number(rotation.toFixed(2));
  return `${Object.is(value, -0) ? 0 : value}deg`;
}

function parseSlideObjectMatrix2d(transform: string): {
  values: number[];
  indexes: [number, number, number, number, number, number];
} | null {
  const number = "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?";
  const matrix = transform.match(
    new RegExp(
      `^matrix\\(\\s*(${number})(?:\\s*,\\s*(${number})){5}\\s*\\)$`,
      "i",
    ),
  );
  if (matrix) {
    const values = matrix[0]
      .slice(matrix[0].indexOf("(") + 1, -1)
      .split(",")
      .map((value) => Number(value.trim()));
    if (values.length === 6 && values.every(Number.isFinite)) {
      return { values, indexes: [0, 1, 2, 3, 4, 5] };
    }
  }

  const matrix3d = transform.match(new RegExp(`^matrix3d\\((.*)\\)$`, "i"));
  if (matrix3d?.[1]) {
    const values = matrix3d[1].split(",").map((value) => Number(value.trim()));
    if (values.length !== 16 || !values.every(Number.isFinite)) return null;
    const planarIndexes = new Map([
      [2, 0],
      [3, 0],
      [6, 0],
      [7, 0],
      [8, 0],
      [9, 0],
      [10, 1],
      [11, 0],
      [14, 0],
      [15, 1],
    ]);
    if (
      Array.from(planarIndexes).some(
        ([index, expected]) => Math.abs((values[index] ?? 0) - expected) > 1e-8,
      )
    ) {
      return null;
    }
    return {
      values,
      indexes: [0, 1, 4, 5, 12, 13],
    };
  }

  if (typeof DOMMatrixReadOnly === "undefined") return null;
  let domMatrix: DOMMatrixReadOnly;
  try {
    domMatrix = new DOMMatrixReadOnly(transform);
  } catch {
    // coercion-ok: Invalid or relative transforms are unavailable; strict geometry callers reject them.
    return null;
  }
  if (!domMatrix.is2D) return null;
  return {
    values: [
      domMatrix.a,
      domMatrix.b,
      domMatrix.c,
      domMatrix.d,
      domMatrix.e,
      domMatrix.f,
    ],
    indexes: [0, 1, 2, 3, 4, 5],
  };
}

type SlideObjectTransformMatrix2d = [
  number,
  number,
  number,
  number,
  number,
  number,
];

function slideObjectMatrix2dValues(parsed: {
  values: number[];
  indexes: [number, number, number, number, number, number];
}): SlideObjectTransformMatrix2d {
  const [aIndex, bIndex, cIndex, dIndex, txIndex, tyIndex] = parsed.indexes;
  return [
    parsed.values[aIndex] ?? 1,
    parsed.values[bIndex] ?? 0,
    parsed.values[cIndex] ?? 0,
    parsed.values[dIndex] ?? 1,
    parsed.values[txIndex] ?? 0,
    parsed.values[tyIndex] ?? 0,
  ];
}

function slideObjectMatrix2dString(
  matrix: SlideObjectTransformMatrix2d,
): string {
  return `matrix(${matrix.join(", ")})`;
}

function parseTransformLength(
  value: string | undefined,
  dimension: number,
): number | null {
  if (!value) return 0;
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px|%)?$/i.test(value)) return null;
  const number = Number.parseFloat(value);
  return value.endsWith("%") ? (number * dimension) / 100 : number;
}

function readSlideObjectTransformMatrix(
  geometry: SlideObjectGeometry,
  transform: string,
): SlideObjectTransformMatrix2d | null {
  if (!transform || transform.trim() === "none") {
    return [1, 0, 0, 1, 0, 0];
  }
  const parsed = parseSlideObjectMatrix2d(transform);
  if (parsed) return slideObjectMatrix2dValues(parsed);

  const rotation = transform.match(
    /^rotate(?:z)?\(\s*(-?(?:\d+\.?\d*|\.\d+))deg\s*\)$/i,
  );
  if (rotation) {
    const radians = (Number(rotation[1]) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [cos, sin, -sin, cos, 0, 0];
  }

  const translate = transform.match(/^translate(?:3d|x|y)?\(([^()]*)\)$/i);
  if (!translate) return null;
  const kind = transform.match(/^translate(?:3d|x|y)?/i)?.[0]?.toLowerCase();
  const values = translate[1]?.split(/[\s,]+/).filter(Boolean) ?? [];
  const x =
    kind === "translatey" ? 0 : parseTransformLength(values[0], geometry.width);
  const y =
    kind === "translatex"
      ? 0
      : parseTransformLength(
          kind === "translatey" ? values[0] : values[1],
          geometry.height,
        );
  const z = kind === "translate3d" ? parseTransformLength(values[2], 0) : 0;
  return x !== null && y !== null && z === 0 ? [1, 0, 0, 1, x, y] : null;
}

export function resizeTransformedSlideObject(
  start: SlideObjectGeometry,
  transform: SlideObjectTransformSnapshot,
  {
    handle,
    dx,
    dy,
    preserveAspectRatio,
    altKey = false,
    fitText = false,
    minSize = MIN_SLIDE_OBJECT_SIZE,
  }: ResizeOptions & { altKey?: boolean; fitText?: boolean },
): SlideObjectGeometry | null {
  const matrix = readSlideObjectTransformMatrix(start, transform.transform);
  if (!matrix) return null;
  const [a, b, c, d, tx, ty] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }

  // A fit text box takes its height from its text, so only the local
  // horizontal travel resizes it.
  const localDelta = {
    x: (d * dx - c * dy) / determinant,
    y: fitText ? 0 : (a * dy - b * dx) / determinant,
  };
  const resized = resizeCanvasRect(start, {
    handle,
    delta: localDelta,
    altKey,
    preserveAspectRatio: preserveAspectRatio && !fitText,
    minWidth: minSize,
    minHeight: minSize,
  });
  const resolveOrigin = parseSlideObjectTransformOrigin(
    transform.transformOrigin,
  );
  if (!resolveOrigin) return null;
  const transformedPoint = (
    point: { x: number; y: number },
    width: number,
    height: number,
  ) => {
    const { x: originX, y: originY } = resolveOrigin(width, height);
    return {
      x: originX + a * (point.x - originX) + c * (point.y - originY) + tx,
      y: originY + b * (point.x - originX) + d * (point.y - originY) + ty,
    };
  };
  const oppositeAnchor = (geometry: SlideObjectGeometry) => {
    const fromWest = handle === "nw" || handle === "w" || handle === "sw";
    const fromEast = handle === "ne" || handle === "e" || handle === "se";
    const fromNorth = handle === "nw" || handle === "n" || handle === "ne";
    const fromSouth = handle === "sw" || handle === "s" || handle === "se";
    return {
      x: altKey
        ? geometry.width / 2
        : fromWest
          ? geometry.width
          : fromEast
            ? 0
            : geometry.width / 2,
      y: altKey
        ? geometry.height / 2
        : fromNorth
          ? geometry.height
          : fromSouth
            ? 0
            : geometry.height / 2,
    };
  };

  const fixedAnchor = transformedPoint(
    oppositeAnchor(start),
    start.width,
    start.height,
  );
  const nextAnchor = transformedPoint(
    oppositeAnchor(resized),
    resized.width,
    resized.height,
  );
  return {
    ...resized,
    x: start.x + fixedAnchor.x - nextAnchor.x,
    y: start.y + fixedAnchor.y - nextAnchor.y,
  };
}

export function readSlideObjectSelectionFrame(
  element: HTMLElement,
  rect: Pick<
    DOMRect,
    "left" | "top" | "width" | "height"
  > = element.getBoundingClientRect(),
  { contentHeight }: { contentHeight?: number | "scroll" } = {},
): SlideObjectSelectionFrame | null {
  const geometry = {
    x: 0,
    y: 0,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
  if (geometry.width <= 0 || geometry.height <= 0) return null;

  const snapshot = readSlideObjectTransformSnapshot(element);
  const matrix = readSlideObjectTransformMatrix(geometry, snapshot.transform);
  const localBounds = transformedSlideObjectBoundsForTransform(
    element,
    geometry,
    snapshot.transform,
    snapshot.transformOrigin,
  );
  if (
    !matrix ||
    !localBounds ||
    localBounds.width <= 0 ||
    localBounds.height <= 0
  ) {
    return null;
  }

  const scaleX = rect.width / localBounds.width;
  const scaleY = rect.height / localBounds.height;
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  ) {
    return null;
  }

  const [a, b, c, d, tx, ty] = matrix;
  const origin = parseSlideObjectTransformOrigin(snapshot.transformOrigin)?.(
    geometry.width,
    geometry.height,
  );
  if (!origin) return null;
  const format = (value: number) => {
    const rounded = Number(value.toFixed(8));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  // A size-contained block keeps its offsetHeight while its text overflows, so
  // the outline height can only come from the content; scale stays measured
  // from the real box.
  const measuredContentHeight =
    contentHeight === "scroll" ? element.scrollHeight : (contentHeight ?? 0);

  return {
    left: rect.left - localBounds.x * scaleX,
    top: rect.top - localBounds.y * scaleY,
    width: geometry.width * scaleX,
    height: Math.max(geometry.height, measuredContentHeight) * scaleY,
    transform: slideObjectMatrix2dString([
      a,
      (scaleY / scaleX) * b,
      (scaleX / scaleY) * c,
      d,
      scaleX * tx,
      scaleY * ty,
    ]),
    transformOrigin: {
      x: format(scaleX * origin.x),
      y: format(scaleY * origin.y),
    },
  };
}

function slideObjectTransformCenterOffset(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
  matrix: SlideObjectTransformMatrix2d,
): { x: number; y: number } | null {
  const origin = parseSlideObjectTransformOrigin(
    window.getComputedStyle(element).transformOrigin ||
      element.style.transformOrigin,
  )?.(geometry.width, geometry.height);
  if (!origin) return null;
  const { x: originX, y: originY } = origin;
  const centerX = geometry.width / 2;
  const centerY = geometry.height / 2;
  const [a, b, c, d, tx, ty] = matrix;
  return {
    x:
      a * (centerX - originX) +
      c * (centerY - originY) +
      tx +
      originX -
      centerX,
    y:
      b * (centerX - originX) +
      d * (centerY - originY) +
      ty +
      originY -
      centerY,
  };
}

function rotatedSlideObjectMatrix(
  transform: string,
  rotation: number,
): string | null {
  const parsed = parseSlideObjectMatrix2d(transform);
  if (!parsed) return null;
  const [aIndex, bIndex, cIndex, dIndex] = parsed.indexes;
  const a = parsed.values[aIndex] ?? 1;
  const b = parsed.values[bIndex] ?? 0;
  const c = parsed.values[cIndex] ?? 0;
  const d = parsed.values[dIndex] ?? 1;
  const currentAngle = slideObjectMatrixAngle(a, b, c, d);
  const currentCos = Math.cos(currentAngle);
  const currentSin = Math.sin(currentAngle);
  const residualA = currentCos * a + currentSin * b;
  const residualB = -currentSin * a + currentCos * b;
  const residualC = currentCos * c + currentSin * d;
  const residualD = -currentSin * c + currentCos * d;
  const nextAngle = (rotation * Math.PI) / 180;
  const nextCos = Math.cos(nextAngle);
  const nextSin = Math.sin(nextAngle);
  const nextValues = [...parsed.values];
  nextValues[aIndex] = nextCos * residualA - nextSin * residualB;
  nextValues[bIndex] = nextSin * residualA + nextCos * residualB;
  nextValues[cIndex] = nextCos * residualC - nextSin * residualD;
  nextValues[dIndex] = nextSin * residualC + nextCos * residualD;

  const format = (value: number) => {
    const rounded = Number(value.toFixed(8));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  };
  return `matrix${parsed.values.length === 16 ? "3d" : ""}(${nextValues.map(format).join(", ")})`;
}

/** Screen px moved per local css px: screen = [a c; b d] * local. */
export interface ScreenBasis {
  a: number;
  b: number;
  c: number;
  d: number;
}

const SCREEN_BASIS_PROBE_UNITS = 100;

/**
 * Whether `from` or an ancestor up to `to` rotates or skews. A uniform scale
 * converts pointer deltas by width and height alone; a rotation needs the
 * full basis.
 */
export function hasRotatedAncestor(
  from: HTMLElement,
  to: HTMLElement,
): boolean {
  for (
    let element: HTMLElement | null = from;
    element;
    element = element === to ? null : element.parentElement
  ) {
    const style = window.getComputedStyle(element);
    if (style.rotate && style.rotate !== "none" && style.rotate !== "0deg") {
      return true;
    }
    if (!style.transform || style.transform === "none") continue;
    const matrix = parseSlideObjectMatrix2d(style.transform);
    if (!matrix) return true;
    const [, bIndex, cIndex] = matrix.indexes;
    if (
      Math.abs(matrix.values[bIndex] ?? 0) > 1e-4 ||
      Math.abs(matrix.values[cIndex] ?? 0) > 1e-4
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Read how a containing block maps local `left`/`top` to the screen by
 * placing a hidden probe in it, so ancestors' rotations and scales (including
 * AutoFit) are measured rather than reconstructed. Null when the block has no
 * invertible mapping.
 */
export function probeScreenBasis(space: HTMLElement): ScreenBasis | null {
  return probeScreenFrame(space)?.basis ?? null;
}

/** The basis plus the screen position of the block's `left: 0; top: 0`. */
function probeScreenFrame(
  space: HTMLElement,
): { basis: ScreenBasis; origin: { x: number; y: number } } | null {
  const probe = space.ownerDocument.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;visibility:hidden";
  space.append(probe);
  try {
    const origin = probe.getBoundingClientRect();
    probe.style.left = `${SCREEN_BASIS_PROBE_UNITS}px`;
    const along = probe.getBoundingClientRect();
    probe.style.left = "0";
    probe.style.top = `${SCREEN_BASIS_PROBE_UNITS}px`;
    const down = probe.getBoundingClientRect();
    const basis = {
      a: (along.left - origin.left) / SCREEN_BASIS_PROBE_UNITS,
      b: (along.top - origin.top) / SCREEN_BASIS_PROBE_UNITS,
      c: (down.left - origin.left) / SCREEN_BASIS_PROBE_UNITS,
      d: (down.top - origin.top) / SCREEN_BASIS_PROBE_UNITS,
    };
    const determinant = basis.a * basis.d - basis.b * basis.c;
    return Object.values(basis).every(Number.isFinite) &&
      Math.abs(determinant) > 1e-6
      ? { basis, origin: { x: origin.left, y: origin.top } }
      : null;
  } finally {
    probe.remove();
  }
}

export function screenDeltaToLocal(
  basis: ScreenBasis,
  delta: { x: number; y: number },
): { x: number; y: number } {
  const determinant = basis.a * basis.d - basis.b * basis.c;
  return {
    x: (basis.d * delta.x - basis.c * delta.y) / determinant,
    y: (basis.a * delta.y - basis.b * delta.x) / determinant,
  };
}

/**
 * A rotation in the one range the editor reads and shows: clockwise degrees in
 * [0, 360). A browser reports every painted transform as a matrix, so the
 * authored 200deg and -160deg are the same rotation by the time they are read.
 */
export function wrapSlideObjectRotation(degrees: number): number {
  const wrapped = Number((((degrees % 360) + 360) % 360).toFixed(10));
  return wrapped >= 360 ? 0 : wrapped;
}

/**
 * A matrix that mirrors reads as its rotation after the x axis is mirrored, so
 * setting a rotation turns the object and never swaps the axis it is mirrored
 * on.
 */
function slideObjectMatrixAngle(a: number, b: number, c: number, d: number) {
  const mirrored = a * d - b * c < 0;
  return Math.atan2(mirrored ? -b : b, mirrored ? -a : a);
}

function slideObjectMatrixRotation([a, b, c, d]: SlideObjectTransformMatrix2d) {
  return wrapSlideObjectRotation(
    (slideObjectMatrixAngle(a, b, c, d) * 180) / Math.PI,
  );
}

/**
 * What an object paints: its transform and that as a matrix. Null when it is
 * not readable, or collapses the object, which has no rotation either.
 */
function readPaintedSlideObject(
  element: HTMLElement,
): { transform: string; matrix: SlideObjectTransformMatrix2d } | null {
  const { transform } = readSlideObjectTransformSnapshot(element);
  const matrix = readSlideObjectTransformMatrix(
    { x: 0, y: 0, width: element.offsetWidth, height: element.offsetHeight },
    transform,
  );
  return matrix && invertSlideObjectMatrix(matrix)
    ? { transform, matrix }
    : null;
}

/**
 * The rotation the object paints, in [0, 360), or null when its transform is
 * not readable. It is the angle of the effective matrix, so a stylesheet rule,
 * the rotate property and an inline transform all read the same way.
 */
export function readSlideObjectRotation(element: HTMLElement): number | null {
  const painted = readPaintedSlideObject(element);
  return painted ? slideObjectMatrixRotation(painted.matrix) : null;
}

/** Whether the object paints `rotation` degrees, to a hundredth of a degree. */
export function slideObjectPaintsRotation(
  element: HTMLElement,
  rotation: number,
): boolean {
  const painting = readSlideObjectRotation(element);
  return (
    painting !== null &&
    Math.abs(
      ((painting - wrapSlideObjectRotation(rotation) + 540) % 360) - 180,
    ) < 0.01
  );
}

/**
 * Whether a plain inline `transform` written to the element goes on painting:
 * not under a stylesheet !important declaration, nor under a CSS animation
 * that is running or still to start on a transform property.
 */
function inlineTransformPaints(element: HTMLElement): boolean {
  if (hasTransformAnimation(element)) return false;
  // An inline important transform beats its own CSS animation. A plain probe
  // would incorrectly treat that animation as the winner.
  if (element.style.getPropertyPriority("transform") === "important") {
    return true;
  }
  return inlineValuePaints(element, "transform", TRANSFORM_PROBES.transform);
}

/**
 * The rotation the object paints, or null when it has none to read or an inline
 * transform could not turn it: a stylesheet !important declaration or a CSS
 * animation keeps painting the rotation it has, whatever a handle writes.
 */
export function readEditableSlideObjectRotation(
  element: HTMLElement,
): number | null {
  const rotation = readSlideObjectRotation(element);
  return rotation !== null && inlineTransformPaints(element) ? rotation : null;
}

export function resolveSlideObjectRotationDelta(
  startAngle: number,
  center: { x: number; y: number },
  point: { x: number; y: number },
  snapToFifteenDegrees: boolean,
): number {
  let delta =
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI -
    startAngle;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return snapToFifteenDegrees ? Math.round(delta / 15) * 15 : delta;
}

// A computed matrix carries six significant digits.
function isPureSlideObjectRotation([
  a,
  b,
  c,
  d,
  e,
  f,
]: SlideObjectTransformMatrix2d) {
  return (
    Math.abs(a - d) < 1e-4 &&
    Math.abs(b + c) < 1e-4 &&
    Math.abs(Math.hypot(a, b) - 1) < 1e-4 &&
    Math.abs(e) < 1e-3 &&
    Math.abs(f) < 1e-3
  );
}

/**
 * Sets the whole rotation an object paints to `rotation` degrees, wrapped into
 * [0, 360), keeping the scale, skew and translation it paints with. It edits
 * the effective transform, so one that a stylesheet or the rotate property
 * supplies is kept rather than overwritten. False, with nothing written, when
 * that transform has no rotation to set or the object goes on painting another
 * rotation: a stylesheet !important declaration beats the inline transform
 * written here, and a CSS animation on a transform property keeps moving it.
 */
export function setSlideObjectRotation(
  element: HTMLElement,
  rotation: number,
): boolean {
  const painted = readPaintedSlideObject(element);
  if (!painted || hasTransformAnimation(element)) return false;
  const target = wrapSlideObjectRotation(rotation);
  const { style } = element;
  const priority = style.getPropertyPriority("transform");
  const before = element.getAttribute("style");
  const restoreOriginalStyle = () => {
    restoreStyleAttribute(element, before);
    const originalTransitions = captureInlineTransitions(element);
    style.setProperty("transition", "none", "important");
    window.getComputedStyle(element).getPropertyValue("transform");
    restoreInlineTransitions(element, originalTransitions);
    restoreStyleAttribute(element, before);
  };
  const write = (value: string) => {
    const finalStyle = element.ownerDocument.createElement("div").style;
    if (before !== null) finalStyle.cssText = before;
    finalStyle.setProperty("transform", value, priority);

    // Read back with transitions off: one would still paint the old rotation.
    style.setProperty("transition", "none", "important");
    style.setProperty("transform", value, priority);
    const paints = slideObjectPaintsRotation(element, target);
    // Replace the probe declarations as one style update. The transform is
    // already at its final value, so restoring the authored transitions cannot
    // start a transition from the original rotation.
    if (paints) element.setAttribute("style", finalStyle.cssText);
    else restoreOriginalStyle();
    return paints;
  };

  // A transform list the author wrote keeps its own units, so a centring
  // translate(-50%, -50%) goes on following the object's size. Only its
  // rotation is replaced, and only if that paints the rotation asked for: a
  // list with two rotate()s or a skew does not.
  const authored = style.transform.trim();
  if (
    authored &&
    authored !== "none" &&
    !/^matrix/i.test(authored) &&
    !readTransformLonghands(element, window.getComputedStyle(element)) &&
    write(slideObjectRotationTransform(authored, target))
  ) {
    return true;
  }

  const writable = toTransformProperty(
    element,
    element.offsetWidth,
    element.offsetHeight,
    isPureSlideObjectRotation(painted.matrix)
      ? `rotate(${formatSlideObjectRotation(target)})`
      : slideObjectRotationTransform(painted.transform.trim(), target),
  );
  return writable !== null && write(writable);
}

function slideObjectRotationTransform(
  currentTransform: string,
  rotation: number,
): string {
  const next = `rotate(${formatSlideObjectRotation(rotation)})`;
  const current = currentTransform.trim();
  if (!current || current === "none") {
    return next;
  }
  if (/^matrix(?:3d)?\(/i.test(current)) {
    const matrix = rotatedSlideObjectMatrix(current, rotation);
    if (matrix) return matrix;
  }
  const rotatePattern = /rotate(?:z)?\(\s*-?(?:\d+\.?\d*|\.\d+)deg\s*\)/i;
  return rotatePattern.test(current)
    ? current.replace(rotatePattern, next)
    : `${current} ${next}`;
}

export function rotateSlideObjectMembers(
  members: readonly SlideObjectRotationMember[],
  deltaDegrees: number,
): Map<
  string,
  { geometry: SlideObjectGeometry; rotation: number; transform: string }
> {
  const transformedMembers = members.map((member) => {
    if (member.rotation === null) return null;
    const currentBounds = transformedSlideObjectBoundsForTransform(
      member.element,
      member.start,
      member.transform,
      member.transformOrigin,
    );
    const rotation = wrapSlideObjectRotation(member.rotation + deltaDegrees);
    const nextTransform = slideObjectRotationTransform(
      member.transform.trim(),
      rotation,
    );
    const nextBounds = transformedSlideObjectBoundsForTransform(
      member.element,
      member.start,
      nextTransform,
      member.transformOrigin,
    );
    const writable = toTransformProperty(
      member.element,
      member.start.width,
      member.start.height,
      nextTransform,
    );
    return currentBounds && nextBounds && writable !== null
      ? {
          member,
          currentBounds,
          nextBounds,
          rotation,
          transform: writable,
        }
      : null;
  });
  if (transformedMembers.some((member) => !member)) return new Map();
  const plannedMembers = transformedMembers.filter(
    (member): member is NonNullable<typeof member> => member !== null,
  );
  const bounds = unionSlideObjectGeometries(
    plannedMembers.map((member) => member.currentBounds),
  );
  if (!bounds) return new Map();
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const radians = (deltaDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const plan = new Map<
    string,
    { geometry: SlideObjectGeometry; rotation: number; transform: string }
  >();

  for (const {
    member,
    currentBounds,
    nextBounds,
    rotation,
    transform,
  } of plannedMembers) {
    const memberCenter = {
      x: currentBounds.x + currentBounds.width / 2,
      y: currentBounds.y + currentBounds.height / 2,
    };
    const offset = {
      x: memberCenter.x - center.x,
      y: memberCenter.y - center.y,
    };
    const nextCenter = {
      x: center.x + offset.x * cos - offset.y * sin,
      y: center.y + offset.x * sin + offset.y * cos,
    };
    const nextLayoutCenter = {
      x:
        nextCenter.x -
        (nextBounds.x +
          nextBounds.width / 2 -
          (member.start.x + member.start.width / 2)),
      y:
        nextCenter.y -
        (nextBounds.y +
          nextBounds.height / 2 -
          (member.start.y + member.start.height / 2)),
    };
    plan.set(member.objectId, {
      geometry: {
        x: nextLayoutCenter.x - member.start.width / 2,
        y: nextLayoutCenter.y - member.start.height / 2,
        width: member.start.width,
        height: member.start.height,
      },
      rotation,
      transform,
    });
  }
  return plan;
}

export function isValidSlideClipboardRoot(element: HTMLElement): boolean {
  return !SLIDE_CLIPBOARD_STRUCTURAL_CHILDREN.has(element.tagName);
}

export function collectMovableSlideObjects(
  elements: HTMLElement[],
  getGeometry: (element: HTMLElement) => SlideObjectGeometry,
): SlideObjectMoveMember[] {
  const seen = new Set<string>();
  const members: SlideObjectMoveMember[] = [];
  for (const element of normalizeSlideObjectRoots(elements)) {
    const objectId = element.getAttribute("data-slide-object-id");
    if (!objectId || seen.has(objectId)) continue;
    if (
      (element.style.position || window.getComputedStyle(element).position) !==
      "absolute"
    ) {
      continue;
    }
    seen.add(objectId);
    members.push({ objectId, element, start: getGeometry(element) });
  }
  return members;
}

/**
 * Append a fresh copy of every member to the end of its original's parent.
 * Each copy has its own object id (and fresh ids for nested objects), no
 * transient builder ids, and the member's starting geometry. Appending keeps
 * every existing sibling's child-index path, which animations persist.
 */
export function duplicateSlideObjectMembers(
  members: readonly SlideObjectMoveMember[],
): SlideObjectMoveMember[] {
  return members.map((member) => {
    const clone = cloneSlideObject(member.element);
    member.element.parentElement!.appendChild(clone);
    return {
      objectId: clone.getAttribute("data-slide-object-id")!,
      element: clone,
      start: member.start,
    };
  });
}

export function applySlideObjectMoveDelta(
  members: SlideObjectMoveMember[],
  deltaX: number,
  deltaY: number,
  applyGeometry: SlideObjectGeometryApplier,
): void {
  // Plans read computed style and writes invalidate it; planning every member
  // first keeps a group move to one style recalc instead of one per member.
  const plans = members.map((member) =>
    planSlideObjectGeometry(member.element, {
      ...member.start,
      x: member.start.x + deltaX,
      y: member.start.y + deltaY,
    }),
  );
  members.forEach((member, index) => {
    applyGeometry(member.element, plans[index]);
  });
}

export type SlideAlignmentGuideOrientation = "vertical" | "horizontal";

export interface SlideAlignmentGuide {
  orientation: SlideAlignmentGuideOrientation;
  position: number;
  start: number;
  end: number;
  /** One gap of an equal-spacing snap; drawn blue, not as an alignment line. */
  equalSpacing?: boolean;
}

export interface SlideObjectSnapResult {
  deltaX: number;
  deltaY: number;
  guides: SlideAlignmentGuide[];
}

export type SlideObjectAlignment =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";

export type SlideObjectDistribution = "horizontal" | "vertical";

export const SLIDE_OBJECT_SNAP_TOLERANCE = 8;
export const SLIDE_OBJECT_SNAP_SCREEN_TOLERANCE = 4;

function nearestSnapAdjustment(
  movingStart: number,
  movingSize: number,
  proposedDelta: number,
  targetPositions: number[],
  tolerance: number,
): { delta: number; distance: number; position: number } | null {
  const anchors = [0, movingSize / 2, movingSize];
  let closest: { distance: number; delta: number; position: number } | null =
    null;

  for (const anchor of anchors) {
    const proposedPosition = movingStart + proposedDelta + anchor;
    for (const position of targetPositions) {
      const adjustment = position - proposedPosition;
      const distance = Math.abs(adjustment);
      // Google Slides snaps at 3 screen px and not at 4, so the radius is open.
      if (distance >= tolerance) continue;
      if (!closest || distance < closest.distance) {
        closest = { distance, delta: proposedDelta + adjustment, position };
      }
    }
  }

  return closest
    ? {
        delta: closest.delta,
        distance: closest.distance,
        position: closest.position,
      }
    : null;
}

interface SnapSpan {
  start: number;
  end: number;
  crossStart: number;
  crossEnd: number;
}

function snapSpan(geometry: SlideObjectGeometry, axis: "x" | "y"): SnapSpan {
  return axis === "x"
    ? {
        start: geometry.x,
        end: geometry.x + geometry.width,
        crossStart: geometry.y,
        crossEnd: geometry.y + geometry.height,
      }
    : {
        start: geometry.y,
        end: geometry.y + geometry.height,
        crossStart: geometry.x,
        crossEnd: geometry.x + geometry.width,
      };
}

function spansOverlap(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && b0 < a1;
}

// Gaps under one slide unit are adjacency, which the edge anchors already snap.
const MIN_EQUAL_SPACING_GAP = 1;
const ALIGNMENT_EPSILON = 0.01;
// Google draws the spacing guide just below the row (right of a column).
const EQUAL_SPACING_GUIDE_OFFSET = 8;

interface EqualSpacingSnap {
  delta: number;
  distance: number;
  gaps: Array<[number, number]>;
  /** Far cross-axis edge of the objects the spacing is measured against. */
  crossEnd: number;
}

/**
 * Snap `moving` so the gaps between it and its row/column neighbours match:
 * either it ends a chain whose last gap equals the one before it, or it sits
 * centred between two neighbours. Only objects sharing the moving object's row
 * (cross-axis overlap at its dragged position) take part, and a chain only
 * grows past the row's first or last object.
 */
function nearestEqualSpacingSnap(
  moving: SnapSpan,
  proposedDelta: number,
  crossDelta: number,
  peers: readonly SnapSpan[],
  tolerance: number,
): EqualSpacingSnap | null {
  const size = moving.end - moving.start;
  const start = moving.start + proposedDelta;
  const row = peers
    .filter((peer) =>
      spansOverlap(
        peer.crossStart,
        peer.crossEnd,
        moving.crossStart + crossDelta,
        moving.crossEnd + crossDelta,
      ),
    )
    .sort((a, b) => a.start - b.start);
  let best: EqualSpacingSnap | null = null;
  const consider = (
    target: number,
    gaps: Array<[number, number]>,
    involved: readonly SnapSpan[],
  ) => {
    const distance = Math.abs(target - start);
    if (distance >= tolerance || (best && distance >= best.distance)) return;
    best = {
      delta: proposedDelta + target - start,
      distance,
      gaps,
      crossEnd: Math.max(...involved.map((span) => span.crossEnd)),
    };
  };

  for (let index = 0; index < row.length - 1; index++) {
    const first = row[index]!;
    const second = row[index + 1]!;
    const gap = second.start - first.end;
    if (
      gap < MIN_EQUAL_SPACING_GAP ||
      !spansOverlap(
        first.crossStart,
        first.crossEnd,
        second.crossStart,
        second.crossEnd,
      )
    ) {
      continue;
    }
    const pair = [first, second];
    if (index + 1 === row.length - 1) {
      consider(
        second.end + gap,
        [
          [first.end, second.start],
          [second.end, second.end + gap],
        ],
        pair,
      );
    }
    if (index === 0) {
      consider(
        first.start - gap - size,
        [
          [first.start - gap, first.start],
          [first.end, second.start],
        ],
        pair,
      );
    }
    if (gap >= size + 2 * MIN_EQUAL_SPACING_GAP) {
      const target = (first.end + second.start - size) / 2;
      consider(
        target,
        [
          [first.end, target],
          [target + size, second.start],
        ],
        pair,
      );
    }
  }
  return best;
}

/**
 * Red guides through every edge or centre the moved object now shares with a
 * peer or the slide. A guide spans the union of the objects it aligns, or the
 * whole slide when the target is a slide edge or centre.
 */
function alignmentGuidesFor(
  moved: SlideObjectGeometry,
  peers: readonly SlideObjectGeometry[],
  canvas: { width: number; height: number } | undefined,
  axis: "x" | "y",
): SlideAlignmentGuide[] {
  const movedSpan = snapSpan(moved, axis);
  const peerSpans = peers.map((peer) => snapSpan(peer, axis));
  const slideLength = axis === "x" ? canvas?.width : canvas?.height;
  const slideCross = axis === "x" ? canvas?.height : canvas?.width;
  const slideAnchors =
    slideLength === undefined ? [] : [0, slideLength / 2, slideLength];
  const anchorsOf = (span: SnapSpan) => [
    span.start,
    (span.start + span.end) / 2,
    span.end,
  ];
  const aligned = (a: number, b: number) => Math.abs(a - b) < ALIGNMENT_EPSILON;

  const guides: SlideAlignmentGuide[] = [];
  const seen = new Set<number>();
  for (const position of anchorsOf(movedSpan)) {
    const key = Math.round(position / ALIGNMENT_EPSILON);
    if (seen.has(key)) continue;
    const alignedPeers = peerSpans.filter((peer) =>
      anchorsOf(peer).some((anchor) => aligned(anchor, position)),
    );
    const alignedSlide = slideAnchors.some((anchor) =>
      aligned(anchor, position),
    );
    if (alignedPeers.length === 0 && !alignedSlide) continue;
    seen.add(key);
    const crossStart =
      alignedSlide && slideCross !== undefined
        ? 0
        : Math.min(
            movedSpan.crossStart,
            ...alignedPeers.map((p) => p.crossStart),
          );
    const crossEnd =
      alignedSlide && slideCross !== undefined
        ? slideCross
        : Math.max(movedSpan.crossEnd, ...alignedPeers.map((p) => p.crossEnd));
    guides.push({
      orientation: axis === "x" ? "vertical" : "horizontal",
      position,
      start: crossStart,
      end: crossEnd,
    });
  }
  return guides;
}

function uniquePositions(positions: number[]): number[] {
  return Array.from(new Set(positions));
}

function objectAnchorPositions(
  objects: readonly SlideObjectGeometry[],
  axis: "x" | "y",
): number[] {
  return objects.flatMap((object) => {
    const start = axis === "x" ? object.x : object.y;
    const size = axis === "x" ? object.width : object.height;
    return [start, start + size / 2, start + size];
  });
}

export function snapSlideObjectMove({
  moving,
  deltaX,
  deltaY,
  peers,
  canvas,
  scale,
  tolerance = scale
    ? SLIDE_OBJECT_SNAP_SCREEN_TOLERANCE / scale
    : SLIDE_OBJECT_SNAP_TOLERANCE,
  bypass = false,
}: {
  moving: SlideObjectGeometry;
  deltaX: number;
  deltaY: number;
  peers: readonly SlideObjectGeometry[];
  canvas?: { width: number; height: number };
  /** Screen px per slide unit; makes the default tolerance screen-constant. */
  scale?: number;
  tolerance?: number;
  bypass?: boolean;
}): SlideObjectSnapResult {
  if (bypass) return { deltaX, deltaY, guides: [] };

  const xTargets = objectAnchorPositions(peers, "x");
  const yTargets = objectAnchorPositions(peers, "y");
  if (canvas) {
    xTargets.push(0, canvas.width / 2, canvas.width);
    yTargets.push(0, canvas.height / 2, canvas.height);
  }

  const xSnap = nearestSnapAdjustment(
    moving.x,
    moving.width,
    deltaX,
    uniquePositions(xTargets),
    tolerance,
  );
  const ySnap = nearestSnapAdjustment(
    moving.y,
    moving.height,
    deltaY,
    uniquePositions(yTargets),
    tolerance,
  );
  const peerSpans = (axis: "x" | "y") =>
    peers.map((peer) => snapSpan(peer, axis));
  const xSpacing = nearestEqualSpacingSnap(
    snapSpan(moving, "x"),
    deltaX,
    deltaY,
    peerSpans("x"),
    tolerance,
  );
  const ySpacing = nearestEqualSpacingSnap(
    snapSpan(moving, "y"),
    deltaY,
    deltaX,
    peerSpans("y"),
    tolerance,
  );
  // Equal spacing only wins when strictly closer, so a tie keeps the edge snap.
  const xEqual = xSpacing && (!xSnap || xSpacing.distance < xSnap.distance);
  const yEqual = ySpacing && (!ySnap || ySpacing.distance < ySnap.distance);
  const snappedDeltaX = xEqual ? xSpacing.delta : (xSnap?.delta ?? deltaX);
  const snappedDeltaY = yEqual ? ySpacing.delta : (ySnap?.delta ?? deltaY);

  const moved = {
    ...moving,
    x: moving.x + snappedDeltaX,
    y: moving.y + snappedDeltaY,
  };
  const guides = [
    ...alignmentGuidesFor(moved, peers, canvas, "x"),
    ...alignmentGuidesFor(moved, peers, canvas, "y"),
  ];
  // The spacing also holds when an edge snap landed on the same position.
  const spacingAt = (spacing: EqualSpacingSnap | null, snappedDelta: number) =>
    spacing && Math.abs(spacing.delta - snappedDelta) < ALIGNMENT_EPSILON
      ? spacing
      : null;
  const xGaps = spacingAt(xSpacing, snappedDeltaX);
  const yGaps = spacingAt(ySpacing, snappedDeltaY);
  for (const gap of xGaps?.gaps ?? []) {
    guides.push({
      orientation: "horizontal",
      position: Math.min(
        Math.max(xGaps?.crossEnd ?? 0, moved.y + moved.height) +
          EQUAL_SPACING_GUIDE_OFFSET,
        (canvas?.height ?? Infinity) - 1,
      ),
      start: gap[0],
      end: gap[1],
      equalSpacing: true,
    });
  }
  for (const gap of yGaps?.gaps ?? []) {
    guides.push({
      orientation: "vertical",
      position: Math.min(
        Math.max(yGaps?.crossEnd ?? 0, moved.x + moved.width) +
          EQUAL_SPACING_GUIDE_OFFSET,
        (canvas?.width ?? Infinity) - 1,
      ),
      start: gap[0],
      end: gap[1],
      equalSpacing: true,
    });
  }

  return { deltaX: snappedDeltaX, deltaY: snappedDeltaY, guides };
}

export function unionSlideObjectGeometries(
  geometries: readonly SlideObjectGeometry[],
): SlideObjectGeometry | null {
  if (geometries.length === 0) return null;
  const left = Math.min(...geometries.map((geometry) => geometry.x));
  const top = Math.min(...geometries.map((geometry) => geometry.y));
  const right = Math.max(
    ...geometries.map((geometry) => geometry.x + geometry.width),
  );
  const bottom = Math.max(
    ...geometries.map((geometry) => geometry.y + geometry.height),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function alignSlideObjectMembers(
  members: readonly SlideObjectMoveMember[],
  alignment: SlideObjectAlignment,
): Map<string, SlideObjectGeometryPlan> {
  const bounds = unionSlideObjectGeometries(
    members.map((member) => member.start),
  );
  if (!bounds) return new Map();

  const plan = new Map<string, SlideObjectGeometryPlan>();
  for (const member of members) {
    const geometry = { ...member.start };
    if (alignment === "left") geometry.x = bounds.x;
    if (alignment === "center") {
      geometry.x = bounds.x + (bounds.width - geometry.width) / 2;
    }
    if (alignment === "right") {
      geometry.x = bounds.x + bounds.width - geometry.width;
    }
    if (alignment === "top") geometry.y = bounds.y;
    if (alignment === "middle") {
      geometry.y = bounds.y + (bounds.height - geometry.height) / 2;
    }
    if (alignment === "bottom") {
      geometry.y = bounds.y + bounds.height - geometry.height;
    }
    plan.set(
      member.objectId,
      planSlideObjectGeometry(member.element, geometry),
    );
  }
  return plan;
}

export function distributeSlideObjectMembers(
  members: readonly SlideObjectMoveMember[],
  distribution: SlideObjectDistribution,
): Map<string, SlideObjectGeometryPlan> {
  if (members.length < 3) return new Map();

  const axis = distribution === "horizontal" ? "x" : "y";
  const size = distribution === "horizontal" ? "width" : "height";
  const sorted = [...members].sort((left, right) => {
    const positionDelta = left.start[axis] - right.start[axis];
    return positionDelta || left.objectId.localeCompare(right.objectId);
  });
  const first = sorted[0].start[axis];
  const lastEnd = Math.max(
    ...sorted.map((member) => member.start[axis] + member.start[size]),
  );
  const occupied = sorted.reduce((sum, member) => sum + member.start[size], 0);
  const gap = (lastEnd - first - occupied) / (sorted.length - 1);
  const plan = new Map<string, SlideObjectGeometryPlan>();
  let cursor = first;

  for (const member of sorted) {
    const geometry = { ...member.start };
    geometry[axis] = cursor;
    plan.set(
      member.objectId,
      planSlideObjectGeometry(member.element, geometry),
    );
    cursor += member.start[size] + gap;
  }

  return plan;
}

export interface CopiedSlideObjects {
  html: string[];
}

const SLIDE_OBJECT_CLIPBOARD_MARKER =
  "data-agent-native-slide-object-clipboard";
const SLIDE_OBJECT_CLIPBOARD_BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "DL",
  "DT",
  "DD",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);
const SLIDE_OBJECT_CLIPBOARD_IGNORED_TAGS = new Set([
  "NOSCRIPT",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
]);

export function slideObjectClipboardHtml(
  clipboardId: string,
  copied: CopiedSlideObjects,
): string {
  return `<div ${SLIDE_OBJECT_CLIPBOARD_MARKER}="${encodeURIComponent(clipboardId)}">${copied.html.join("\n")}</div>`;
}

export function readSlideObjectClipboardId(
  html: string | null | undefined,
  doc: Document,
): string | null {
  if (!html) return null;
  const template = doc.createElement("template");
  template.innerHTML = html;
  const marker = template.content.querySelector(
    `[${SLIDE_OBJECT_CLIPBOARD_MARKER}]`,
  );
  const encodedId = marker?.getAttribute(SLIDE_OBJECT_CLIPBOARD_MARKER);
  if (!encodedId) return null;
  try {
    const clipboardId = decodeURIComponent(encodedId);
    return clipboardId || null;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function slideObjectClipboardText(
  copied: CopiedSlideObjects,
  doc: Document,
): string {
  return copied.html
    .map((html) => {
      const container = doc.createElement("div");
      container.innerHTML = html;
      return slideObjectClipboardTextContent(container)
        .replace(/\n{2,}/g, "\n")
        .trim();
    })
    .filter(Boolean)
    .join("\n");
}

function slideObjectClipboardTextContent(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) {
    return Array.from(node.childNodes, slideObjectClipboardTextContent).join(
      "",
    );
  }
  const element = node as Element;
  if (SLIDE_OBJECT_CLIPBOARD_IGNORED_TAGS.has(element.tagName)) return "";
  if (element.tagName === "BR") return "\n";
  const text = Array.from(
    element.childNodes,
    slideObjectClipboardTextContent,
  ).join("");
  return SLIDE_OBJECT_CLIPBOARD_BLOCK_TAGS.has(element.tagName)
    ? `\n${text}\n`
    : text;
}

function writeSlideObjectClipboardLegacy(
  representations: { text: string; html: string },
  doc: Document | null,
): boolean {
  if (!doc || typeof doc.execCommand !== "function") return false;
  let wrote = false;
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", representations.text);
    event.clipboardData.setData("text/html", representations.html);
    event.preventDefault();
    wrote = true;
  };
  doc.addEventListener("copy", handleCopy, { capture: true, once: true });
  try {
    return doc.execCommand("copy") && wrote;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  } finally {
    doc.removeEventListener("copy", handleCopy, true);
  }
}

export async function writeSlideObjectClipboard(
  clipboardId: string,
  copied: CopiedSlideObjects,
  doc: Document | null = typeof document === "undefined" ? null : document,
): Promise<"rich" | "text-only"> {
  const html = slideObjectClipboardHtml(clipboardId, copied);
  const textDocument =
    doc ?? (typeof document === "undefined" ? null : document);
  if (!textDocument) throw new Error("Clipboard writing requires a document");
  const text = slideObjectClipboardText(copied, textDocument);
  const representations = { text, html };
  if (writeSlideObjectClipboardLegacy(representations, doc)) return "rich";

  const clipboard =
    typeof navigator === "undefined" ? null : (navigator.clipboard ?? null);
  const ClipboardItemCtor =
    typeof globalThis.ClipboardItem === "undefined"
      ? null
      : globalThis.ClipboardItem;

  let richWriteError: unknown;
  if (clipboard?.write && ClipboardItemCtor) {
    try {
      await clipboard.write([
        new ClipboardItemCtor({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return "rich";
    } catch (error) {
      richWriteError = error;
    }
  }

  if (richWriteError) throw richWriteError;
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return "text-only";
  }
  throw new Error("Clipboard writing is not supported");
}

export function copySlideObjects(
  elements: HTMLElement[],
  storedForm?: (copy: HTMLElement) => string | null,
): CopiedSlideObjects {
  return {
    html: normalizeSlideObjectRoots(elements)
      .filter(isValidSlideClipboardRoot)
      .map((element) => {
        const clone = cloneSlideObject(element);
        const html = storedForm?.(clone);
        if (html != null) return html;
        stripSourceStamps(clone);
        return clone.outerHTML;
      }),
  };
}

export const SLIDE_OBJECT_PASTE_OFFSET = 16;

function offsetInlinePx(
  element: HTMLElement,
  property: "left" | "top",
  offset: number,
): void {
  const value = Number.parseFloat(element.style[property]);
  if (!Number.isFinite(value)) return;
  element.style[property] = `${value + offset}px`;
}

export function buildPastedSlideObjects(
  copied: CopiedSlideObjects,
  doc: Document,
  offset: number = SLIDE_OBJECT_PASTE_OFFSET,
): HTMLElement[] {
  const pasted: HTMLElement[] = [];
  const occupiedDomIds = new Set(
    Array.from(doc.querySelectorAll<HTMLElement>("[id]")).map(
      (element) => element.id,
    ),
  );
  for (const html of copied.html) {
    const template = doc.createElement("template");
    template.innerHTML = html;
    const element = template.content.firstElementChild;
    if (!(element instanceof HTMLElement)) continue;
    remintSlideObjectDomIds(element, occupiedDomIds);
    element.setAttribute("data-slide-object-id", createSlideObjectId());
    element
      .querySelectorAll<HTMLElement>("[data-slide-object-id]")
      .forEach((descendant) => {
        descendant.setAttribute("data-slide-object-id", createSlideObjectId());
      });
    offsetInlinePx(element, "left", offset);
    offsetInlinePx(element, "top", offset);
    pasted.push(element);
  }
  return pasted;
}
