import { describe, expect, it } from "vitest";
import { uploadedAssetUrlForBasePath } from "./assets-url";

describe("uploadedAssetUrl", () => {
  it("returns root-relative upload URLs without a configured base path", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "")).toBe(
      "/uploads/logo.png",
    );
  });

  it("prefixes upload URLs with APP_BASE_PATH", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "/slides/")).toBe(
      "/slides/uploads/logo.png",
    );
  });
});
