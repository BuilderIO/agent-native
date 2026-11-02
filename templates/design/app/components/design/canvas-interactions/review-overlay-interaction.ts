import { normalizeWheelDeltaPx } from "@agent-native/core/client/zoom-gesture";

export function isCanvasOverlayInteractionTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "[data-review-overlay-root],[data-review-popover],[data-review-click-plane]",
      ),
    )
  );
}

const forwardedWheels = new WeakSet<Event>();

/** True for a wheel the review overlay re-dispatched onto its canvas; a canvas takes it as it would a real one. */
export function isReviewForwardedWheel(event: Event): boolean {
  return forwardedWheels.has(event);
}

function scrollableAncestor(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const scrolls = (overflow: string, extent: number, client: number) =>
      /auto|scroll/.test(overflow) && extent > client;
    if (
      scrolls(style.overflowY, node.scrollHeight, node.clientHeight) ||
      scrolls(style.overflowX, node.scrollWidth, node.clientWidth)
    ) {
      return node;
    }
  }
  return null;
}

/**
 * The comment overlay is portaled to the body, so a wheel over a pin or card
 * never reaches the canvas it covers and a pinch falls through to the browser.
 * Re-dispatch the gesture onto that canvas, and take the default away from the
 * original only when the canvas took it: where the canvas ignores wheels (a
 * read-only page) the browser behaves as it does anywhere else there.
 */
export function forwardReviewOverlayWheel(
  event: WheelEvent,
  canvas: Element | null,
): void {
  if (!canvas) return;
  const zoom = event.ctrlKey || event.metaKey;
  // A card scrolls its own replies, so only a pinch over one is the canvas's.
  if (
    !zoom &&
    event.target instanceof Element &&
    event.target.closest("[data-review-thread-card]")
  ) {
    return;
  }
  const forwarded = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  forwardedWheels.add(forwarded);
  canvas.dispatchEvent(forwarded);
  if (forwarded.defaultPrevented) {
    event.preventDefault();
    return;
  }
  if (zoom) return;
  // A scrolling canvas (single-screen view) moves natively, which a re-dispatched event cannot do.
  const scroller = scrollableAncestor(canvas);
  if (!scroller) return;
  event.preventDefault();
  scroller.scrollBy(
    normalizeWheelDeltaPx(event.deltaX, event.deltaMode),
    normalizeWheelDeltaPx(event.deltaY, event.deltaMode),
  );
}
