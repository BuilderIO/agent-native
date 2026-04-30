import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeAppBasePath,
  withConfiguredAppBasePath,
} from "./app-base-path.js";

describe("server app base path helpers", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  it("normalizes empty and slash-only base paths to no prefix", () => {
    expect(normalizeAppBasePath(undefined)).toBe("");
    expect(normalizeAppBasePath("/")).toBe("");
    expect(normalizeAppBasePath("///")).toBe("");
  });

  it("adds the configured mount path to origin URLs", () => {
    process.env.APP_BASE_PATH = "/docs/";
    expect(withConfiguredAppBasePath("https://app.test")).toBe(
      "https://app.test/docs",
    );
    expect(withConfiguredAppBasePath("https://app.test/")).toBe(
      "https://app.test/docs",
    );
  });

  it("does not duplicate an already-mounted URL", () => {
    process.env.APP_BASE_PATH = "/docs";
    expect(withConfiguredAppBasePath("https://app.test/docs")).toBe(
      "https://app.test/docs",
    );
  });
});
