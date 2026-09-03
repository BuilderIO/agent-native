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
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

describe("forwardEmbeddedCanvasPanMessage", () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
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
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      top: 50,
      right: 500,
      bottom: 250,
      left: 100,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("replays one ordered iframe gesture through the parent's existing mouse path", () => {
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
      data: panMessage("move", { clientX: 35, clientY: 45 }),
      iframe,
      hostWindow: window,
      session,
    });
    session = move.session;
    const end = forwardEmbeddedCanvasPanMessage({
      data: panMessage("end", { clientX: 40, clientY: 50 }),
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
        clientX: 170,
        clientY: 140,
      },
      {
        type: "mouseup",
        button: 1,
        buttons: 0,
        clientX: 180,
        clientY: 150,
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
    expect(
      forwardEmbeddedCanvasPanMessage({
        data: panMessage("move", { pointerId: 99 }),
        iframe,
        hostWindow: window,
        session: { pointerId: 7, button: 1 },
      }),
    ).toEqual({
      handled: false,
      session: { pointerId: 7, button: 1 },
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

    expect(received).toEqual({ clientX: 200_100, clientY: -199_950 });
  });
});
