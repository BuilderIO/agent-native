import {
  clientPointToCanvasPoint,
  resizeCanvasRect,
  type CanvasResizeHandle,
} from "@agent-native/toolkit/canvas-interactions";

export const MIN_SLIDE_OBJECT_SIZE = 24;

export type ResizeHandle = CanvasResizeHandle;

export interface SlideObjectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
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

export type SlidesSelectionTool = "select" | "draw" | "pin" | "text";

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
  return value.split("\\").join("\\\\").split('"').join('\\"');
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
      (drawMode ? "draw" : pinMode ? "pin" : textBoxMode ? "text" : "select"),
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

/**
 * Absolute offsets resolve against the nearest ancestor that establishes a
 * containing block, not necessarily the slide's autofit layer. Keeping the
 * original parent preserves nested layout semantics while this resolver keeps
 * the measured viewport position stable when that child becomes freeform.
 */
export function resolveSlideObjectContainingBlock(
  element: HTMLElement,
  slideLayer: HTMLElement,
): HTMLElement {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== slideLayer) {
    const style = window.getComputedStyle(ancestor);
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

    if (
      position !== "static" ||
      hasTransform ||
      hasPerspective ||
      hasFilter ||
      hasContainment
    ) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return slideLayer;
}

export interface SlideTextBoxCanvas {
  fmdSlide: HTMLElement;
  positioningLayer: HTMLElement;
}

/**
 * Text objects need the same persisted coordinate root as other freeform
 * objects. Markdown initially renders straight into `.slide-content`, so the
 * first placement promotes that live flow DOM into an fmd-slide before it is
 * saved. Copying the canvas layout values keeps the current visual alignment
 * when the raw HTML renderer owns it after the edit is committed.
 */
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
  // A two-column Markdown slide renders one independent content root per
  // column. Promoting only the first and serializing it would discard the
  // other column, so decline until both roots have a shared raw-HTML canvas.
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

/** Choose rendered text before generic canvas shells, then keep the fallback legible. */
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
    // Duplicate source ids are already ambiguous. Keep internal references
    // pointed at the first occurrence, matching document.getElementById().
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
  // Nested freeform objects are independently addressable after a clone. Each
  // one needs a new persisted identity so selector-based edits cannot resolve
  // to the corresponding element in the original object.
  clone
    .querySelectorAll<HTMLElement>("[data-slide-object-id]")
    .forEach((descendant) => {
      descendant.setAttribute("data-slide-object-id", createSlideObjectId());
    });
  return clone;
}

/**
 * Take an in-flow slide element out of layout without pulling the rest of the
 * slide with it. The shallow, hidden copy keeps its original flex/grid slot;
 * the live element can then become an independently movable canvas object.
 */
