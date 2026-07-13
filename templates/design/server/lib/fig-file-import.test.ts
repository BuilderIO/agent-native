import * as zlib from "node:zlib";

import {
  ByteBuffer,
  compileSchema,
  encodeBinarySchema,
  parseSchema,
} from "kiwi-schema";
import { describe, expect, it, vi } from "vitest";

import {
  assertSafeDecodedFigDocument,
  decodeFig,
  decodeKiwiContainer,
} from "./fig-file-decoder.js";
import {
  convertDecodedFigToEditableHtml,
  importFigFileToEditableHtml,
} from "./fig-file-import.js";
import { renderHtmlTemplates } from "./fig-file-to-html.js";

function kiwiContainer(chunks: Buffer[], version = 124): Buffer {
  const header = Buffer.alloc(12);
  header.write("fig-kiwi", 0, "utf8");
  header.writeUInt32LE(version, 8);
  return Buffer.concat([
    header,
    ...chunks.flatMap((chunk) => {
      const compressed = zlib.deflateRawSync(chunk);
      const length = Buffer.alloc(4);
      length.writeUInt32LE(compressed.length);
      return [length, compressed];
    }),
  ]);
}

function encodedHelloFig(): Buffer {
  const schema = parseSchema("message Message { string hello = 1; }");
  const compiled = compileSchema(schema) as {
    encodeMessage(value: { hello: string }): Uint8Array;
  };
  return kiwiContainer([
    Buffer.from(encodeBinarySchema(schema)),
    Buffer.from(compiled.encodeMessage({ hello: "world" })),
  ]);
}

