import { describe, expect, it } from "vitest";

import type { SlideFrameContext, SlideFrameMessage } from "./protocol";
import { parseSandboxedSlideFrameMessage } from "./sandboxed-slide-message";

const context: SlideFrameContext = {
  deckId: "deck-1",
  slideId: "slide-1",
  revision: 2,
  sourceHash: "a".repeat(64),
  nonce: "frame-nonce",
};
const frameWindow = {} as unknown as MessageEventSource;

function snapshot(tagName: string, imageSrc: string) {
  return {
    nodeId: "1:0:0",
    line: 1,
    column: 0,
    instanceIndex: 0,
    instanceCount: 1,
    tagName,
    text: "",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    styles: {},
    imageSrc,
  };
}

function parseNodes(nodes: unknown[]) {
  const message: SlideFrameMessage = {
    protocolVersion: 1,
    ...context,
    type: "snapshot",
    nodes,
  };
  return parseSandboxedSlideFrameMessage(
    {
      data: message,
      origin: "null",
      source: frameWindow,
    },
    frameWindow,
    context,
  )?.nodes;
}

describe("sandboxed slide image source metadata", () => {
  it("preserves a bounded external image URL for crop preview", () => {
    const imageSrc = "https://images.example.test/slide-photo.png";

    expect(parseNodes([snapshot("img", imageSrc)])?.[0]?.imageSrc).toBe(
      imageSrc,
    );
  });

  it("drops data URLs and image sources attached to non-image nodes", () => {
    const parsed = parseNodes([
      snapshot("img", "data:image/png;base64,AA=="),
      snapshot("div", "https://images.example.test/slide-photo.png"),
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed?.[0]).not.toHaveProperty("imageSrc");
    expect(parsed?.[1]).not.toHaveProperty("imageSrc");
  });
});
