import { describe, expect, it } from "vitest";

import { isStaleDocsChunkError } from "./docs-error-classification.js";

describe("isStaleDocsChunkError", () => {
  it("recognizes a stale dynamic-import chunk failure", () => {
    const error = new Error(
      "Failed to fetch dynamically imported module: https://www.agent-native.com/assets/AgentSidebar-abc123.js",
    );
    expect(isStaleDocsChunkError(error)).toBe(true);
  });

  it("does not recognize a plain render/hydration error", () => {
    expect(
      isStaleDocsChunkError(
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);
    expect(isStaleDocsChunkError(new Error("Hydration failed"))).toBe(false);
    expect(isStaleDocsChunkError(undefined)).toBe(false);
    expect(isStaleDocsChunkError("some string error")).toBe(false);
  });
});
