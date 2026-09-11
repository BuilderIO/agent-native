import { describe, expect, it } from "vitest";

import { resolveLocalhostSourceWriteContent } from "./design-editor/editor-state";

describe("resolveLocalhostSourceWriteContent", () => {
  it("uses the authenticated live snapshot for URL-backed HTML screens", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".html",
        persistedContent: "http://127.0.0.1:5173/settings",
        liveSnapshotHtml: "<!doctype html><html><body>Settings</body></html>",
      }),
    ).toContain("<body>Settings</body>");
  });

  it("fails closed while an HTML source snapshot is unavailable", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".html",
        persistedContent: "http://127.0.0.1:5173/settings",
        liveSnapshotHtml: undefined,
      }),
    ).toBeNull();
  });

  it("never treats a route URL as writable HTML or CSS source", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".html",
        persistedContent: "http://127.0.0.1:5173/",
        liveSnapshotHtml: "http://127.0.0.1:5173/",
      }),
    ).toBeNull();
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".css",
        persistedContent: "https://localhost:5173",
        liveSnapshotHtml: undefined,
      }),
    ).toBeNull();
  });

  it("allows an actual CSS source payload", () => {
    expect(
      resolveLocalhostSourceWriteContent({
        extension: ".css",
        persistedContent: ":root { --accent: #7c3aed; }",
        liveSnapshotHtml: undefined,
      }),
    ).toBe(":root { --accent: #7c3aed; }");
  });
});
