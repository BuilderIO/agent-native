// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { zoomBridgeScript } from "../../../../.generated/bridge/zoom.generated";

/**
 * The parent classifies device and scales travel from this payload alone, so
 * anything the bridge drops is unrecoverable on the other side.
 */
describe("zoom bridge payload", () => {
  let posted: Record<string, unknown>[] = [];

  // Installed once: the bridge binds to documentElement, so re-running it per
  // test would stack listeners and post each payload several times.
  beforeAll(() => {
    vi.stubGlobal("parent", {
      postMessage: (message: Record<string, unknown>) => posted.push(message),
    });
    // The generated module is an IIFE string meant for an iframe's <script>.
    new Function(zoomBridgeScript)();
  });

  beforeEach(() => {
    posted = [];
  });

  function dispatchWheel(init: {
    deltaY: number;
    deltaMode: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: init.deltaY,
      deltaMode: init.deltaMode,
    });
    // happy-dom drops WheelEvent's MouseEventInit fields.
    Object.defineProperty(event, "ctrlKey", { value: init.ctrlKey ?? true });
    Object.defineProperty(event, "metaKey", { value: init.metaKey ?? false });
    Object.defineProperty(event, "clientX", { value: 40 });
    Object.defineProperty(event, "clientY", { value: 60 });
    document.documentElement.dispatchEvent(event);
    return event;
  }

  it("forwards the delta mode so a line tick is not read as 3px of travel", () => {
    // Firefox reports a notch as deltaY 3 in line mode; without the mode the
    // parent scales it as 3 pixels and classifies it as finger separation.
    dispatchWheel({ deltaY: -3, deltaMode: 1 });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: "pinch-zoom-wheel",
      deltaY: -3,
      deltaMode: 1,
      ctrlKey: true,
      metaKey: false,
    });
  });

  it("forwards the modifiers the device classifier reads", () => {
    dispatchWheel({ deltaY: -8, deltaMode: 0, ctrlKey: false, metaKey: true });
    expect(posted[0]).toMatchObject({
      deltaMode: 0,
      ctrlKey: false,
      metaKey: true,
    });
  });

  it("ignores an unmodified wheel", () => {
    dispatchWheel({ deltaY: -100, deltaMode: 0, ctrlKey: false });
    expect(posted).toHaveLength(0);
  });

  it("does not cancel a non-cancelable wheel", () => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: false,
      deltaY: -100,
      deltaMode: 0,
    });
    Object.defineProperty(event, "ctrlKey", { value: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    document.documentElement.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
  });
});
