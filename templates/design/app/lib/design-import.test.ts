import { describe, expect, it } from "vitest";

import {
  type DesignClipboardPayload,
  getFigmaClipboardContent,
  hasFigmaClipboardPayload,
  looksLikeStandaloneHtml,
  parseDesignClipboardMarker,
  serializeDesignClipboardPayload,
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

describe("design clipboard marker round-trip", () => {
  const payload: DesignClipboardPayload = {
    version: 1,
    entries: [
      {
        html: "<div>Hello</div>",
        rootNodeId: "node-1",
        sourceFileId: "file-1",
        portableStyleSnapshot: {
          version: 1,
          rootSourceId: "node-1",
          nodes: [{ sourceId: "node-1", path: [], styles: { color: "red" } }],
        },
      },
    ],
  };

  it("round-trips entries through the serialized marker", () => {
    const clipboardText = serializeDesignClipboardPayload(
      "<div>Hello</div>",
      payload,
    );
    const parsed = parseDesignClipboardMarker(clipboardText);
    expect(parsed).toEqual(payload);
  });

  it("keeps the visible text human-readable ahead of the marker", () => {
    const clipboardText = serializeDesignClipboardPayload(
      "<div>Hello</div>",
      payload,
    );
    expect(clipboardText.startsWith("<div>Hello</div>")).toBe(true);
  });

  it("round-trips screen snapshots for whole-screen copy/paste", () => {
    const screenPayload: DesignClipboardPayload = {
      version: 1,
      entries: [],
      screens: [
        {
          filename: "home.html",
          fileType: "html",
          content: "<html><body>Home</body></html>",
          canvasFrame: { x: 100, y: 200, width: 390, height: 844 },
        },
      ],
    };
    const clipboardText = serializeDesignClipboardPayload(
      "<html><body>Home</body></html>",
      screenPayload,
    );
    expect(parseDesignClipboardMarker(clipboardText)).toEqual(screenPayload);
  });

  it("returns null for clipboard content with no marker", () => {
    expect(
      parseDesignClipboardMarker("<div>Plain copy from elsewhere</div>"),
    ).toBeNull();
    expect(parseDesignClipboardMarker(null)).toBeNull();
    expect(parseDesignClipboardMarker(undefined)).toBeNull();
  });

  it("returns null for a marker-shaped comment with corrupted payload data", () => {
    expect(
      parseDesignClipboardMarker(
        "<div>Hi</div>\n<!--agent-native-clipboard-v1:not-valid-base64!!!-->",
      ),
    ).toBeNull();
  });

  it("ignores an unrelated HTML comment that isn't our marker", () => {
    expect(
      parseDesignClipboardMarker("<div>Hi</div>\n<!-- just a comment -->"),
    ).toBeNull();
  });
});
