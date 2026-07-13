import { describe, expect, it } from "vitest";

import {
  type DesignClipboardPayload,
  getFigmaClipboardContent,
  hasFigmaClipboardPayload,
  importResultNotification,
  type JsonParsableResponse,
  looksLikeStandaloneHtml,
  parseDesignClipboardMarker,
  parseUploadResponse,
  serializeDesignClipboardPayload,
} from "./design-import";

describe("import result notifications", () => {
  it("keeps a clean .fig import to one success notification", () => {
    expect(
      importResultNotification(
        {
          files: [{ id: "screen-1", filename: "Page-Frame.html" }],
          warnings: [
            "Figma's .fig format is proprietary and undocumented. Unsupported features may render differently.",
          ],
        },
        "File imported",
      ),
    ).toEqual({
      variant: "success",
      title: "Imported Page-Frame.html.",
    });
  });

  it("shows actionable warnings without the generic format caveat", () => {
    expect(
      importResultNotification(
        {
          files: [{ id: "screen-1", filename: "Page-Frame.html" }],
          warnings: [
            "Figma's .fig format is proprietary and undocumented. Unsupported features may render differently.",
            "2 embedded images were omitted because file storage is unavailable.",
          ],
        },
        "File imported",
      ),
    ).toEqual({
      variant: "warning",
      title: "Imported Page-Frame.html.",
      description:
        "2 embedded images were omitted because file storage is unavailable.",
    });
  });

  it("surfaces complex Figma fallback and approximation counts instead of reporting a clean success", () => {
    expect(
      importResultNotification(
        {
          files: [{ id: "screen-1", filename: "Stress-Frame.html" }],
          fidelityReport: {
            exactCount: 40,
            imageFallbacks: [
              {
                nodeId: "4:12",
                nodeName: "Masked vector",
                nodeType: "VECTOR",
                notes: ["Mask subtree rendered by Figma."],
              },
              {
                nodeId: "4:20",
                nodeName: "Rich text",
                nodeType: "TEXT",
                notes: ["Advanced typography rendered by Figma."],
              },
            ],
            approximated: [
              {
                nodeId: "4:30",
                nodeName: "Diamond gradient",
                nodeType: "ELLIPSE",
                notes: ["CSS has no diamond-gradient primitive."],
              },
            ],
          },
        },
        "Imported from Figma.",
        {
          fidelityWarnings: [
            "Image fallbacks: 2. Appearance is preserved, but these layers are not fully editable.",
            "Approximated layers: 1. HTML/CSS cannot represent every Figma property exactly.",
          ],
        },
      ),
    ).toEqual({
      variant: "warning",
      title: "Imported Stress-Frame.html.",
      description:
        "Image fallbacks: 2. Appearance is preserved, but these layers are not fully editable.\nApproximated layers: 1. HTML/CSS cannot represent every Figma property exactly.",
    });
  });

  it("keeps fidelity warnings bounded with existing import warnings", () => {
    const notification = importResultNotification(
      {
        warnings: ["Storage warning", "Font warning", "Another warning"],
        fidelityReport: {
          exactCount: 0,
          imageFallbacks: [
            { nodeId: "1:1", nodeType: "VECTOR", notes: ["Fallback"] },
          ],
          approximated: [
            { nodeId: "1:2", nodeType: "TEXT", notes: ["Approximation"] },
          ],
        },
      },
      "Imported from Figma.",
      {
        fidelityWarnings: [
          "Image fallbacks: 1. Appearance is preserved, but these layers are not fully editable.",
          "Approximated layers: 1. HTML/CSS cannot represent every Figma property exactly.",
        ],
      },
    );

    expect(notification.variant).toBe("warning");
    expect(notification.description?.split("\n")).toHaveLength(3);
    expect(notification.description).not.toContain("image fallback");
  });
});

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

  it("detects current bare-comment Figma clipboard markers", () => {
    const html =
      '<meta charset="utf-8"><!--(figmeta)ZXhhbXBsZQ==(/figmeta)--><!--(figma)ZXhhbXBsZQ==(/figma)-->';
    expect(hasFigmaClipboardPayload(html)).toBe(true);
    expect(getFigmaClipboardContent(clipboardData({ "text/html": html }))).toBe(
      html,
    );
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

  it("ignores generic data-buffer attributes", () => {
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

  it("ignores plain text Figma mentions", () => {
    expect(
      getFigmaClipboardContent(
        clipboardData({
          "text/html": "",
          "text/plain": "Please paste this near the (figma) mockup.",
        }),
      ),
    ).toBeNull();
  });

  it("recognizes standalone HTML separately from Figma clipboard markers", () => {
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

  it("round-trips bounded managed responsive and interaction rules", () => {
    const responsivePayload: DesignClipboardPayload = {
      version: 1,
      entries: [
        {
          html: '<div data-agent-native-node-id="card">Card</div>',
          rootNodeId: "card",
          sourceFileId: "file-1",
          managedStyleSnapshot: {
            version: 1,
            breakpoints: [
              {
                maxWidthPx: 809,
                nodeId: "card",
                property: "padding",
                value: "16px",
              },
            ],
            interactionStates: [
              {
                nodeId: "card",
                state: "hover",
                property: "color",
                value: "red",
              },
            ],
          },
        },
      ],
    };
    expect(
      parseDesignClipboardMarker(
        serializeDesignClipboardPayload("Card", responsivePayload),
      ),
    ).toEqual(responsivePayload);
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

  it("rejects an oversized marker before attempting to decode it", () => {
    const oversizedData = "A".repeat(16_000_001);
    expect(
      parseDesignClipboardMarker(
        `<!--agent-native-clipboard-v1:${oversizedData}-->`,
      ),
    ).toBeNull();
  });

  it("rejects structurally invalid typed payloads", () => {
    const invalid = {
      version: 1,
      entries: [{ html: 42, sourceFileId: "file-1" }],
    };
    const marker = btoa(encodeURIComponent(JSON.stringify(invalid)));
    expect(
      parseDesignClipboardMarker(`<!--agent-native-clipboard-v1:${marker}-->`),
    ).toBeNull();
  });

  it("rejects cross-design screen payloads with unsafe filenames or geometry", () => {
    for (const screen of [
      {
        filename: "../private.html",
        content: "<main>nope</main>",
      },
      {
        filename: "safe.html",
        content: "<main>nope</main>",
        canvasFrame: { x: Number.POSITIVE_INFINITY },
      },
    ]) {
      const marker = btoa(
        encodeURIComponent(
          JSON.stringify({ version: 1, entries: [], screens: [screen] }),
        ),
      );
      expect(
        parseDesignClipboardMarker(
          `<!--agent-native-clipboard-v1:${marker}-->`,
        ),
      ).toBeNull();
    }
  });

  it("ignores an unrelated HTML comment that isn't our marker", () => {
    expect(
      parseDesignClipboardMarker("<div>Hi</div>\n<!-- just a comment -->"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseUploadResponse — R83: never let a non-JSON error body (plaintext
// "Internal Error", an HTML proxy error page, etc.) throw a raw parser
// SyntaxError into the upload toast. Failure responses always degrade to a
// clean `{ error }` message; success responses are still expected to be real
// JSON so a genuinely broken 200 stays loud instead of masquerading as an
// empty successful import.
// ---------------------------------------------------------------------------

function fakeResponse(status: number, body: string): JsonParsableResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

describe("parseUploadResponse", () => {
  it("parses a well-formed JSON success body", async () => {
    const result = await parseUploadResponse(
      fakeResponse(200, JSON.stringify({ designId: "abc", files: [] })),
      "Upload failed",
    );
    expect(result).toEqual({ designId: "abc", files: [] });
  });

  it("parses a well-formed JSON error envelope from a failed response", async () => {
    const result = await parseUploadResponse(
      fakeResponse(400, JSON.stringify({ error: "No file uploaded" })),
      "Upload failed",
    );
    expect(result).toEqual({ error: "No file uploaded" });
  });

  it("degrades a plaintext non-JSON failure body to a clean error message instead of throwing", async () => {
    // This is the exact R83 repro: an upstream proxy/platform crash page
    // returns plaintext ("Internal E..." truncated), not the route's own
    // JSON envelope. response.json() on this body throws
    // `SyntaxError: Unexpected token 'I', "Internal E"... is not valid JSON`.
    const result = await parseUploadResponse(
      fakeResponse(500, "Internal Error"),
      "Upload failed",
    );
    expect(result.error).toBe("Upload failed: Internal Error");
  });

  it("truncates an overlong non-JSON failure body (e.g. an HTML error page)", async () => {
    const longBody = `<html><body>${"x".repeat(500)}</body></html>`;
    const result = await parseUploadResponse(
      fakeResponse(502, longBody),
      "Upload failed",
    );
    expect(result.error?.length).toBeLessThan(longBody.length);
    expect(result.error).toContain("…");
  });

  it("falls back to the plain fallback message when the failure body is empty", async () => {
    const result = await parseUploadResponse(
      fakeResponse(500, ""),
      "Upload failed",
    );
    expect(result.error).toBe("Upload failed");
  });

  it("falls back to the plain fallback message when the failure body fails to parse despite looking JSON-shaped", async () => {
    const result = await parseUploadResponse(
      fakeResponse(500, "{not: actually valid json"),
      "Upload failed",
    );
    expect(result.error).toBe("Upload failed");
  });

  it("throws (does not silently swallow) when a successful response isn't JSON at all", async () => {
    await expect(
      parseUploadResponse(fakeResponse(200, "Internal Error"), "Upload failed"),
    ).rejects.toThrow(SyntaxError);
  });

  it("throws when a successful response's body looks JSON-shaped but fails to parse", async () => {
    await expect(
      parseUploadResponse(
        fakeResponse(200, "{not: actually valid json"),
        "Upload failed",
      ),
    ).rejects.toThrow(SyntaxError);
  });
});
