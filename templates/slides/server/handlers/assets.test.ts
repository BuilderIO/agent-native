import { describe, expect, it, vi } from "vitest";
import { uploadedAssetUrl } from "./assets";

describe("uploadedAssetUrl", () => {
  it("returns root-relative upload URLs without a configured base path", () => {
    vi.stubEnv("APP_BASE_PATH", "");
    vi.stubEnv("VITE_APP_BASE_PATH", "");

    expect(uploadedAssetUrl("logo.png")).toBe("/uploads/logo.png");
  });

  it("prefixes upload URLs with APP_BASE_PATH", () => {
    vi.stubEnv("APP_BASE_PATH", "/slides/");
    vi.stubEnv("VITE_APP_BASE_PATH", "");

    expect(uploadedAssetUrl("logo.png")).toBe("/slides/uploads/logo.png");
  });
});
