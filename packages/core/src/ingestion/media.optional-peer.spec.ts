import { describe, expect, it, vi } from "vitest";

vi.mock("sharp", () => {
  throw Object.assign(new Error("Cannot find package 'sharp'"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
});

const { extractDominantColors } = await import("./media.js");

describe("media optional dependency", () => {
  it("reports a typed install error when image processing is requested without sharp", async () => {
    await expect(
      extractDominantColors(new Uint8Array([1])),
    ).rejects.toMatchObject({
      name: "OptionalPeerDependencyError",
      code: "ERR_AGENT_NATIVE_OPTIONAL_PEER",
      packageName: "sharp",
    });
  });
});
