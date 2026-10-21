import { describe, expect, it, vi } from "vitest";

import type { SlideFrameContext, SlideFrameMessage } from "./protocol";
import {
  forwardSandboxedSlidePointer,
  parseSandboxedSlideFrameMessage,
} from "./sandboxed-slide-message";

const context: SlideFrameContext = {
  deckId: "deck-1",
  slideId: "slide-1",
  revision: 2,
  sourceHash: "a".repeat(64),
  nonce: "frame-nonce",
};
const frameWindow = {} as unknown as MessageEventSource;

function frameMessage(
  type: SlideFrameMessage["type"],
  extra: Partial<SlideFrameMessage> = {},
): SlideFrameMessage {
  return {
    protocolVersion: 1,
    ...context,
    type,
    ...extra,
  };
}

function messageEvent(
  data: unknown,
  source: MessageEventSource = frameWindow,
  origin = "null",
): MessageEvent<unknown> {
  return { data, source, origin } as MessageEvent<unknown>;
}

describe("SandboxedSlide frame messages", () => {
  it("keeps valid instance metadata and drops out-of-range counts", () => {
    const node = (instanceIndex: number, instanceCount: number) => ({
      nodeId: `1:0:${instanceIndex}`,
      line: 1,
      column: 0,
      instanceIndex,
      instanceCount,
      tagName: "div",
      text: "Repeated object",
      bounds: { x: 0, y: instanceIndex * 40, width: 100, height: 30 },
      styles: {},
    });
    const message = frameMessage("snapshot", {
      nodes: [node(0, 2), node(1, 2)],
    });

    expect(
      parseSandboxedSlideFrameMessage(
        messageEvent(message),
        frameWindow,
        context,
      )?.nodes,
    ).toEqual([
      expect.objectContaining({ instanceIndex: 0, instanceCount: 2 }),
      expect.objectContaining({ instanceIndex: 1, instanceCount: 2 }),
    ]);

    const oversized = parseSandboxedSlideFrameMessage(
      messageEvent(frameMessage("snapshot", { nodes: [node(0, 8_001)] })),
      frameWindow,
      context,
    );
    expect(oversized?.nodes).toEqual([
      expect.not.objectContaining({ instanceIndex: expect.any(Number) }),
    ]);
  });

  it("accepts current-frame pointer messages and marks only down activity", () => {
    const pointer = {
      phase: "move",
      x: 480,
      y: 270,
      button: 0,
      pointerId: 1,
      pointerType: "touch",
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      target: null,
    };
    const message = frameMessage("pointer", { pointer });
    const parsed = parseSandboxedSlideFrameMessage(
      messageEvent(message),
      frameWindow,
      context,
    );
    const onPointer = vi.fn();
    const onPointerActivity = vi.fn();

    expect(parsed?.pointer).toMatchObject({
      phase: "move",
      x: 480,
      y: 270,
      pointerType: "touch",
      target: null,
    });
    expect(parsed?.pointerActivity).toBeNull();
    if (parsed) {
      forwardSandboxedSlidePointer(parsed, onPointer, onPointerActivity);
    }
    expect(onPointer).toHaveBeenCalledWith(parsed?.pointer);
    expect(onPointerActivity).not.toHaveBeenCalled();

    const unsupported = parseSandboxedSlideFrameMessage(
      messageEvent(
        frameMessage("pointer", {
          pointer: { ...pointer, pointerType: "trackpad" },
        }),
      ),
      frameWindow,
      context,
    );
    expect(unsupported?.pointer).toBeNull();
    if (unsupported) {
      forwardSandboxedSlidePointer(unsupported, onPointer, onPointerActivity);
    }
    expect(onPointer).toHaveBeenCalledTimes(1);
    expect(
      parseSandboxedSlideFrameMessage(
        messageEvent(message, {} as unknown as MessageEventSource),
        frameWindow,
        context,
      ),
    ).toBeNull();
    expect(
      parseSandboxedSlideFrameMessage(
        messageEvent(message, frameWindow, "https://slides-2.agent-native.com"),
        frameWindow,
        context,
      ),
    ).toBeNull();
    expect(
      parseSandboxedSlideFrameMessage(
        messageEvent(
          frameMessage("pointer", { nonce: "stale-nonce", pointer }),
        ),
        frameWindow,
        context,
      ),
    ).toBeNull();

    const down = parseSandboxedSlideFrameMessage(
      messageEvent(
        frameMessage("pointer", { pointer: { ...pointer, phase: "down" } }),
      ),
      frameWindow,
      context,
    );
    expect(down?.pointer).toMatchObject({
      phase: "down",
      pointerType: "touch",
    });
    expect(down?.pointerActivity).toBe("touch");
    if (down) {
      forwardSandboxedSlidePointer(down, onPointer, onPointerActivity);
    }
    expect(onPointer).toHaveBeenCalledTimes(2);
    expect(onPointer).toHaveBeenLastCalledWith(down?.pointer);
    expect(onPointerActivity).toHaveBeenCalledTimes(1);
    expect(onPointerActivity).toHaveBeenCalledWith("touch");
  });

  it("forwards the topmost DOM hit on a targetless pointerdown", () => {
    const snapshot = {
      line: 3,
      column: 4,
      nodeId: "3:4:0",
      tagName: "aside",
      text: "Front layer",
      bounds: { x: 50, y: 50, width: 260, height: 180 },
      styles: { zIndex: "2" },
    };
    const hitTarget = {
      line: snapshot.line,
      column: snapshot.column,
      nodeId: snapshot.nodeId,
      snapshot,
    };
    const message = frameMessage("pointer", {
      pointer: {
        phase: "down",
        x: 100,
        y: 100,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        target: null,
        hitTarget,
      },
    });
    const parsed = parseSandboxedSlideFrameMessage(
      messageEvent(message),
      frameWindow,
      context,
    );
    const onPointer = vi.fn();

    expect(parsed?.pointer).toMatchObject({
      phase: "down",
      target: null,
      hitTarget,
    });
    if (parsed) forwardSandboxedSlidePointer(parsed, onPointer);
    expect(onPointer).toHaveBeenCalledWith(parsed?.pointer);
  });
});