export function freezeSlideElementForFreeform(
  element: HTMLElement,
  geometry: SlideObjectGeometry,
  layout: SlideObjectLayoutSnapshot,
  textPresentation?: SlideObjectTextPresentationSnapshot,
): HTMLElement {
  const objectId = ensureSlideObjectId(element);
  const spacer = element.cloneNode(false) as HTMLElement;
  removeTransientBuilderIds(spacer);
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
  // `geometry` is the already-laid-out border box. Letting the replacement
  // flex item shrink that measured size a second time changes the autofit
  // transform and makes the object jump as soon as it becomes absolute.
  spacer.style.flexGrow = "0";
  spacer.style.flexShrink = "0";
  spacer.style.flexBasis = "auto";
  spacer.style.alignSelf = layout.alignSelf;
  // An inline placeholder cannot reserve a measured block's height. Preserve
  // inline text flow with inline-block while retaining block/grid displays.
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
  // left/top describe the visible border box. Leaving flow margins on the
  // absolute element would offset it from the measured pre-freeze rect.
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

/** Remove a freeform object and the invisible layout slot that anchors it. */
export function removeSlideObjectAndLayoutSpacer(element: HTMLElement): void {
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

/**
 * Whether Delete may remove this selected element from the slide content.
 *
 * Selection is intentionally broader than freeform object manipulation: an
 * AI-generated flow-layout div is still user content and must be removable.
 * The renderer's structural shells and the hidden spacer used to preserve a
 * moved object's original layout slot are not user content.
 */
export function isDeletableSlideElement(element: HTMLElement): boolean {
  return (
    !element.classList.contains("fmd-layout-spacer") &&
    !element.classList.contains("fmd-slide") &&
    !element.classList.contains("fmd-autofit-scale") &&
    !element.hasAttribute("data-fmd-autofit-content") &&
    !element.hasAttribute("data-slide-canvas")
  );
}

/**
 * Whether Delete should remove `element` even though it is not a freeform
 * canvas object or generic flow element.
 *
 * Images are handled specially because they are leaves: an image nested in a
 * card should be removed without swallowing the surrounding card. Generic
 * flow elements are covered by `isDeletableSlideElement`.
 */
export function isDeletableFlowImage(element: HTMLElement): boolean {
  return (
    element.tagName === "IMG" ||
    element.classList.contains("fmd-img-placeholder")
  );
}

/**
 * The persisted image object that owns `element`, if any.
 *
 * PPTX/PDF import wraps each picture in an absolutely positioned
 * `.fmd-pptx-image` div carrying the durable `data-slide-object-id`, with the
 * `<img>` (or an empty placeholder) inside it. Deleting the inner node alone
 * leaves that wrapper behind as an invisible object that still occupies its
 * slot and still round-trips through save. Matching on the image wrapper
 * specifically — rather than any positioned ancestor — keeps this from
 * swallowing a whole card or column that merely contains a picture.
 */
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

/** Convert a viewport click into the unscaled fmd-slide coordinate system. */
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

export type SlideObjectZOrderTarget = "front" | "back";

function readSlideObjectZIndex(element: HTMLElement): number {
  const raw = element.style.zIndex || window.getComputedStyle(element).zIndex;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export interface SlideObjectZOrderChange {
  /** z-index to assign to the moved element. */
  value: number;
  /** Peers that must be shifted up to make room, when there was none below. */
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
    // Negative layers are reserved for slide backgrounds. They must remain
    // below editable objects, never be pulled up by send-to-back normalization.
    if (zIndex < 0) return [];
    return [{ element: peer, zIndex, order }];
  });
}

/**
 * Compute the z-index change that puts `element` in front of / behind every
 * other freeform object inside `container`. Returns null when nothing needs
 * to change.
 */
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

  const minPeer = Math.min(...peerZIndexes);
  const hasTiedPeers = new Set(peerZIndexes).size !== peers.length;
  if (minPeer - 1 >= 0 && !hasTiedPeers) {
    const value = minPeer - 1;
    return value === currentValue ? null : { value, shiftPeers: [] };
  }

  // No room below zero, or an existing tie needs repair. Keep reserved negative
  // layers untouched and give every editable peer a stable unique position.
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

export interface SlideObjectMoveMember {
  objectId: string;
  element: HTMLElement;
  start: SlideObjectGeometry;
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

/**
 * Snapshot the movable members of a multi-selection, keyed by durable object id.
 * Elements that are not absolutely positioned cannot move and are excluded.
 */
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

/** Apply one shared delta to every member, relative to its captured start. */
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
  /** Position in the shared slide coordinate space. */
  position: number;
  /** Visible span in the shared slide coordinate space. */
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

/**
 * Snap a proposed object/group delta to nearby peer or canvas anchors. The
 * moving geometry is the object itself for a single drag and the union bounds
 * for a group drag. The caller can bypass this transient behavior with the
 * platform modifier used by Figma (Cmd/Ctrl) without changing persisted data.
 */
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

export function copySlideObjects(elements: HTMLElement[]): CopiedSlideObjects {
  return {
    html: normalizeSlideObjectRoots(elements).map((element) => {
      const clone = cloneSlideObject(element);
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

/**
 * Rebuild pasted objects from stored HTML with fresh ids and a cascade offset,
 * so a paste never collides exactly with its source.
 */
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
    // Remint every persisted id (root + nested) the same way cloneSlideObject
    // does, so a pasted object never resolves to its source via selector.
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