function editableDocument(imageHash?: string) {
  return {
    nodeChanges: [
      { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
      {
        guid: { sessionID: 1, localID: 2 },
        parentIndex: {
          guid: { sessionID: 1, localID: 1 },
          position: "a",
        },
        type: "CANVAS",
        name: "Page 1",
      },
      {
        guid: { sessionID: 1, localID: 3 },
        parentIndex: {
          guid: { sessionID: 1, localID: 2 },
          position: "a",
        },
        type: "FRAME",
        name: "Card",
        size: { x: 320, y: 200 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        fillPaints: imageHash
          ? [{ type: "IMAGE", image: { hash: imageHash } }]
          : [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      },
      {
        guid: { sessionID: 1, localID: 4 },
        parentIndex: {
          guid: { sessionID: 1, localID: 3 },
          position: "a",
        },
        type: "TEXT",
        name: "Title",
        size: { x: 120, y: 24 },
        transform: {
          m00: 1,
          m01: 0,
          m02: 10,
          m10: 0,
          m11: 1,
          m12: 12,
        },
        fontSize: 16,
        textData: { characters: "Editable title" },
      },
    ],
  };
}

describe("bounded .fig decoding", () => {
  it("decodes a valid compressed fig-kiwi schema and document", () => {
    const decoded = decodeFig(encodedHelloFig());

    expect(decoded.format).toBe("kiwi");
    expect(decoded.version).toBe(124);
    expect(decoded.document).toEqual({ hello: "world" });
  });

  it("rejects malformed and over-complex containers before rendering", () => {
    expect(() => decodeFig(Buffer.from("not-a-fig"))).toThrow(/fig-kiwi/i);

    const chunks = Array.from({ length: 4_097 }, () => Buffer.alloc(0));
    const header = Buffer.alloc(12);
    header.write("fig-kiwi", 0, "utf8");
    const uncompressedContainer = Buffer.concat([
      header,
      ...chunks.flatMap((chunk) => {
        const length = Buffer.alloc(4);
        length.writeUInt32LE(chunk.length);
        return [length, chunk];
      }),
    ]);
    expect(() => decodeKiwiContainer(uncompressedContainer)).toThrow(
      /too many binary chunks/i,
    );
  });

  it("does not compile schema names that could escape kiwi code generation", async () => {
    const unsafeSchema = parseSchema(
      "message Message { string value = 1; } message Safe { string ok = 1; }",
    );
    unsafeSchema.definitions[1]!.name = "Bad-name";
    const compiled = compileSchema(
      parseSchema("message Message { string value = 1; }"),
    ) as { encodeMessage(value: { value: string }): Uint8Array };
    const fig = kiwiContainer([
      Buffer.from(encodeBinarySchema(unsafeSchema)),
      Buffer.from(compiled.encodeMessage({ value: "ignored" })),
    ]);

    await expect(
      importFigFileToEditableHtml({
        data: fig,
        originalName: "unsafe.fig",
        ownerEmail: "example@example.com",
      }),
    ).rejects.toThrow(/could not be decoded/i);
  });

  it("rejects hostile schema field counts before kiwi-schema loops over them", () => {
    const hostileSchema = Buffer.concat([
      Buffer.from([1]),
      Buffer.from("Message\0", "utf8"),
      Buffer.from([2, 0x88, 0x10]), // MESSAGE with 2,056 fields (cap is 1,024)
    ]);
    const decoded = decodeFig(kiwiContainer([hostileSchema, Buffer.from([0])]));

    expect(decoded.document).toBeNull();
  });

  it("accepts current Figma schemas whose NodeChange message has 600 fields", () => {
    const fields = Array.from(
      { length: 600 },
      (_, index) => `string field${index} = ${index + 1};`,
    ).join(" ");
    const schema = parseSchema(
      `message NodeChange { ${fields} } message Message { NodeChange[] nodeChanges = 1; }`,
    );
    const compiled = compileSchema(schema) as {
      encodeMessage(value: {
        nodeChanges: Array<{ field0: string }>;
      }): Uint8Array;
    };
    const fig = kiwiContainer([
      Buffer.from(encodeBinarySchema(schema)),
      Buffer.from(
        compiled.encodeMessage({ nodeChanges: [{ field0: "current" }] }),
      ),
    ]);

    expect(decodeFig(fig).document).toEqual({
      nodeChanges: [{ field0: "current" }],
    });
  });

  it("rejects hostile repeated-array lengths before generated code allocates them", () => {
    const schema = parseSchema("message Message { string[] values = 1; }");
    const document = new ByteBuffer();
    document.writeVarUint(1);
    document.writeVarUint(10_000_000);
    const fig = kiwiContainer([
      Buffer.from(encodeBinarySchema(schema)),
      Buffer.from(document.toUint8Array()),
    ]);

    expect(decodeFig(fig).document).toBeNull();
  });

  it("rejects recursive messages beyond the decode-depth budget", () => {
    const schema = parseSchema(
      "message Link { Link child = 1; } message Message { Link root = 1; }",
    );
    const bytes = new ByteBuffer();
    bytes.writeVarUint(1);
    for (let index = 0; index < 300; index += 1) bytes.writeVarUint(1);
    bytes.writeVarUint(0);
    for (let index = 0; index < 300; index += 1) bytes.writeVarUint(0);
    bytes.writeVarUint(0);
    const fig = kiwiContainer([
      Buffer.from(encodeBinarySchema(schema)),
      Buffer.from(bytes.toUint8Array()),
    ]);

    expect(decodeFig(fig).document).toBeNull();
  });
});

describe("editable .fig conversion", () => {
  it("converts pages and frames into editable HTML screens with geometry", async () => {
    const result = await convertDecodedFigToEditableHtml(
      {
        format: "kiwi",
        version: 124,
        document: editableDocument(),
        images: [],
        thumbnail: null,
      },
      {
        originalName: "sample.fig",
        ownerEmail: "example@example.com",
        uploader: vi.fn(),
      },
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      filename: "Page 1-Card.html",
      fileType: "html",
      preferredFrame: { title: "Card", width: 320, height: 200 },
    });
    expect(result.files[0]!.content).toContain("Editable title");
    expect(result.files[0]!.content).toContain('layer-name="Card"');
    expect(result.files[0]!.content).not.toMatch(/data:[^;]+;base64/i);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toMatchObject({
      frameCount: 1,
      nodeCount: 4,
      uploadedImageCount: 0,
      omittedImageCount: 0,
    });
  });

  it("uploads embedded images through file storage and persists only the URL", async () => {
    const uploader = vi.fn().mockResolvedValue({
      url: "https://assets.example.com/figma-image.png",
      provider: "example",
    });
    const result = await convertDecodedFigToEditableHtml(
      {
        format: "kiwi",
        document: editableDocument("abc123"),
        images: [
          {
            hash: "abc123",
            ext: "png",
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          },
        ],
        thumbnail: null,
      },
      {
        originalName: "image.fig",
        ownerEmail: "example@example.com",
        uploader,
      },
    );

    expect(uploader).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "example@example.com",
        mimeType: "image/png",
        recordAsset: false,
      }),
    );
    expect(result.files[0]!.content).toContain(
      "https://assets.example.com/figma-image.png",
    );
    expect(result.files[0]!.content).not.toContain("iVBOR");
    expect(result.stats.uploadedImageCount).toBe(1);
  });

  it("omits image bytes safely and reports the degradation when storage is unavailable", async () => {
    const result = await convertDecodedFigToEditableHtml(
      {
        format: "kiwi",
        document: editableDocument("abc123"),
        images: [
          {
            hash: "abc123",
            ext: "png",
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          },
        ],
        thumbnail: null,
      },
      {
        originalName: "no-storage.fig",
        ownerEmail: "example@example.com",
        uploader: vi.fn().mockResolvedValue(null),
      },
    );

    expect(result.files[0]!.content).toContain("about:blank");
    expect(result.files[0]!.content).not.toMatch(/data:[^;]+;base64/i);
    expect(result.warnings).toContainEqual(expect.stringMatching(/omitted/i));
    expect(result.warnings.join(" ")).not.toMatch(/proprietary/i);
    expect(result.stats.omittedImageCount).toBe(1);
  });

  it("validates renderable frames before uploading any extracted blobs", async () => {
    const uploader = vi.fn();

    await expect(
      convertDecodedFigToEditableHtml(
        {
          format: "kiwi",
          document: { nodeChanges: [] },
          images: [
            {
              hash: "abc123",
              ext: "png",
              bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            },
          ],
          thumbnail: null,
        },
        {
          originalName: "empty.fig",
          ownerEmail: "example@example.com",
          uploader,
        },
      ),
    ).rejects.toThrow(/no editable top-level frames/i);
    expect(uploader).not.toHaveBeenCalled();
  });

  it("rejects deeply nested direct documents before renderer recursion", () => {
    const root: Record<string, unknown> = {};
    let current = root;
    for (let index = 0; index < 300; index += 1) {
      const child: Record<string, unknown> = {};
      current.child = child;
      current = child;
    }

    expect(() => assertSafeDecodedFigDocument(root)).toThrow(
      /nested too deeply/i,
    );
  });

  it("caps renderer expansion and output before large results accumulate", () => {
    expect(() =>
      renderHtmlTemplates(editableDocument(), { maxRenderedNodes: 1 }),
    ).toThrow(/expanded-node budget/i);

    const document = editableDocument();
    document.nodeChanges[3]!.textData = { characters: "x".repeat(2_000) };
    expect(() =>
      renderHtmlTemplates(document, { maxFrameOutputBytes: 200 }),
    ).toThrow(/render output budget/i);
  });

  it("uploads embedded images with bounded concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const uploader = vi.fn(async ({ filename }: { filename?: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        url: `https://assets.example.com/${filename}`,
        provider: "example",
      };
    });
    const images = Array.from({ length: 9 }, (_, index) => ({
      hash: `hash${index}`,
      ext: "png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, index]),
    }));

    const result = await convertDecodedFigToEditableHtml(
      {
        format: "kiwi",
        document: editableDocument(),
        images,
        thumbnail: null,
      },
      {
        originalName: "images.fig",
        ownerEmail: "example@example.com",
        uploader: uploader as never,
      },
    );

    expect(result.stats.uploadedImageCount).toBe(9);
    expect(maxActive).toBe(4);
  });

  it("rejects aggregate embedded-image bytes before any upload", async () => {
    const uploader = vi.fn();
    await expect(
      convertDecodedFigToEditableHtml(
        {
          format: "kiwi",
          document: editableDocument(),
          images: [
            {
              hash: "oversized",
              ext: "png",
              bytes: {
                byteLength: 64 * 1024 * 1024 + 1,
              } as unknown as Buffer,
            },
          ],
          thumbnail: null,
        },
        {
          originalName: "oversized-images.fig",
          ownerEmail: "example@example.com",
          uploader,
        },
      ),
    ).rejects.toThrow(/too much embedded image data/i);
    expect(uploader).not.toHaveBeenCalled();
  });
});
