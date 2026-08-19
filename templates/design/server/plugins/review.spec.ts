import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  defineNitroPlugin: vi.fn((setup) => {
    setup();
    return { kind: "nitro-plugin" };
  }),
  registerReviewableResource: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  defineNitroPlugin: mocks.defineNitroPlugin,
}));

vi.mock("@agent-native/core/review", () => ({
  registerReviewableResource: mocks.registerReviewableResource,
}));

import reviewPlugin from "./review.js";

describe("design review plugin", () => {
  it("registers designs with the shared review kit", () => {
    expect(reviewPlugin).toMatchObject({ kind: "nitro-plugin" });
    expect(mocks.registerReviewableResource).toHaveBeenCalledWith({
      type: "design",
      displayName: "Design",
    });
  });
});
