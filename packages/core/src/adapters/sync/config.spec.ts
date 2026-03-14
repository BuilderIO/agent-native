import { describe, it, expect } from "vitest";
import { shouldSyncFile, getDocId } from "./config.js";

describe("shouldSyncFile", () => {
  it("matches a file against a positive pattern", () => {
    expect(shouldSyncFile("file.json", ["*.json"])).toBe(true);
  });

  it("returns false when no patterns match", () => {
    expect(shouldSyncFile("data/file.txt", ["*.json"])).toBe(false);
  });

  it("returns false for empty patterns array", () => {
    expect(shouldSyncFile("anything.json", [])).toBe(false);
  });

  it("excludes files matching negation patterns", () => {
    expect(shouldSyncFile("secret.tmp", ["*.*", "!*.tmp"])).toBe(false);
  });

  it("matches dot files when pattern uses dot: true", () => {
    expect(shouldSyncFile(".env", [".*"])).toBe(true);
  });

  it("returns false when positive and negation cancel out", () => {
    expect(shouldSyncFile("data.json", ["*.json", "!*.json"])).toBe(false);
  });

  it("matches glob patterns with directory wildcards", () => {
    expect(shouldSyncFile("data/nested/file.json", ["data/**/*.json"])).toBe(
      true,
    );
  });
});

describe("getDocId", () => {
  it("generates an ID from appId and file path", () => {
    expect(getDocId("app1", "data/file.json")).toBe("app1__data__file.json");
  });

  it("replaces consecutive slashes", () => {
    expect(getDocId("app1", "data//file.json")).toBe("app1__data____file.json");
  });

  it("handles trailing slashes", () => {
    expect(getDocId("app1", "data/dir/")).toBe("app1__data__dir__");
  });

  it("handles paths with no slashes", () => {
    expect(getDocId("app1", "file.json")).toBe("app1__file.json");
  });
});
