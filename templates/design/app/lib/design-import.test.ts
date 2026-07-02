import { describe, expect, it } from "vitest";

import {
  getFigmaClipboardContent,
  hasFigmaClipboardPayload,
  looksLikeStandaloneHtml,
} from "./design-import";

function clipboardData(values: Record<string, string>) {
  return {
    getData(type: string) {
      return values[type] ?? "";
    },
  };
}

describe("design import clipboard helpers", () => {
  it("detects Figma clipboard HTML metadata", () => {
    expect(
      hasFigmaClipboardPayload('<div data-metadata="(figmeta)"></div>'),
    ).toBe(true);
  });

  it("prefers Figma HTML over plain text", () => {
    expect(
      getFigmaClipboardContent(
        clipboardData({
          "text/html": '<div data-buffer="(figma)">frame</div>',
          "text/plain": "plain text",
        }),
      ),
    ).toContain("data-buffer");
  });

  it("ignores normal HTML and text clipboards", () => {
    expect(
      getFigmaClipboardContent(
        clipboardData({
          "text/html": "<main>Standalone HTML</main>",
          "text/plain": "Standalone HTML",
        }),
      ),
    ).toBeNull();
  });

  it("does not treat generic data-buffer attributes as Figma payloads", () => {
    expect(
      getFigmaClipboardContent(
        clipboardData({
          "text/html":
            '<div data-buffer="cached-html" data-metadata="app-data">Layer</div>',
          "text/plain": "Layer",
        }),
      ),
    ).toBeNull();
  });

  it("does not treat plain text Figma mentions as Figma payloads", () => {
    expect(
      getFigmaClipboardContent(
        clipboardData({
          "text/html": "",
          "text/plain": "Please paste this near the (figma) mockup.",
        }),
      ),
    ).toBeNull();
  });

  it("recognizes standalone HTML separately from Figma payloads", () => {
    expect(looksLikeStandaloneHtml("<section>Hero</section>")).toBe(true);
    expect(looksLikeStandaloneHtml("plain text")).toBe(false);
  });
});
