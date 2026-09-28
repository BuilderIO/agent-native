import {
  clientPointToCanvasPoint,
  resizeCanvasRect,
  type CanvasResizeHandle,
} from "@agent-native/toolkit/canvas-interactions";

import { stripSourceStamps } from "@/lib/slide-source-map";

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

  return (
    position !== "static" ||
    hasTransform ||
    hasPerspective ||
    hasFilter ||
    hasContainment
  );
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
  clone.setAttribute("data-slide-object-id", createSlideObjectId());
  clone
    .querySelectorAll<HTMLElement>("[data-slide-object-id]")
    .forEach((descendant) => {
      descendant.setAttribute("data-slide-object-id", createSlideObjectId());
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
  const objectId = element.getAttribute("data-slide-object-id");
  for (const spacer of Array.from(
    layer.querySelectorAll<HTMLElement>("[data-slide-layout-spacer-for]"),
  )) {
    if (spacer.getAttribute("data-slide-layout-spacer-for") === objectId) {
      spacer.remove();
    }
  }
  restoreViewportPosition(element, rect);
  return true;
}

export function freezeSlideElementForFreeform(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
  layout: SlideObjectLayoutSnapshot,
  textPresentation?: SlideObjectTextPresentationSnapshot,
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
  element.style.height = `${geometry.height}px`;
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
  const objectId = element.getAttribute("data-slide-object-id");
  if (objectId) {
    const owner = element.parentElement ?? element.ownerDocument;
    for (const spacer of Array.from(
      owner.querySelectorAll<HTMLElement>("[data-slide-layout-spacer-for]"),
    )) {
      if (spacer.getAttribute("data-slide-layout-spacer-for") === objectId) {
        spacer.remove();
      }
    }
  }
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
  return (
    WIDTH_ONLY_RESIZE_HANDLES.has(handle) &&
    !preserveAspectRatio &&
    isTextLeaf(element)
  );
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
): Map<string, SlideObjectGeometry> {
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
  const plan = new Map<string, SlideObjectGeometry>();
  for (const member of members) {
    const { start } = member;
    plan.set(member.objectId, {
      x: group.x + ((start.x - bounds.x) / bounds.width) * group.width,
      y: group.y + ((start.y - bounds.y) / bounds.height) * group.height,
      width: (start.width / bounds.width) * group.width,
      height: (start.height / bounds.height) * group.height,
    });
  }
  return plan;
}

interface SlideObjectGroupBounds {
  width: number;
  height: number;
}

export interface SlideObjectGroupMemberResizePlan {
  geometry: SlideObjectGeometry;
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
    const geometry = {
      x: start.x * scaleX,
      y: start.y * scaleY,
      width: start.width * scaleX,
      height: start.height * scaleY,
    };
    if (!transform || transform === "none") {
      return { element, plan: { geometry } };
    }

    const matrix = readSlideObjectTransformMatrix(start, transform);
    if (!matrix) return null;
    const [a, b, c, d, tx, ty] = matrix;
    const originTokens = transformOrigin.trim().split(/\s+/);
    const originX = transformOriginOffset(originTokens[0], start.width, "x");
    const originY = transformOriginOffset(originTokens[1], start.height, "y");
    const format = (value: number) => {
      const rounded = Number(value.toFixed(8));
      return String(Object.is(rounded, -0) ? 0 : rounded);
    };

    return {
      element,
      plan: {
        geometry,
        transform: slideObjectMatrix2dString([
          a,
          (scaleY / scaleX) * b,
          (scaleX / scaleY) * c,
          d,
          scaleX * tx,
          scaleY * ty,
        ]),
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

export function readSlideObjectTransformSnapshot(
  element: HTMLElement,
): SlideObjectTransformSnapshot {
  const computedStyle = window.getComputedStyle(element);
  const computedTransform = computedStyle.transform;
  const inlineTransformOrigin = element.style.transformOrigin.trim();
  const computedTransformOrigin = computedStyle.transformOrigin?.trim();
  let transformOrigin =
    inlineTransformOrigin || computedTransformOrigin || "50% 50%";
  if (
    !inlineTransformOrigin &&
    computedTransformOrigin &&
    element.offsetWidth > 0 &&
    element.offsetHeight > 0
  ) {
    const [xToken, yToken] = computedTransformOrigin.split(/\s+/);
    if (xToken?.endsWith("px") && yToken?.endsWith("px")) {
      const format = (value: number) => {
        const rounded = Number(value.toFixed(8));
        return String(Object.is(rounded, -0) ? 0 : rounded);
      };
      const x = transformOriginOffset(xToken, element.offsetWidth, "x");
      const y = transformOriginOffset(yToken, element.offsetHeight, "y");
      transformOrigin = `${format((x / element.offsetWidth) * 100)}% ${format((y / element.offsetHeight) * 100)}%`;
    }
  }
  return {
    transform:
      computedTransform && computedTransform !== "none"
        ? computedTransform
        : element.style.transform || "none",
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

function transformOriginOffset(
  token: string | undefined,
  dimension: number,
  axis: "x" | "y",
): number {
  const value = token?.trim().toLowerCase();
  if (!value || value === "center") return dimension / 2;
  if (value === "left") return axis === "x" ? 0 : dimension / 2;
  if (value === "right") return axis === "x" ? dimension : dimension / 2;
  if (value === "top") return axis === "y" ? 0 : dimension / 2;
  if (value === "bottom") return axis === "y" ? dimension : dimension / 2;
  if (value.endsWith("%")) {
    const percentage = Number.parseFloat(value);
    return Number.isFinite(percentage)
      ? (dimension * percentage) / 100
      : dimension / 2;
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/.test(value)) {
    return Number.parseFloat(value);
  }
  return dimension / 2;
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
  const originTokens = (
    transformOrigin ||
    computedStyle.transformOrigin ||
    element.style.transformOrigin
  )
    .trim()
    .split(/\s+/);
  const originX = transformOriginOffset(originTokens[0], geometry.width, "x");
  const originY = transformOriginOffset(originTokens[1], geometry.height, "y");
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
  applyGeometry: (element: HTMLElement, geometry: SlideObjectGeometry) => void,
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
    const computedTransform = window.getComputedStyle(element).transform;
    const transform =
      computedTransform && computedTransform !== "none"
        ? computedTransform
        : element.style.transform;
    const visualBounds = transformedSlideObjectBoundsForTransform(
      element,
      geometry,
      transform,
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
    applyGeometry(element, {
      x: geometry.x - bounds.x,
      y: geometry.y - bounds.y,
      width: geometry.width,
      height: geometry.height,
    });
  }
  return group;
}

export function ungroupSlideObject(
  group: HTMLElement,
  getGeometry: (element: HTMLElement) => SlideObjectGeometry,
  applyGeometry: (element: HTMLElement, geometry: SlideObjectGeometry) => void,
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
      const computedTransform = window.getComputedStyle(element).transform;
      const currentTransform =
        computedTransform && computedTransform !== "none"
          ? computedTransform
          : element.style.transform;
      const currentMatrix = readSlideObjectTransformMatrix(
        geometry,
        currentTransform,
      );
      if (!currentMatrix) return null;
      const currentCenterOffset = slideObjectTransformCenterOffset(
        element,
        geometry,
        currentMatrix,
      );
      const currentRotation =
        (Math.atan2(currentMatrix[1], currentMatrix[0]) * 180) / Math.PI;
      const nextTransform = rotatedSlideObjectMatrix(
        slideObjectMatrix2dString(currentMatrix),
        currentRotation + groupRotation,
      );
      if (!nextTransform) return null;
      const nextParsed = parseSlideObjectMatrix2d(nextTransform);
      if (!nextParsed) return null;
      const nextCenterOffset = slideObjectTransformCenterOffset(
        element,
        geometry,
        slideObjectMatrix2dValues(nextParsed),
      );
      transforms.set(element, {
        nextTransform,
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
    applyGeometry(element, {
      x: rotatedCenter.x - absoluteGeometry.width / 2 + transformCorrection.x,
      y: rotatedCenter.y - absoluteGeometry.height / 2 + transformCorrection.y,
      width: geometry.width,
      height: geometry.height,
    });
    if (transform) element.style.transform = transform.nextTransform;
  }
  group.remove();
  return childGeometries.map(({ element }) => element);
}

export interface SlideObjectRotationMember
  extends SlideObjectMoveMember, SlideObjectTransformSnapshot {
  rotation: number;
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
  const parseLength = (value: string | undefined, dimension: number) => {
    if (!value) return 0;
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:px|%)?$/i.test(value)) return null;
    const number = Number.parseFloat(value);
    return value.endsWith("%") ? (number * dimension) / 100 : number;
  };
  const x = kind === "translatey" ? 0 : parseLength(values[0], geometry.width);
  const y =
    kind === "translatex"
      ? 0
      : parseLength(
          kind === "translatey" ? values[0] : values[1],
          geometry.height,
        );
  const z = kind === "translate3d" ? parseLength(values[2], 0) : 0;
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
    minSize = MIN_SLIDE_OBJECT_SIZE,
  }: ResizeOptions & { altKey?: boolean },
): SlideObjectGeometry | null {
  const matrix = readSlideObjectTransformMatrix(start, transform.transform);
  if (!matrix) return null;
  const [a, b, c, d, tx, ty] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    return null;
  }

  const localDelta = {
    x: (d * dx - c * dy) / determinant,
    y: (a * dy - b * dx) / determinant,
  };
  const resized = resizeCanvasRect(start, {
    handle,
    delta: localDelta,
    altKey,
    preserveAspectRatio,
    minWidth: minSize,
    minHeight: minSize,
  });
  const originTokens = transform.transformOrigin.trim().split(/\s+/);
  const transformedPoint = (
    point: { x: number; y: number },
    width: number,
    height: number,
  ) => {
    const originX = transformOriginOffset(originTokens[0], width, "x");
    const originY = transformOriginOffset(originTokens[1], height, "y");
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
  const originTokens = snapshot.transformOrigin.trim().split(/\s+/);
  const origin = {
    x: transformOriginOffset(originTokens[0], geometry.width, "x"),
    y: transformOriginOffset(originTokens[1], geometry.height, "y"),
  };
  const format = (value: number) => {
    const rounded = Number(value.toFixed(8));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  return {
    left: rect.left - localBounds.x * scaleX,
    top: rect.top - localBounds.y * scaleY,
    width: geometry.width * scaleX,
    height: geometry.height * scaleY,
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
): { x: number; y: number } {
  const originTokens = (
    window.getComputedStyle(element).transformOrigin ||
    element.style.transformOrigin
  )
    .trim()
    .split(/\s+/);
  const originX = transformOriginOffset(originTokens[0], geometry.width, "x");
  const originY = transformOriginOffset(originTokens[1], geometry.height, "y");
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
  const currentAngle = Math.atan2(b, a);
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

export function readSlideObjectRotation(element: HTMLElement): number {
  const transform =
    element.style.transform || window.getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  const rotate = transform.match(
    /rotate(?:z)?\(\s*(-?(?:\d+\.?\d*|\.\d+))deg\s*\)/i,
  );
  if (rotate) return Number(rotate[1]);

  const matrix = parseSlideObjectMatrix2d(transform);
  if (matrix) {
    const [aIndex, bIndex] = matrix.indexes;
    return (
      (Math.atan2(matrix.values[bIndex] ?? 0, matrix.values[aIndex] ?? 1) *
        180) /
      Math.PI
    );
  }
  return 0;
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

export function setSlideObjectRotation(
  element: HTMLElement,
  rotation: number,
): void {
  element.style.transform = slideObjectRotationTransform(
    element.style.transform.trim(),
    rotation,
  );
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
    const currentBounds = transformedSlideObjectBoundsForTransform(
      member.element,
      member.start,
      member.transform,
      member.transformOrigin,
    );
    const rotation = member.rotation + deltaDegrees;
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
    return currentBounds && nextBounds
      ? {
          member,
          currentBounds,
          nextBounds,
          rotation,
          transform: nextTransform,
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

export function applySlideObjectMoveDelta(
  members: SlideObjectMoveMember[],
  deltaX: number,
  deltaY: number,
  applyGeometry: (element: HTMLElement, geometry: SlideObjectGeometry) => void,
): void {
  for (const member of members) {
    applyGeometry(member.element, {
      ...member.start,
      x: member.start.x + deltaX,
      y: member.start.y + deltaY,
    });
  }
}

export type SlideAlignmentGuideOrientation = "vertical" | "horizontal";

export interface SlideAlignmentGuide {
  orientation: SlideAlignmentGuideOrientation;
  position: number;
  start: number;
  end: number;
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

function nearestSnapAdjustment(
  movingStart: number,
  movingSize: number,
  proposedDelta: number,
  targetPositions: number[],
  tolerance: number,
): { delta: number; position: number } | null {
  const anchors = [0, movingSize / 2, movingSize];
  let closest: { distance: number; delta: number; position: number } | null =
    null;

  for (const anchor of anchors) {
    const proposedPosition = movingStart + proposedDelta + anchor;
    for (const position of targetPositions) {
      const adjustment = position - proposedPosition;
      const distance = Math.abs(adjustment);
      if (distance > tolerance) continue;
      if (!closest || distance < closest.distance) {
        closest = { distance, delta: proposedDelta + adjustment, position };
      }
    }
  }

  return closest ? { delta: closest.delta, position: closest.position } : null;
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
  tolerance = SLIDE_OBJECT_SNAP_TOLERANCE,
  bypass = false,
}: {
  moving: SlideObjectGeometry;
  deltaX: number;
  deltaY: number;
  peers: readonly SlideObjectGeometry[];
  canvas?: { width: number; height: number };
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
  const guides: SlideAlignmentGuide[] = [];
  if (xSnap) {
    guides.push({
      orientation: "vertical",
      position: xSnap.position,
      start: 0,
      end: canvas?.height ?? moving.y + moving.height,
    });
  }
  if (ySnap) {
    guides.push({
      orientation: "horizontal",
      position: ySnap.position,
      start: 0,
      end: canvas?.width ?? moving.x + moving.width,
    });
  }

  return {
    deltaX: xSnap?.delta ?? deltaX,
    deltaY: ySnap?.delta ?? deltaY,
    guides,
  };
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
): Map<string, SlideObjectGeometry> {
  const bounds = unionSlideObjectGeometries(
    members.map((member) => member.start),
  );
  if (!bounds) return new Map();

  const plan = new Map<string, SlideObjectGeometry>();
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
    plan.set(member.objectId, geometry);
  }
  return plan;
}

export function distributeSlideObjectMembers(
  members: readonly SlideObjectMoveMember[],
  distribution: SlideObjectDistribution,
): Map<string, SlideObjectGeometry> {
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
  const plan = new Map<string, SlideObjectGeometry>();
  let cursor = first;

  for (const member of sorted) {
    const geometry = { ...member.start };
    geometry[axis] = cursor;
    plan.set(member.objectId, geometry);
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
