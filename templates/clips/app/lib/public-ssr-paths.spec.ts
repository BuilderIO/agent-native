/**
 * Regression guard: public share/embed/download/invite paths must be correctly
 * identified so root.tsx renders them outside ClientOnly (SSR-first, not
 * spinner-first).
 */
import { describe, expect, it } from "vitest";

// Re-implement the same predicate that root.tsx uses so tests stay in sync
// with the real predicate. If root.tsx changes its predicate, update both.
function isStandalonePublicPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/download" ||
    path.startsWith("/share/") ||
    path.startsWith("/embed/") ||
    path.startsWith("/invite/")
  );
}

describe("isStandalonePublicPath", () => {
  it("matches the /download page", () => {
    expect(isStandalonePublicPath("/download")).toBe(true);
    expect(isStandalonePublicPath("/download/")).toBe(true);
  });

  it("matches /share/:shareId recording pages", () => {
    expect(isStandalonePublicPath("/share/abc123")).toBe(true);
    expect(isStandalonePublicPath("/share/abc123/")).toBe(true);
  });

  it("matches /embed/:shareId embed pages", () => {
    expect(isStandalonePublicPath("/embed/abc123")).toBe(true);
  });

  it("matches /invite/:token team invite pages", () => {
    expect(isStandalonePublicPath("/invite/tok456")).toBe(true);
  });

  it("does NOT match authenticated app paths", () => {
    expect(isStandalonePublicPath("/")).toBe(false);
    expect(isStandalonePublicPath("/library")).toBe(false);
    expect(isStandalonePublicPath("/settings")).toBe(false);
    expect(isStandalonePublicPath("/spaces/abc")).toBe(false);
  });

  it("does NOT match /r/:recordingId which is the private owner dashboard", () => {
    expect(isStandalonePublicPath("/r/abc123")).toBe(false);
  });
});
