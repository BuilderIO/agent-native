// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import type { SlideRenderArtifact } from "./protocol";
import { SandboxedSlide } from "./SandboxedSlide";

afterEach(cleanup);

const artifact: SlideRenderArtifact = {
  protocolVersion: 1,
  deckId: "deck-1",
  slideId: "slide-1",
  revision: 2,
  sourceHash: "a".repeat(64),
  width: 1920,
  height: 1080,
  html: "<div>Slide</div>",
  assetOrigins: [],
};

describe("SandboxedSlide pointer messages", () => {
  it("forwards bounded rendered instance metadata from frame snapshots", async () => {
    const onNodes = vi.fn();
    const { container } = render(
      <SandboxedSlide
        artifact={artifact}
        title="Slide"
        onNodes={onNodes}
        onPointer={() => {}}
      />,
    );
    const frame = await waitFor(() => {
      const current = container.querySelector<HTMLIFrameElement>(
        "iframe[data-slides2-frame]",
      );
      if (!current?.contentWindow || !current.srcdoc) {
        throw new Error("sandboxed slide frame is not ready");
      }
      return current;
    });
    const nonce = /nonce="([^"]+)"/.exec(frame.srcdoc)?.[1];
    expect(nonce).toBeTruthy();
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
    const message = {
      protocolVersion: 1,
      nonce,
      deckId: artifact.deckId,
      slideId: artifact.slideId,
      revision: artifact.revision,
      sourceHash: artifact.sourceHash,
      type: "snapshot",
      nodes: [node(0, 2), node(1, 2)],
    };

    window.dispatchEvent(
      new MessageEvent("message", {
        data: message,
        origin: "null",
        source: frame.contentWindow,
      }),
    );

    expect(onNodes).toHaveBeenCalledWith([
      expect.objectContaining({ instanceIndex: 0, instanceCount: 2 }),
      expect.objectContaining({ instanceIndex: 1, instanceCount: 2 }),
    ]);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { ...message, nodes: [node(0, 8_001)] },
        origin: "null",
        source: frame.contentWindow,
      }),
    );

    expect(onNodes).toHaveBeenLastCalledWith([
      expect.not.objectContaining({ instanceIndex: expect.any(Number) }),
    ]);
  });

  it("forwards validated frame moves and down activity", async () => {
    const onPointer = vi.fn();
    const onPointerActivity = vi.fn();
    const { container } = render(
      <SandboxedSlide
        artifact={artifact}
        title="Slide"
        onNodes={() => {}}
        onPointer={onPointer}
        onPointerActivity={onPointerActivity}
      />,
    );
    const frame = await waitFor(() => {
      const current = container.querySelector<HTMLIFrameElement>(
        "iframe[data-slides2-frame]",
      );
      if (!current?.contentWindow || !current.srcdoc) {
        throw new Error("sandboxed slide frame is not ready");
      }
      return current;
    });
    const nonce = /nonce="([^"]+)"/.exec(frame.srcdoc)?.[1];
    expect(nonce).toBeTruthy();

    const message = {
      protocolVersion: 1,
      nonce,
      deckId: artifact.deckId,
      slideId: artifact.slideId,
      revision: artifact.revision,
      sourceHash: artifact.sourceHash,
      type: "pointer",
      pointer: {
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
      },
    };
    const staleFrame = document.createElement("iframe");
    document.body.append(staleFrame);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...message,
          pointer: { ...message.pointer, pointerType: "trackpad" },
        },
        origin: "null",
        source: frame.contentWindow,
      }),
    );
    expect(onPointer).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: message,
        origin: "null",
        source: staleFrame.contentWindow,
      }),
    );
    expect(onPointer).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: message,
        origin: "null",
        source: frame.contentWindow,
      }),
    );
    expect(onPointer).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "move",
        x: 480,
        y: 270,
        pointerType: "touch",
        target: null,
      }),
    );
    expect(onPointerActivity).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          ...message,
          pointer: { ...message.pointer, phase: "down" },
        },
        origin: "null",
        source: frame.contentWindow,
      }),
    );
    expect(onPointerActivity).toHaveBeenCalledTimes(1);
    expect(onPointerActivity).toHaveBeenCalledWith("touch");
    staleFrame.remove();
  });
});
