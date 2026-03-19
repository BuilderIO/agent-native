import { describe, it, expect } from "vitest";
import { shouldSyncFile, getDocId, isDenylisted } from "./config.js";

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

  it("blocks denylisted files even if pattern matches", () => {
    expect(shouldSyncFile(".env", [".*"])).toBe(false);
    expect(shouldSyncFile(".env.local", [".*"])).toBe(false);
  });

  it("matches non-denylisted dot files when pattern uses dot: true", () => {
    expect(shouldSyncFile(".myconfig", [".*"])).toBe(true);
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

describe("isDenylisted", () => {
  it("blocks .env files", () => {
    expect(isDenylisted(".env")).toBe(true);
    expect(isDenylisted(".env.local")).toBe(true);
  });

  it("blocks node_modules", () => {
    expect(isDenylisted("node_modules/foo/bar.js")).toBe(true);
  });

  it("blocks .git directory", () => {
    expect(isDenylisted(".git/config")).toBe(true);
  });

  it("allows normal files", () => {
    expect(isDenylisted("data/file.json")).toBe(false);
  });
});

describe("getDocId", () => {
  it("generates an ID from appId and file path using : separator", () => {
    expect(getDocId("app1", "data/file.json")).toBe("app1:data/file.json");
  });

  it("preserves path structure", () => {
    expect(getDocId("app1", "data/nested/file.json")).toBe(
      "app1:data/nested/file.json",
    );
  });

  it("handles paths with no slashes", () => {
    expect(getDocId("app1", "file.json")).toBe("app1:file.json");
  });
});
