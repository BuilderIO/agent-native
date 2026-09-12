// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forwardEmbeddedCanvasPanMessage,
  type EmbeddedCanvasPanSession,
} from "./iframe-pan";

function panMessage(
  phase: "start" | "move" | "end" | "cancel",
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "embedded-canvas-pan",
    phase,
    pointerId: 7,
    button: 1,
    buttons: phase === "end" || phase === "cancel" ? 0 : 4,
    clientX: 20,
    clientY: 30,
    movementX: 0,
    movementY: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("forwardEmbeddedCanvasPanMessage", () => {
  let iframe: HTMLIFrameElement;
  let frameLeft = 100;
  let frameTop = 50;

  beforeEach(() => {
    frameLeft = 100;
    frameTop = 50;
    iframe = document.createElement("iframe");
    document.body.append(iframe);
    Object.defineProperty(iframe, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(iframe, "clientHeight", {
      configurable: true,
      value: 100,
    });
    vi.spyOn(iframe, "getBoundingClientRect").mockImplementation(() => ({
      x: frameLeft,
      y: frameTop,
      top: frameTop,
      right: frameLeft + 400,
      bottom: frameTop + 200,
      left: frameLeft,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("maps the start through iframe scale and preserves parent-pixel deltas", () => {
    const events: Array<{
      type: string;
      button: number;
      buttons: number;
      clientX: number;
      clientY: number;
    }> = [];
    const record = (event: Event) => {
      const mouse = event as MouseEvent;
      events.push({
        type: mouse.type,
        button: mouse.button,
        buttons: mouse.buttons,
        clientX: mouse.clientX,
        clientY: mouse.clientY,
      });
    };
    iframe.addEventListener("mousedown", record);
    window.addEventListener("mousemove", record, { once: true });
    window.addEventListener("mouseup", record, { once: true });

    let session: EmbeddedCanvasPanSession | null = null;
    const start = forwardEmbeddedCanvasPanMessage({
      data: panMessage("start"),
      iframe,
      hostWindow: window,
      session,
    });
    session = start.session;
    const move = forwardEmbeddedCanvasPanMessage({
      data: panMessage("move", {
        clientX: 35,
        clientY: 45,
        movementX: 15,
        movementY: 15,
      }),
      iframe,
      hostWindow: window,
      session,
    });
    session = move.session;
    const end = forwardEmbeddedCanvasPanMessage({
      data: panMessage("end", {
        clientX: 40,
        clientY: 50,
        movementX: 5,
        movementY: 5,
      }),
      iframe,
      hostWindow: window,
      session,
    });

    expect(start.handled).toBe(true);
    expect(move.handled).toBe(true);
    expect(end).toEqual({ handled: true, session: null });
    expect(events).toEqual([
      {
        type: "mousedown",
        button: 1,
        buttons: 4,
        clientX: 140,
        clientY: 110,
      },
      {
        type: "mousemove",
        button: 1,
        buttons: 4,
        clientX: 155,
        clientY: 125,
      },
      {
        type: "mouseup",
        button: 1,
        buttons: 0,
        clientX: 160,
        clientY: 130,
      },
    ]);
  });

  it("rejects malformed, reordered, and mismatched packets", () => {
    const mousedown = vi.fn();
    const mousemove = vi.fn();
    iframe.addEventListener("mousedown", mousedown);
    window.addEventListener("mousemove", mousemove);

    expect(
      forwardEmbeddedCanvasPanMessage({
        data: panMessage("move"),
        iframe,
        hostWindow: window,
        session: null,
      }),
    ).toEqual({ handled: false, session: null });
    expect(
      forwardEmbeddedCanvasPanMessage({
        data: panMessage("start", { clientX: Number.NaN }),
        iframe,
        hostWindow: window,
        session: null,
      }),
    ).toEqual({ handled: false, session: null });
    const session = {
      pointerId: 7,
      button: 1 as const,
      clientX: 140,
      clientY: 110,
    };
    expect(
      forwardEmbeddedCanvasPanMessage({
        data: panMessage("move", { pointerId: 99 }),
        iframe,
        hostWindow: window,
        session,
      }),
    ).toEqual({
      handled: false,
      session,
    });
    expect(mousedown).not.toHaveBeenCalled();
    expect(mousemove).not.toHaveBeenCalled();
  });

  it("bounds hostile iframe coordinates before mapping them to the viewport", () => {
    let received: { clientX: number; clientY: number } | null = null;
    iframe.addEventListener("mousedown", (event) => {
      const mouse = event as MouseEvent;
      received = { clientX: mouse.clientX, clientY: mouse.clientY };
    });

    forwardEmbeddedCanvasPanMessage({
      data: panMessage("start", {
        clientX: 1_000_000_000,
        clientY: -1_000_000_000,
      }),
      iframe,
      hostWindow: window,
      session: null,
    });

    expect(received).toEqual({ clientX: 100_000, clientY: -100_000 });
  });

  it("keeps pan deltas stable when the parent scrolls the iframe between messages", () => {
    const moves: Array<{ clientX: number; clientY: number }> = [];
    window.addEventListener("mousemove", (event) => {
      const mouse = event as MouseEvent;
      moves.push({ clientX: mouse.clientX, clientY: mouse.clientY });
    });

    const start = forwardEmbeddedCanvasPanMessage({
      data: panMessage("start"),
      iframe,
      hostWindow: window,
      session: null,
    });
    frameLeft = 70;
    frameTop = 20;
    const move = forwardEmbeddedCanvasPanMessage({
      data: panMessage("move", {
        clientX: 35,
        clientY: 45,
        movementX: 15,
        movementY: 15,
      }),
      iframe,
      hostWindow: window,
      session: start.session,
    });

    expect(moves).toEqual([{ clientX: 155, clientY: 125 }]);
    expect(move.session).toEqual({
      pointerId: 7,
      button: 1,
      clientX: 155,
      clientY: 125,
    });
  });
});
