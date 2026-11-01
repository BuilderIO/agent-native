// One definition of "grows with its text", shared by the object layer
// (isFitTextObject) and the text session (ownsFlowSlot). They used to read
// height/bottom/position differently, so a box could be fit for one and
// pinned for the other.

function isExplicit(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "auto";
}

export function hasInlineHeight(element: HTMLElement): boolean {
  return isExplicit(element.style.getPropertyValue("height"));
}

/** `bottom` pins the lower edge; with `top` and an auto height it stretches the box. */
export function hasInlineBottom(element: HTMLElement): boolean {
  return isExplicit(element.style.getPropertyValue("bottom"));
}

/**
 * An absolute or fixed box with neither an inline height nor an inline
 * bottom grows with its text and takes no space in the flow.
 */
export function isFitFreeformFrame(element: HTMLElement): boolean {
  const { position } = window.getComputedStyle(element);
  return (
    (position === "absolute" || position === "fixed") &&
    !hasInlineHeight(element) &&
    !hasInlineBottom(element)
  );
}

/** The smallest size "Shrink text to fit" writes, unless the text started smaller. */
export const SHRINK_TEXT_MIN_PX = 12;
/** No size goes below this share of what it started at. */
export const SHRINK_TEXT_MIN_RATIO = 0.65;
/** Matches the renderer's overflow tolerance, so "fits" means no warning. */
export const SHRINK_TEXT_TOLERANCE_PX = 8;
const SHRINK_STEP = 0.025;

function holdsOwnText(element: HTMLElement): boolean {
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
}

/** Every element that holds text of its own, `root` included. */
export function textRunsIn(root: HTMLElement): HTMLElement[] {
  return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].filter(
    (element) =>
      holdsOwnText(element) && !element.closest("style, script, template, svg"),
  );
}

function isFreeformObject(element: HTMLElement): boolean {
  if (element.hasAttribute("data-slide-object-id")) return true;
  const { position } = window.getComputedStyle(element);
  return position === "absolute" || position === "fixed";
}

/** How far, in the frame's CSS px, any painted leaf or text of `scope` lies outside `frame`. */
export function overflowOutsideFrame(
  frame: HTMLElement,
  scope: HTMLElement = frame,
): number {
  const frameRect = frame.getBoundingClientRect();
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  const sx = frameRect.width > 0 && width > 0 ? width / frameRect.width : 1;
  const sy = frameRect.height > 0 && height > 0 ? height / frameRect.height : 1;
  let overflow = 0;
  for (const element of [
    scope,
    ...Array.from(scope.querySelectorAll<HTMLElement>("*")),
  ]) {
    if (element === frame) continue;
    if (element.children.length > 0 && !holdsOwnText(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    overflow = Math.max(
      overflow,
      (frameRect.left - rect.left) * sx,
      (frameRect.top - rect.top) * sy,
      (rect.right - frameRect.left) * sx - width,
      (rect.bottom - frameRect.top) * sy - height,
    );
  }
  return overflow;
}

/**
 * The text runs to shrink when the slide in `frame` overflows: those of the
 * freeform objects that run outside it, else the flow text, which overflows
 * as one column.
 */
export function overflowingTextRuns(frame: HTMLElement): HTMLElement[] {
  const objects = Array.from(frame.querySelectorAll<HTMLElement>("*")).filter(
    (element) =>
      isFreeformObject(element) &&
      !(element.parentElement?.closest("[data-slide-object-id]") ?? null),
  );
  const outside = objects.filter(
    (object) => overflowOutsideFrame(frame, object) > SHRINK_TEXT_TOLERANCE_PX,
  );
  if (outside.length > 0) return outside.flatMap(textRunsIn);
  return textRunsIn(frame).filter(
    (run) => !objects.some((object) => object.contains(run)),
  );
}

export type ShrinkTextResult = "fitted" | "cannot-fit";

/**
 * Steps every run's font size down together, in whole px, until `fits()`
 * says the text fits. No run goes below SHRINK_TEXT_MIN_PX or
 * SHRINK_TEXT_MIN_RATIO of its start size. When the text still does not fit
 * at that floor, every run gets its original style back.
 */
export function shrinkTextToFit(
  runs: readonly HTMLElement[],
  fits: () => boolean,
): ShrinkTextResult {
  const start = runs.map((element) => ({
    element,
    style: element.getAttribute("style"),
    size: Number.parseFloat(window.getComputedStyle(element).fontSize),
  }));
  const sized = start
    .filter(({ size }) => Number.isFinite(size) && size > 0)
    .map((run) => ({ ...run, current: run.size }));
  const floorOf = (size: number) =>
    Math.min(
      size,
      Math.max(SHRINK_TEXT_MIN_PX, Math.ceil(size * SHRINK_TEXT_MIN_RATIO)),
    );
  for (let factor = 1 - SHRINK_STEP; ; factor -= SHRINK_STEP) {
    let moved = false;
    for (const run of sized) {
      const next = Math.max(floorOf(run.size), Math.round(run.size * factor));
      if (next >= run.current) continue;
      run.element.style.setProperty("font-size", `${next}px`);
      run.current = next;
      moved = true;
    }
    if (moved && fits()) return "fitted";
    if (!moved && factor < SHRINK_TEXT_MIN_RATIO) break;
  }
  for (const { element, style } of start) {
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
  }
  return "cannot-fit";
}
