// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forwardReviewOverlayWheel,
  isCanvasOverlayInteractionTarget,
  isReviewForwardedWheel,
} from "./review-overlay-interaction";
import { stubFaithfulWheelEvent } from "./test-wheel-event";

describe("review overlay canvas interaction guard", () => {
  it("recognizes review chrome and its descendants", () => {
    const popover = document.createElement("div");
    popover.dataset.reviewPopover = "";
    const control = document.createElement("button");
    popover.append(control);

    const clickPlane = document.createElement("div");
    clickPlane.dataset.reviewClickPlane = "";

    expect(isCanvasOverlayInteractionTarget(control)).toBe(true);
    expect(isCanvasOverlayInteractionTarget(clickPlane)).toBe(true);
  });

  it("recognizes standalone pin clusters inside the review overlay root", () => {
    const overlayRoot = document.createElement("div");
    overlayRoot.dataset.reviewOverlayRoot = "";
    const cluster = document.createElement("button");
    cluster.dataset.reviewPinCluster = "";
    overlayRoot.append(cluster);

    expect(isCanvasOverlayInteractionTarget(cluster)).toBe(true);
  });

  it("recognizes a review menu portaled to the body, outside any overlay root", () => {
    // Radix wraps portaled menus in a popper wrapper; the review marker sits on
    // the menu node inside it.
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-review-popover", "");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    menu.append(item);
    wrapper.append(menu);
    document.body.append(wrapper);

    expect(isCanvasOverlayInteractionTarget(item)).toBe(true);
    wrapper.remove();
  });

  it("does not treat an unmarked Radix popper as review UI", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    menu.append(item);
    wrapper.append(menu);
    document.body.append(wrapper);

    expect(isCanvasOverlayInteractionTarget(item)).toBe(false);
    wrapper.remove();
  });

  it("leaves ordinary canvas targets available to gestures", () => {
    expect(
      isCanvasOverlayInteractionTarget(document.createElement("div")),
    ).toBe(false);
    expect(isCanvasOverlayInteractionTarget(null)).toBe(false);
  });
});

describe("review overlay wheel forwarding", () => {
  beforeEach(stubFaithfulWheelEvent);
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const canvas = document.createElement("div");
    const overlayRoot = document.createElement("div");
    overlayRoot.dataset.reviewOverlayRoot = "";
    const pin = document.createElement("span");
    pin.dataset.reviewPin = "";
    const card = document.createElement("div");
    card.dataset.reviewThreadCard = "";
    const cardBody = document.createElement("p");
    card.append(cardBody);
    overlayRoot.append(pin, card);
    document.body.append(canvas, overlayRoot);
    // Mirrors ReviewCanvasPins: a native, non-passive listener on the overlay root.
    overlayRoot.addEventListener(
      "wheel",
      (event) => forwardReviewOverlayWheel(event as WheelEvent, canvas),
      { passive: false },
    );
    const seen: WheelEvent[] = [];
    // Stands in for a canvas that zooms and pans on wheel: it takes the event.
    canvas.addEventListener("wheel", (event) => {
      seen.push(event);
      event.preventDefault();
    });
    return {
      canvas,
      pin,
      cardBody,
      seen,
      cleanup: () => {
        canvas.remove();
        overlayRoot.remove();
      },
    };
  }

  const wheel = (init: WheelEventInit) =>
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 320,
      clientY: 240,
      deltaY: -120,
      ...init,
    });

  it("hands a pinch over a pin to the canvas and keeps the browser from zooming", () => {
    const { pin, seen, cleanup } = setup();
    const pinch = wheel({ ctrlKey: true });
    pin.dispatchEvent(pinch);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      ctrlKey: true,
      clientX: 320,
      clientY: 240,
      deltaY: -120,
    });
    expect(seen.map((event) => isReviewForwardedWheel(event))).toEqual([true]);
    expect(isReviewForwardedWheel(pinch)).toBe(false);
    expect(pinch.defaultPrevented).toBe(true);
    cleanup();
  });

  it("hands a plain two-finger scroll over a pin to the canvas to pan", () => {
    const { pin, seen, cleanup } = setup();
    const scroll = wheel({ deltaX: 12, deltaY: 40 });
    pin.dispatchEvent(scroll);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ctrlKey: false, deltaX: 12, deltaY: 40 });
    expect(scroll.defaultPrevented).toBe(true);
    cleanup();
  });

  it("zooms the canvas for Cmd+scroll the same way as for a pinch", () => {
    const { pin, seen, cleanup } = setup();
    const scroll = wheel({ metaKey: true });
    pin.dispatchEvent(scroll);

    expect(seen).toHaveLength(1);
    expect(seen.map((event) => event.metaKey)).toEqual([true]);
    expect(scroll.defaultPrevented).toBe(true);
    cleanup();
  });

  it("lets a card scroll its own replies but hands it a pinch", () => {
    const { cardBody, seen, cleanup } = setup();
    const scroll = wheel({ deltaY: 40 });
    cardBody.dispatchEvent(scroll);
    expect(seen).toHaveLength(0);
    expect(scroll.defaultPrevented).toBe(false);

    const pinch = wheel({ ctrlKey: true });
    cardBody.dispatchEvent(pinch);
    expect(seen).toHaveLength(1);
    expect(pinch.defaultPrevented).toBe(true);
    cleanup();
  });

  it("leaves the default alone where the canvas ignores wheels", () => {
    const quietCanvas = document.createElement("div");
    document.body.append(quietCanvas);
    const pinch = wheel({ ctrlKey: true });
    forwardReviewOverlayWheel(pinch, quietCanvas);
    expect(pinch.defaultPrevented).toBe(false);
    quietCanvas.remove();
  });

  it("scrolls a natively scrolling canvas by the wheel delta, but never on a pinch", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { value: 600 });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as unknown as typeof scroller.scrollBy;
    const canvas = document.createElement("div");
    scroller.append(canvas);
    document.body.append(scroller);

    const scroll = wheel({ deltaX: 0, deltaY: 3, deltaMode: 1 });
    forwardReviewOverlayWheel(scroll, canvas);
    expect(scrollBy).toHaveBeenCalledWith(0, 48);
    expect(scroll.defaultPrevented).toBe(true);

    scrollBy.mockClear();
    forwardReviewOverlayWheel(wheel({ ctrlKey: true }), canvas);
    expect(scrollBy).not.toHaveBeenCalled();
    scroller.remove();
  });
});
