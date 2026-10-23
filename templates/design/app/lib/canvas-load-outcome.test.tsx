// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ trackDesignRelay: vi.fn() }));

vi.mock("./design-relay-tracking", () => ({
  trackDesignRelay: mocks.trackDesignRelay,
}));

import {
  CANVAS_LOAD_STALL_MS,
  __resetCanvasLoadOutcomeForTests,
  leaveCanvasOutcomeDesign,
  useCanvasLoadOutcome,
} from "./canvas-load-outcome";
import {
  __resetCanvasOutcomeTrackingForTests,
  flushCanvasOutcomeCounts,
  setCanvasOutcomeContext,
} from "./canvas-outcome-tracking";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function loads(): Record<string, number> {
  flushCanvasOutcomeCounts();
  const out: Record<string, number> = {};
  for (const [, properties] of mocks.trackDesignRelay.mock.calls as Array<
    [string, Record<string, string | number>]
  >) {
    if (properties.operation !== "canvas_load") continue;
    const key = `${properties.outcome}/${properties.reason}`;
    out[key] = (out[key] ?? 0) + Number(properties.count);
  }
  mocks.trackDesignRelay.mockReset();
  return out;
}

const readyCallbacks: Array<() => void> = [];
function Canvas({
  designId = "design-a",
  measure = true,
}: {
  designId?: string;
  measure?: boolean;
}) {
  readyCallbacks.push(useCanvasLoadOutcome({ designId, measure }));
  return null;
}

let root: Root;
let container: HTMLElement;

function render(
  canvases: Array<{ designId?: string; measure?: boolean; key?: string }>,
) {
  act(() => {
    root.render(
      createElement(
        "div",
        null,
        canvases.map((props, index) =>
          createElement(Canvas, { key: props.key ?? String(index), ...props }),
        ),
      ),
    );
  });
}

const latestReady = () => readyCallbacks[readyCallbacks.length - 1];

describe("canvas load outcome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetCanvasLoadOutcomeForTests();
    __resetCanvasOutcomeTrackingForTests();
    mocks.trackDesignRelay.mockReset();
    readyCallbacks.length = 0;
    container = document.createElement("div");
    root = createRoot(container);
    setCanvasOutcomeContext({ designId: "design-a", signedIn: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("counts one load for a board of several canvases", () => {
    render([{}, {}, {}]);
    for (const ready of readyCallbacks) ready();
    vi.advanceTimersByTime(CANVAS_LOAD_STALL_MS);
    expect(loads()).toEqual({ "succeeded/none": 1 });
  });

  it("counts one stall when no canvas is ready in time", () => {
    render([{}, {}, {}]);
    vi.advanceTimersByTime(CANVAS_LOAD_STALL_MS);
    latestReady()();
    expect(loads()).toEqual({ "failed/stalled": 1 });
  });

  it("does not count a remounted canvas of the same design as a second load", () => {
    render([{ key: "first" }]);
    latestReady()();
    render([{ key: "second" }]);
    latestReady()();
    expect(loads()).toEqual({ "succeeded/none": 1 });
  });

  it("counts a second design opened in the same editor as its own load", () => {
    render([{ designId: "design-a" }]);
    latestReady()();
    setCanvasOutcomeContext({ designId: "design-b", signedIn: true });
    render([{ designId: "design-b" }]);
    vi.advanceTimersByTime(CANVAS_LOAD_STALL_MS);

    flushCanvasOutcomeCounts();
    const all = mocks.trackDesignRelay.mock.calls
      .map(([, props]) => props as Record<string, unknown>)
      .filter((props) => props.operation === "canvas_load")
      .map((props) => `${props.design_id}:${props.outcome}`);
    expect(all.sort()).toEqual(["design-a:succeeded", "design-b:failed"]);
  });

  it("ends its own load when a canvas stops being measured", () => {
    render([{ key: "screen", measure: true }]);
    render([{ key: "screen", measure: false }]);
    vi.advanceTimersByTime(CANVAS_LOAD_STALL_MS);
    expect(loads()).toEqual({});
  });

  it("counts ready through the first callback a handler kept", () => {
    render([{ key: "screen", designId: "design-a" }]);
    const keptByHandler = readyCallbacks[0];
    setCanvasOutcomeContext({ designId: "design-b", signedIn: true });
    render([{ key: "screen", designId: "design-b" }]);
    keptByHandler();
    expect(loads()).toEqual({ "succeeded/none": 1 });
  });

  it("never times a canvas that does not report ready", () => {
    render([{ measure: false }]);
    vi.advanceTimersByTime(CANVAS_LOAD_STALL_MS * 2);
    latestReady()();
    expect(loads()).toEqual({});
  });

  it("never counts a load the viewer left before it was ready", () => {
    render([{}]);
    leaveCanvasOutcomeDesign();
    vi.advanceTimersByTime(CANVAS_LOAD_STALL_MS);
    flushCanvasOutcomeCounts();
    expect(loads()).toEqual({});
  });
});
