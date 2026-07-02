import { describe, expect, it } from "vitest";

import {
  looksLikeFigmaClipboardHtml,
  parseFigmaClipboardHtml,
} from "./clipboard.js";

function b64(value: string | Buffer) {
  return Buffer.from(value).toString("base64");
}

describe("parseFigmaClipboardHtml", () => {
  it("extracts figmeta, selected node id, buffer, and fallback HTML", () => {
    const meta = {
      fileKey: "abc123",
      pasteID: 42,
      dataType: "figma",
      environment: "production",
      selectedNodeData: "1:2|Hero",
    };
    const buffer = Buffer.concat([
      Buffer.from("fig-kiwi\0", "utf8"),
      Buffer.alloc(8),
    ]);
    const html = `<span data-metadata="<!--(figmeta)${b64(
      JSON.stringify(meta),
    )}(/figmeta)-->"></span><span data-buffer="<!--(figma)${b64(
      buffer,
    )}(/figma)-->"></span><div>Visible fallback</div>`;

    const parsed = parseFigmaClipboardHtml(html);

    expect(parsed.meta).toMatchObject({
      fileKey: "abc123",
      pasteID: 42,
      dataType: "figma",
      environment: "production",
      selectedNodeData: "1:2|Hero",
      selectedNodeId: "1:2",
    });
    expect(parsed.hasFigmaBuffer).toBe(true);
    expect(parsed.buffer?.subarray(0, 8).toString("utf8")).toBe("fig-kiwi");
    expect(parsed.fallbackHtml).toBe("<div>Visible fallback</div>");
  });

  it("rejects malformed base64", () => {
    expect(() =>
      parseFigmaClipboardHtml(
        '<span data-metadata="<!--(figmeta)not base64!(/figmeta)-->"></span>',
      ),
    ).toThrow(/base64/i);
  });

  it("supports non-Figma visible HTML fallback", () => {
    const html = "<section>Standalone markup</section>";

    expect(looksLikeFigmaClipboardHtml(html)).toBe(false);
    expect(parseFigmaClipboardHtml(html)).toMatchObject({
      meta: null,
      hasFigmaBuffer: false,
      fallbackHtml: html,
    });
  });
});
