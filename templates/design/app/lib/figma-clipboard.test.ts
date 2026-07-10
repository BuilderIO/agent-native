import { describe, expect, it } from "vitest";

import {
  decideFigmaPasteStrategy,
  extractFigmeta,
  resolveFigmaPasteImportCall,
} from "./figma-clipboard";

function base64Json(value: unknown): string {
  return btoa(JSON.stringify(value));
}

describe("extractFigmeta", () => {
  it("decodes a figmeta marker wrapping base64 JSON", () => {
    const payload = { fileKey: "abcDEF12345", pasteID: 42, dataType: "scene" };
    const html = `<span data-metadata="(figmeta)${base64Json(payload)}(/figmeta)"></span>`;
    expect(extractFigmeta(html)).toEqual(payload);
  });

  it("decodes a figmeta marker present as a bare HTML comment (not inside an attribute)", () => {
    const payload = { fileKey: "xyzKey999" };
    const html = `<!--(figmeta)${base64Json(payload)}(/figmeta)--><div>Layer</div>`;
    expect(extractFigmeta(html)).toEqual({ fileKey: "xyzKey999" });
  });

  it("falls back to treating a bare data-metadata value as base64 JSON with no wrapper markers", () => {
    const payload = { fileKey: "bareKey123" };
    const html = `<span data-metadata="${base64Json(payload)}"></span>`;
    expect(extractFigmeta(html)).toEqual({ fileKey: "bareKey123" });
  });

  it("only keeps the known figmeta fields and trims the file key", () => {
    const html = `<span data-metadata="(figmeta)${base64Json({
      fileKey: "  spacedKey1 ",
      pasteID: 7,
      dataType: "scene",
      extraField: "ignored",
    })}(/figmeta)"></span>`;
    expect(extractFigmeta(html)).toEqual({
      fileKey: "spacedKey1",
      pasteID: 7,
      dataType: "scene",
    });
  });

  it("returns null for corrupted base64 inside the marker", () => {
    const html =
      '<span data-metadata="(figmeta)not-valid-base64!!!(/figmeta)"></span>';
    expect(extractFigmeta(html)).toBeNull();
  });

  it("returns null for valid base64 that isn't JSON", () => {
    const html = `<span data-metadata="(figmeta)${btoa("just some text")}(/figmeta)"></span>`;
    expect(extractFigmeta(html)).toBeNull();
  });

  it("returns null for JSON missing a fileKey", () => {
    const html = `<span data-metadata="(figmeta)${base64Json({ pasteID: 1 })}(/figmeta)"></span>`;
    expect(extractFigmeta(html)).toBeNull();
  });

  it("returns null when there is no figmeta marker or data-metadata attribute at all", () => {
    expect(extractFigmeta("<div>Just a normal paste</div>")).toBeNull();
  });

  it("returns null for empty/undefined/null input", () => {
    expect(extractFigmeta("")).toBeNull();
    expect(extractFigmeta(undefined)).toBeNull();
    expect(extractFigmeta(null)).toBeNull();
  });
});

describe("decideFigmaPasteStrategy", () => {
  const figmeta = { fileKey: "abcDEF12345" };

  it("is not-figma when there is no figmeta, regardless of key status", () => {
    expect(decideFigmaPasteStrategy(null, "configured")).toBe("not-figma");
    expect(decideFigmaPasteStrategy(null, "missing")).toBe("not-figma");
    expect(decideFigmaPasteStrategy(null, "unknown")).toBe("not-figma");
    expect(decideFigmaPasteStrategy(null)).toBe("not-figma");
  });

  it("attempts REST when figmeta is present and the key is configured", () => {
    expect(decideFigmaPasteStrategy(figmeta, "configured")).toBe("rest");
  });

  it("skips straight to the HTML fallback when the key is known-missing", () => {
    expect(decideFigmaPasteStrategy(figmeta, "missing")).toBe("html-fallback");
  });

  it("optimistically attempts REST when the key status isn't known client-side", () => {
    expect(decideFigmaPasteStrategy(figmeta, "unknown")).toBe("rest");
    expect(decideFigmaPasteStrategy(figmeta)).toBe("rest");
  });
});

describe("resolveFigmaPasteImportCall", () => {
  it("routes a figmeta-bearing paste to import-figma-clipboard", () => {
    const payload = { fileKey: "abcDEF12345", pasteID: 1 };
    const html = `<span data-metadata="(figmeta)${base64Json(payload)}(/figmeta)"></span><div>Hero</div>`;
    const call = resolveFigmaPasteImportCall(html);
    expect(call).toEqual({
      action: "import-figma-clipboard",
      payload: {
        figmetaFileKey: "abcDEF12345",
        clipboardHtml: html,
        originalName: "figma-paste.html",
      },
    });
  });

  it("routes a paste with no figmeta to the legacy import-design-source action", () => {
    const html = '<div data-buffer="(figma)">frame</div>';
    const call = resolveFigmaPasteImportCall(html, "custom-name.html");
    expect(call).toEqual({
      action: "import-design-source",
      payload: {
        sourceType: "figma-paste-html",
        content: html,
        originalName: "custom-name.html",
      },
    });
  });
});
