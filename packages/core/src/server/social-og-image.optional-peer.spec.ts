import { describe, expect, it, vi } from "vitest";

vi.mock("@resvg/resvg-js", () => {
  throw Object.assign(new Error("Cannot find package '@resvg/resvg-js'"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
});

const { renderAgentNativeOgImagePng } = await import("./social-og-image.js");

describe("social OG image optional dependency", () => {
  it("reports a typed install error when PNG rendering is requested without Resvg", async () => {
    await expect(renderAgentNativeOgImagePng()).rejects.toMatchObject({
      name: "OptionalPeerDependencyError",
      code: "ERR_AGENT_NATIVE_OPTIONAL_PEER",
      packageName: "@resvg/resvg-js",
    });
  });
});
