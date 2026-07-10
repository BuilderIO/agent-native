import { describe, expect, it } from "vitest";

import {
  decideFigmaPasteStrategy,
  extractSelectedNodeIds,
  extractFigmeta,
  MAX_FIGMA_CLIPBOARD_NODE_IDS,
  resolveFigmaPasteImportCall,
  stripFigmaBinaryClipboardBuffer,
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

  it("extracts exact single and multi-selection node ids from current Figma clipboard metadata", () => {
    const html = `<span data-metadata="<!--(figmeta)${base64Json({
      fileKey: "abcDEF12345",
      pasteID: 7,
      dataType: "scene",
      environment: "www.figma.com",
      selectedNodeData: "40:45|4|0,40:54|4|0",
    })}(/figmeta)-->"></span>`;
    expect(extractFigmeta(html)).toEqual({
      fileKey: "abcDEF12345",
      pasteID: 7,
      dataType: "scene",
      environment: "www.figma.com",
      selectedNodeData: "40:45|4|0,40:54|4|0",
      selectedNodeIds: ["40:45", "40:54"],
    });
  });

  it("ignores malformed selectedNodeData entries and de-duplicates ids", () => {
    expect(
      extractSelectedNodeIds("40:45|4|0,garbage,40:45|8|0, 9:3 |4|0"),
    ).toEqual(["40:45", "9:3"]);
  });

  it("caps exact selected node ids to the server's 100-id budget and marks truncation", () => {
    const selectedNodeData = Array.from(
      { length: MAX_FIGMA_CLIPBOARD_NODE_IDS + 2 },
      (_, index) => `40:${index + 1}|4|0`,
    ).join(",");
    const html = `<span data-metadata="(figmeta)${base64Json({
      fileKey: "abcDEF12345",
      selectedNodeData,
    })}(/figmeta)"></span>`;

    const result = extractFigmeta(html)!;
    expect(result.selectedNodeIds).toHaveLength(100);
    expect(result.selectedNodeIds?.[99]).toBe("40:100");
    expect(result.selectedNodeIdsTruncated).toBe(true);
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
    const payload = {
      fileKey: "abcDEF12345",
      pasteID: 1,
      selectedNodeData: "40:45|4|0,40:54|4|0",
    };
    const html = `<span data-metadata="(figmeta)${base64Json(payload)}(/figmeta)"></span><div>Hero</div>`;
    const call = resolveFigmaPasteImportCall(html);
    expect(call).toEqual({
      action: "import-figma-clipboard",
      payload: {
        figmetaFileKey: "abcDEF12345",
        selectedNodeIds: ["40:45", "40:54"],
        clipboardHtml: html,
        originalName: "figma-paste.html",
      },
    });
  });

  it("strips Figma's large private binary buffer for exact-id imports while preserving figmeta and visible fallback HTML", () => {
    const metadata = `(figmeta)${base64Json({
      fileKey: "abcDEF12345",
      selectedNodeData: "40:45|4|0",
    })}(/figmeta)`;
    const html = [
      `<span data-metadata="${metadata}"></span>`,
      `<span data-buffer="<!--(figma)${"a".repeat(100_000)}(/figma)-->"></span>`,
      "<div>Visible frame fallback</div>",
    ].join("");

    const call = resolveFigmaPasteImportCall(html);
    expect(call.action).toBe("import-figma-clipboard");
    if (call.action !== "import-figma-clipboard") return;
    expect(call.payload.clipboardHtml).toContain(metadata);
    expect(call.payload.clipboardHtml).toContain("Visible frame fallback");
    expect(call.payload.clipboardHtml).not.toContain("data-buffer");
    expect(call.payload.clipboardHtml.length).toBeLessThan(1_000);
  });

  it("retains the original clipboard when exact ids are unavailable for legacy matching", () => {
    const html = `<span data-metadata="(figmeta)${base64Json({
      fileKey: "abcDEF12345",
    })}(/figmeta)"></span><div>Legacy fallback</div>`;
    const call = resolveFigmaPasteImportCall(html);
    expect(call.action).toBe("import-figma-clipboard");
    if (call.action !== "import-figma-clipboard") return;
    expect(call.payload.clipboardHtml).toBe(html);
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

describe("stripFigmaBinaryClipboardBuffer", () => {
  it("removes raw and escaped private figma buffers without stripping figmeta", () => {
    const html = [
      "<!--(figmeta)metadata(/figmeta)-->",
      "<!--(figma)private-one(/figma)-->",
      "&lt;!--(figma)private-two(/figma)--&gt;",
      "<div>Visible</div>",
    ].join("");
    expect(stripFigmaBinaryClipboardBuffer(html)).toBe(
      "<!--(figmeta)metadata(/figmeta)--><div>Visible</div>",
    );
  });
});
