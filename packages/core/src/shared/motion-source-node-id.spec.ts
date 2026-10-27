import { describe, expect, it } from "vitest";

import {
  generatedMotionNodeId,
  isMotionSourceHostElementTag,
} from "./motion-source-node-id.js";

describe("generatedMotionNodeId", () => {
  it("is stable per module and host JSX order", () => {
    expect(generatedMotionNodeId("src/Card.tsx", 1)).toBe(
      generatedMotionNodeId("src/Card.tsx", 1),
    );
    expect(generatedMotionNodeId("src/Card.tsx", 1)).not.toBe(
      generatedMotionNodeId("src/Card.tsx", 2),
    );
    expect(generatedMotionNodeId("src/Card.tsx", 1)).not.toBe(
      generatedMotionNodeId("src/Other.tsx", 1),
    );
  });

  it("leaves non-rendered script and style tags out of layer identity", () => {
    expect(isMotionSourceHostElementTag("div")).toBe(true);
    expect(isMotionSourceHostElementTag("script")).toBe(false);
    expect(isMotionSourceHostElementTag("style")).toBe(false);
  });
});
