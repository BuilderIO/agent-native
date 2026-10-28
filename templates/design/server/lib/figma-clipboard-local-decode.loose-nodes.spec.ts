import { describe, expect, it, vi } from "vitest";

const decoded = vi.hoisted(() => ({ document: {} as unknown }));
vi.mock("./fig-file-decoder.js", () => ({
  decodeFig: () => ({
    document: decoded.document,
    format: "kiwi",
    version: 106,
  }),
  assertSafeDecodedFigDocument: () => {},
}));

const { importFigmaClipboardFromBuffer } =
  await import("./figma-clipboard-local-decode.js");

const identity = { m00: 1, m01: 0, m10: 0, m11: 1 };
const page = { sessionID: 0, localID: 1 };

function clipboard(node: Record<string, unknown>, pasteOffset?: object) {
  return {
    ...(pasteOffset ? { pasteOffset } : {}),
    nodeChanges: [
      {
        guid: { sessionID: 0, localID: 0 },
        type: "DOCUMENT",
        name: "Document",
      },
      {
        guid: page,
        type: "CANVAS",
        name: "Page 1",
        parentIndex: { guid: { sessionID: 0, localID: 0 }, position: "!" },
      },
      { parentIndex: { guid: page, position: "!" }, ...node },
    ],
  };
}

async function decode() {
  return importFigmaClipboardFromBuffer({
    bufferBase64: Buffer.from("x").toString("base64"),
    fileKey: "k",
  });
}

describe("a Figma copy of a single non-frame layer", () => {
  it("renders the layer at its own size instead of refusing the paste", async () => {
    decoded.document = clipboard(
      {
        guid: { sessionID: 7, localID: 1 },
        type: "RECTANGLE",
        name: "Badge",
        size: { x: 30, y: 12 },
        transform: { ...identity, m02: 2902, m12: 608 },
        fillPaints: [
          { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true },
        ],
      },
      { x: 2040, y: 133 },
    );

    const result = await decode();

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.preferredFrame).toMatchObject({
      title: "Badge",
      width: 30,
      height: 12,
    });
    expect(result.files[0]!.content).toContain('data-figma-node-id="7:1"');
    expect(result.layers).toEqual([
      {
        wrapsLooseNode: true,
        origin: { x: 2902, y: 608 },
        sourceOffset: { x: 862, y: 475 },
      },
    ]);
  });

  it("keeps a copied frame as the root and has no offset without an enclosing frame", async () => {
    decoded.document = clipboard({
      guid: { sessionID: 7, localID: 2 },
      type: "FRAME",
      name: "Icon",
      size: { x: 24, y: 24 },
      transform: { ...identity, m02: 4304, m12: 1319 },
      fillPaints: [
        { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, visible: false },
      ],
    });

    const result = await decode();

    expect(result.layers).toEqual([
      {
        wrapsLooseNode: false,
        origin: { x: 4304, y: 1319 },
        sourceOffset: null,
      },
    ]);
    expect(result.files[0]!.content).not.toMatch(
      /background(?:-color)?:\s*(?:#fff|rgb\(255, 255, 255\))/i,
    );
  });
});
