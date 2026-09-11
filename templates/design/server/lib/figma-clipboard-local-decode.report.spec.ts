/**
 * The clipboard decoder's fidelity report must survive the boundary.
 *
 * The walker already recorded what it could not draw, but the decoder returned
 * only the image warning — so a paste that silently lost visible content came
 * back reading as "everything else was fine". Positivus' three testimonial
 * bubbles are boolean operations whose outline Figma flattens only for REST;
 * pasted, their green border simply is not drawn.
 */
import { describe, expect, it, vi } from "vitest";

const renderHtmlTemplates = vi.fn();
vi.mock("./fig-file-to-html.js", () => ({ renderHtmlTemplates }));
vi.mock("./fig-file-decoder.js", () => ({
  decodeFig: () => ({
    document: { nodeChanges: [] },
    format: "kiwi",
    version: 106,
  }),
  assertSafeDecodedFigDocument: () => {},
}));

const { importFigmaClipboardFromBuffer } =
  await import("./figma-clipboard-local-decode.js");

function renderResult(approximatedNodes: unknown[]) {
  return {
    frames: [
      {
        html: "<div></div>",
        fileName: "a.html",
        frameName: "A",
        width: 10,
        height: 10,
      },
    ],
    unresolvedImageRefs: new Set<string>(),
    approximatedNodes,
  };
}

describe("clipboard decode surfaces the walker's fidelity report", () => {
  it("reports what the walker could not draw, not just missing images", async () => {
    renderHtmlTemplates.mockReturnValue(
      renderResult([
        {
          nodeId: "1:1",
          nodeName: "Bubble",
          nodeType: "BOOLEAN_OPERATION",
          notes: ["no decodable geometry"],
        },
      ]),
    );
    const result = await importFigmaClipboardFromBuffer({
      bufferBase64: Buffer.from("x").toString("base64"),
      fileKey: "k",
    });
    expect(result.warnings.join(" ")).toContain("no decodable geometry");
  });

  it("counts repeats rather than listing every node", async () => {
    renderHtmlTemplates.mockReturnValue(
      renderResult(
        Array.from({ length: 3 }, (_, i) => ({
          nodeId: `1:${i}`,
          nodeName: "Bubble",
          nodeType: "BOOLEAN_OPERATION",
          notes: ["no decodable geometry"],
        })),
      ),
    );
    const result = await importFigmaClipboardFromBuffer({
      bufferBase64: Buffer.from("x").toString("base64"),
      fileKey: "k",
    });
    expect(result.warnings.some((w) => w.startsWith("3 nodes:"))).toBe(true);
    expect(
      result.warnings.filter((w) => w.includes("no decodable geometry")),
    ).toHaveLength(1);
  });

  it("says nothing extra when the walker drew everything", async () => {
    renderHtmlTemplates.mockReturnValue(renderResult([]));
    const result = await importFigmaClipboardFromBuffer({
      bufferBase64: Buffer.from("x").toString("base64"),
      fileKey: "k",
    });
    expect(result.warnings).toEqual([]);
  });
});
