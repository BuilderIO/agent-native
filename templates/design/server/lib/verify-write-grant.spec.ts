/**
 * Unit tests for assertPathInside (pure logic, no DB).
 */

import { describe, expect, it } from "vitest";

import { assertPathInside } from "./verify-write-grant.js";

describe("assertPathInside", () => {
  const root = "/Users/alice/projects/my-app";

  it("allows a relative path inside root", () => {
    expect(() => assertPathInside(root, "src/index.html")).not.toThrow();
  });

  it("allows a nested relative path", () => {
    expect(() =>
      assertPathInside(root, "public/styles/main.css"),
    ).not.toThrow();
  });

  it("allows an absolute path that is inside root", () => {
    expect(() =>
      assertPathInside(root, `${root}/src/index.html`),
    ).not.toThrow();
  });

  it("blocks ../ traversal in relative path", () => {
    expect(() => assertPathInside(root, "../sibling-app/index.html")).toThrow(
      /outside the consented root/,
    );
  });

  it("blocks ../ traversal nested inside path", () => {
    expect(() => assertPathInside(root, "src/../../etc/passwd")).toThrow(
      /outside the consented root/,
    );
  });

  it("blocks an absolute path outside root", () => {
    expect(() => assertPathInside(root, "/etc/passwd")).toThrow(
      /outside the consented root/,
    );
  });

  it("blocks a path that starts with root prefix but is a sibling dir", () => {
    // e.g. /Users/alice/projects/my-app-evil is NOT inside /Users/alice/projects/my-app
    expect(() =>
      assertPathInside(root, "/Users/alice/projects/my-app-evil/index.html"),
    ).toThrow(/outside the consented root/);
  });

  it("allows the root directory itself (edge case)", () => {
    // Targeting root itself — allowed (unlikely but should not throw)
    expect(() => assertPathInside(root, root)).not.toThrow();
  });

  it("handles root with trailing slash", () => {
    expect(() => assertPathInside(`${root}/`, "src/index.html")).not.toThrow();
  });
});
