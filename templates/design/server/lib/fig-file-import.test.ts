import { randomBytes } from "node:crypto";
import * as zlib from "node:zlib";

import {
  ByteBuffer,
  compileSchema,
  encodeBinarySchema,
  parseSchema,
} from "kiwi-schema";
import { describe, expect, it, vi } from "vitest";

const fileUploadMocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  deleteUploadedFile: vi.fn(),
}));

vi.mock("@agent-native/core/file-upload", () => fileUploadMocks);

import { buildCodeLayerProjection } from "../../shared/code-layer.js";
import {
  convertDecodedFigToEditableHtml as convertShared,
  inspectDecodedFig,
  shouldWarnForFigImport,
} from "../../shared/fig-to-frames.js";
import {
  assertSafeDecodedFigDocument,
  decodeFig,
  decodeKiwiContainer,
} from "./fig-file-decoder.js";
import {
  convertDecodedFigToEditableHtml,
  importFigFileToEditableHtml,
} from "./fig-file-import.js";
import {
  collectTopLevelFrames,
  renderHtmlTemplates,
  type FigNode,
} from "./fig-file-to-html.js";

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

function encodedHelloFig(extraChunks: Buffer[] = []): Buffer {
  const schema = parseSchema("message Message { string hello = 1; }");
  const compiled = compileSchema(schema) as {
    encodeMessage(value: { hello: string }): Uint8Array;
  };
  return kiwiContainer([
    Buffer.from(encodeBinarySchema(schema)),
    Buffer.from(compiled.encodeMessage({ hello: "world" })),
    ...extraChunks,
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

function twoFrameEditableDocument() {
  const document = editableDocument();
  return {
    nodeChanges: [
      ...document.nodeChanges,
      {
        guid: { sessionID: 1, localID: 5 },
        parentIndex: {
          guid: { sessionID: 1, localID: 2 },
          position: "b",
        },
        type: "FRAME",
        name: "Banner",
        size: { x: 640, y: 120 },
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 220 },
        fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
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

  it("keeps bounded binary fields as bytes while direct strings stay bounded", () => {
    const fieldNames = ["blob"];
    const schema = parseSchema(
      `message Message { ${fieldNames.map((name, index) => `byte[] ${name} = ${index + 1};`).join(" ")} }`,
    );
    const compiled = compileSchema(schema) as {
      encodeMessage(value: Record<string, Uint8Array>): Uint8Array;
    };
    const blob = new Uint8Array(3 * 1024 * 1024);
    const document = Object.fromEntries(
      fieldNames.map((name) => [name, blob]),
    ) as Record<string, Uint8Array>;
    const decoded = decodeFig(
      kiwiContainer([
        Buffer.from(encodeBinarySchema(schema)),
        Buffer.from(compiled.encodeMessage(document)),
      ]),
    );

    expect((decoded.document as { blob: unknown }).blob).toBeInstanceOf(
      Uint8Array,
    );
    expect(() => assertSafeDecodedFigDocument(decoded.document)).not.toThrow();
    expect(() =>
      assertSafeDecodedFigDocument({
        blobs: [{ bytes: "00".repeat(3 * 1024 * 1024) }],
      }),
    ).toThrow(/too much string data/i);
  });

  it("counts bigint serialization against the decoded string budget", () => {
    const schema = parseSchema("message Message { uint64[] values = 1; }");
    const compiled = compileSchema(schema) as {
      encodeMessage(value: { values: bigint[] }): Uint8Array;
    };
    const values = new Array(1_700_000).fill(18_446_744_073_709_551_615n);
    const decoded = decodeFig(
      kiwiContainer([
        Buffer.from(encodeBinarySchema(schema)),
        Buffer.from(compiled.encodeMessage({ values })),
      ]),
    );

    expect(decoded.document).toBeNull();
    expect(decoded.decodeError).toMatch(/too much string data/i);
  });

  it("lets browser-local decoding skip only the raw upload ceiling", () => {
    const fig = encodedHelloFig();

    expect(() => decodeFig(fig, { maxFileBytes: fig.byteLength - 1 })).toThrow(
      /too large/,
    );
    expect(decodeFig(fig, { maxFileBytes: null }).document).toEqual({
      hello: "world",
    });
  });

  it("decodes valid browser-local containers above the server upload ceiling", () => {
    const fig = encodedHelloFig([
      randomBytes(25 * 1024 * 1024),
      randomBytes(25 * 1024 * 1024),
    ]);

    expect(fig.byteLength).toBeGreaterThan(50 * 1024 * 1024);
    expect(() => decodeFig(fig)).toThrow(/too large/);
    expect(decodeFig(fig, { maxFileBytes: null }).document).toEqual({
      hello: "world",
    });
  }, 30_000);

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
    // Building/decoding the 4k-chunk container is CPU-heavy and synchronous, so
    // it can exceed the 5s default under a loaded parallel test run.
  }, 20_000);

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

  it("rejects schemas with unsafe identifier names before kiwi code generation", () => {
    const unsafeSchema = parseSchema("message Message { string value = 1; }");
    unsafeSchema.definitions[0]!.name = "Bad-name";
    const decoded = decodeFig(
      kiwiContainer([
        Buffer.from(encodeBinarySchema(unsafeSchema)),
        Buffer.from([0]),
      ]),
    );

    expect(decoded.document).toBeNull();
  });

  it("accepts current Figma schemas whose NodeChange message has 2000 fields", () => {
    const fields = Array.from(
      { length: 2000 },
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
    expect(result.files[0]!.content).toContain(
      'data-agent-native-layer-name="Card"',
    );
    expect(result.files[0]!.content).toContain(
      'data-agent-native-layer-name="Title"',
    );
    expect(result.files[0]!.content).not.toMatch(/\s+layer-name\s*=/);
    const projection = buildCodeLayerProjection(result.files[0]!.content, {
      source: { kind: "design-file", fileId: "fig-import" },
    });
    expect(
      projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-layer-name"] === "Card",
      ),
    ).toMatchObject({
      layerName: "Card",
      layerNameAttribute: "data-agent-native-layer-name",
    });
    expect(
      projection.nodes.find(
        (node) =>
          node.dataAttributes["data-agent-native-layer-name"] === "Title",
      ),
    ).toMatchObject({
      layerName: "Title",
      layerNameAttribute: "data-agent-native-layer-name",
    });
    expect(result.files[0]!.content).not.toMatch(/data:[^;]+;base64/i);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toMatchObject({
      frameCount: 1,
      nodeCount: 4,
      uploadedImageCount: 0,
      omittedImageCount: 0,
    });
  });

  it("keeps a frame-child at its parent-relative offset, ignoring the frame's canvas position", () => {
    const document = editableDocument();
    document.nodeChanges[2]!.transform = {
      m00: 1,
      m01: 0,
      m02: 800,
      m10: 0,
      m11: 1,
      m12: 800,
    };
    document.nodeChanges[3]!.transform = {
      m00: 1,
      m01: 0,
      m02: 26.1875,
      m10: 0,
      m11: 1,
      m12: 0,
    };

    const rendered = renderHtmlTemplates(document);

    expect(rendered.frames[0]!.html).toContain("left: 26.19px");
    expect(rendered.frames[0]!.html).toContain("top: 0px");
    expect(rendered.frames[0]!.html).not.toContain("left: 826.19px");
    expect(rendered.frames[0]!.html).not.toContain("left: -773");
  });

  it("preserves nested coordinates after normalizing the frame boundary", () => {
    const document = {
      nodeChanges: [
        { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT", name: "Doc" },
        {
          guid: { sessionID: 1, localID: 2 },
          parentIndex: {
            guid: { sessionID: 1, localID: 1 },
            position: "a",
          },
          type: "CANVAS",
          name: "Page",
        },
        {
          guid: { sessionID: 1, localID: 3 },
          parentIndex: {
            guid: { sessionID: 1, localID: 2 },
            position: "a",
          },
          type: "FRAME",
          name: "Offset frame",
          size: { x: 800, y: 800 },
          transform: {
            m00: 1,
            m01: 0,
            m02: 800,
            m10: 0,
            m11: 1,
            m12: 800,
          },
        },
        {
          guid: { sessionID: 1, localID: 4 },
          parentIndex: {
            guid: { sessionID: 1, localID: 3 },
            position: "a",
          },
          type: "FRAME",
          name: "Image wrapper",
          size: { x: 200, y: 100 },
          transform: {
            m00: 1,
            m01: 0,
            m02: 26,
            m10: 0,
            m11: 1,
            m12: 0,
          },
        },
        {
          guid: { sessionID: 1, localID: 5 },
          parentIndex: {
            guid: { sessionID: 1, localID: 4 },
            position: "a",
          },
          type: "TEXT",
          name: "Nested title",
          size: { x: 100, y: 20 },
          transform: {
            m00: 1,
            m01: 0,
            m02: 10,
            m10: 0,
            m11: 1,
            m12: 20,
          },
          textData: { characters: "Nested" },
        },
      ],
    };

    const rendered = renderHtmlTemplates(document);

    expect(rendered.frames[0]!.html).toContain("left: 26px; top: 0px");
    expect(rendered.frames[0]!.html).toContain("left: 10px; top: 20px");
  });

  it("sorts section frames by their full accumulated affine transform", () => {
    const guid = (localID: number) => ({ sessionID: 1, localID });
    const transform = (
      m00: number,
      m01: number,
      m02: number,
      m10: number,
      m11: number,
      m12: number,
    ) => ({
      m00,
      m01,
      m02,
      m10,
      m11,
      m12,
    });
    const page: FigNode = { guid: guid(1), type: "CANVAS" };
    const rotatedSection: FigNode = {
      guid: guid(2),
      type: "SECTION",
      transform: transform(0, -1, 100, 1, 0, 0),
    };
    const rotatedFrame: FigNode = {
      guid: guid(3),
      type: "FRAME",
      name: "Rotated section frame",
      transform: transform(1, 0, 0, 0, 1, 200),
    };
    const rightSection: FigNode = {
      guid: guid(4),
      type: "SECTION",
      transform: transform(1, 0, -50, 0, 1, 0),
    };
    const rightFrame: FigNode = {
      guid: guid(5),
      type: "FRAME",
      name: "Right frame",
      transform: transform(1, 0, 0, 0, 1, 0),
    };
    const childrenOf = new Map<string, FigNode[]>([
      ["1:1", [rotatedSection, rightSection]],
      ["1:2", [rotatedFrame]],
      ["1:4", [rightFrame]],
    ]);

    expect(
      collectTopLevelFrames(page, childrenOf).map((frame) => frame.name),
    ).toEqual(["Rotated section frame", "Right frame"]);
  });

  it("sorts transformed frames by their rendered bounds, not just their origin", () => {
    const guid = (localID: number) => ({ sessionID: 1, localID });
    const page: FigNode = { guid: guid(1), type: "CANVAS" };
    const rotatedSection: FigNode = {
      guid: guid(2),
      type: "SECTION",
      transform: {
        m00: 0,
        m01: -1,
        m02: 100,
        m10: 1,
        m11: 0,
        m12: 0,
      },
    };
    const rotatedFrame: FigNode = {
      guid: guid(3),
      type: "FRAME",
      name: "Rotated bounds frame",
      size: { x: 20, y: 300 },
    };
    const rightFrame: FigNode = {
      guid: guid(4),
      type: "FRAME",
      name: "Right frame",
      size: { x: 20, y: 20 },
    };
    const childrenOf = new Map<string, FigNode[]>([
      ["1:1", [rotatedSection, rightFrame]],
      ["1:2", [rotatedFrame]],
    ]);

    expect(
      collectTopLevelFrames(page, childrenOf).map((frame) => frame.name),
    ).toEqual(["Rotated bounds frame", "Right frame"]);
  });

  it("imports all frames from the uploaded file", async () => {
    const result = await convertDecodedFigToEditableHtml(
      {
        format: "kiwi",
        document: twoFrameEditableDocument(),
        images: [],
        thumbnail: null,
      },
      {
        originalName: "all-frames.fig",
        ownerEmail: "example@example.com",
        uploader: vi.fn(),
      },
    );

    expect(result.files).toHaveLength(2);
  });

  it("imports files with more than 200 top-level frames", () => {
    const nodes: FigNode[] = [
      { guid: { sessionID: 1, localID: 1 }, type: "DOCUMENT" },
      {
        guid: { sessionID: 1, localID: 2 },
        parentIndex: {
          guid: { sessionID: 1, localID: 1 },
          position: "a",
        },
        type: "CANVAS",
        name: "Page 1",
      },
      ...Array.from({ length: 201 }, (_, index) => ({
        guid: { sessionID: 1, localID: index + 3 },
        parentIndex: {
          guid: { sessionID: 1, localID: 2 },
          position: String(index).padStart(3, "0"),
        },
        type: "FRAME",
        name: `Frame ${index + 1}`,
        size: { x: 320, y: 200 },
        transform: {
          m00: 1,
          m01: 0,
          m02: index * 320,
          m10: 0,
          m11: 1,
          m12: 0,
        },
      })),
    ];

    expect(renderHtmlTemplates({ nodeChanges: nodes }).frames).toHaveLength(
      201,
    );

    const tooManyNodes = [
      ...nodes,
      ...Array.from({ length: 100 }, (_, index) => ({
        guid: { sessionID: 1, localID: index + 204 },
        parentIndex: {
          guid: { sessionID: 1, localID: 2 },
          position: String(index + 201).padStart(3, "0"),
        },
        type: "FRAME",
        name: `Frame ${index + 202}`,
        size: { x: 320, y: 200 },
        transform: {
          m00: 1,
          m01: 0,
          m02: (index + 201) * 320,
          m10: 0,
          m11: 1,
          m12: 0,
        },
      })),
    ];
    expect(() => renderHtmlTemplates({ nodeChanges: tooManyNodes })).toThrow(
      /max 300/i,
    );
  });

  it("summarizes the document and warns before an oversized import", () => {
    const decoded = {
      format: "kiwi" as const,
      document: twoFrameEditableDocument(),
      images: [],
      thumbnail: null,
    };

    const summary = inspectDecodedFig(decoded);

    expect(summary).toMatchObject({
      pageCount: 1,
      frameCount: 2,
      nodeCount: 5,
      imageCount: 0,
    });
    expect(summary.frames.map((frame) => frame.frameName)).toEqual([
      "Card",
      "Banner",
    ]);
    expect(shouldWarnForFigImport(1024, summary)).toBe(false);
    expect(shouldWarnForFigImport(10 * 1024 * 1024, summary)).toBe(true);
  });

  it("renders and uploads only selected frames and their images", async () => {
    const document = twoFrameEditableDocument();
    const card = document.nodeChanges[2]! as {
      fillPaints?: unknown[];
    };
    card.fillPaints = [{ type: "IMAGE", image: { hash: "image-a" } }];
    const banner = document.nodeChanges[4]! as {
      fillPaints?: unknown[];
    };
    banner.fillPaints = [{ type: "IMAGE", image: { hash: "image-b" } }];
    const uploader = vi.fn().mockResolvedValue({
      url: "https://assets.example.com/selected.png",
    });

    const result = await convertShared(
      {
        format: "kiwi",
        document,
        images: [
          { hash: "image-a", ext: "png", bytes: Buffer.from([1, 2, 3]) },
          { hash: "image-b", ext: "png", bytes: Buffer.from([4, 5, 6]) },
        ],
        thumbnail: null,
      },
      {
        originalName: "selected.fig",
        ownerEmail: "example@example.com",
        normalizeHtml: (content) => content,
        selection: new Set(["1:3"]),
        uploader,
      },
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.preferredFrame?.title).toBe("Card");
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(uploader).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "figma-image-a.png" }),
    );
    expect(result.stats.uploadedImageCount).toBe(1);
  });

  it("renders a selected frame nested inside a section", () => {
    const document = editableDocument();
    document.nodeChanges[2]!.parentIndex = {
      guid: { sessionID: 1, localID: 5 },
      position: "a",
    };
    document.nodeChanges.splice(2, 0, {
      guid: { sessionID: 1, localID: 5 },
      parentIndex: {
        guid: { sessionID: 1, localID: 2 },
        position: "a",
      },
      type: "SECTION",
      name: "Section",
    });

    const result = renderHtmlTemplates(document, {
      selection: new Set(["1:3"]),
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.frameName).toBe("Card");
  });

  it("imports multi-frame flows in left-to-right canvas order, not layer/creation order", async () => {
    const document = editableDocument();
    const frame = (
      localID: number,
      position: string,
      name: string,
      x: number,
    ) => ({
      guid: { sessionID: 1, localID },
      parentIndex: { guid: { sessionID: 1, localID: 2 }, position },
      type: "FRAME" as const,
      name,
      size: { x: 320, y: 200 },
      transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: 0 },
      fillPaints: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    });
    document.nodeChanges = [
      document.nodeChanges[0]!,
      document.nodeChanges[1]!,
      frame(10, "a", "Right", 800),
      frame(11, "b", "Middle", 400),
      frame(12, "c", "Left", 0),
    ];

    const result = await convertDecodedFigToEditableHtml(
      {
        format: "kiwi",
        document,
        images: [],
        thumbnail: null,
      },
      {
        originalName: "reordered-frames.fig",
        ownerEmail: "example@example.com",
        uploader: vi.fn(),
      },
    );

    expect(result.files.map((file) => file.preferredFrame?.title)).toEqual([
      "Left",
      "Middle",
      "Right",
    ]);
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
      "background-image: url('https://assets.example.com/figma-image.png')",
    );
    expect(result.files[0]!.content).not.toContain("&quot;");
    expect(result.files[0]!.content).not.toContain("iVBOR");
    expect(result.stats.uploadedImageCount).toBe(1);
  });

  it("rejects the whole import when storage is unavailable instead of omitting images", async () => {
    const uploader = vi.fn().mockResolvedValue(null);

    await expect(
      convertDecodedFigToEditableHtml(
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
          uploader,
        },
      ),
    ).rejects.toThrow(/file storage was unavailable or rejected the upload/i);
    expect(uploader).toHaveBeenCalledOnce();
  });

  it("stops later image batches and rejects when an upload is rejected", async () => {
    const cleanup = vi.fn().mockResolvedValue(true);
    const uploader = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue({
        url: "https://assets.example.com/image.png",
        cleanup,
      });
    const images = Array.from({ length: 5 }, (_, index) => ({
      hash: index === 0 ? "abc123" : `extra${index}`,
      ext: "png",
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, index]),
    }));

    await expect(
      convertDecodedFigToEditableHtml(
        {
          format: "kiwi",
          document: editableDocument("abc123"),
          images,
          thumbnail: null,
        },
        {
          originalName: "rejected-image.fig",
          ownerEmail: "example@example.com",
          uploader,
        },
      ),
    ).rejects.toThrow(/file storage was unavailable or rejected the upload/i);
    expect(uploader).toHaveBeenCalledTimes(4);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("reports when a provider cannot delete successful uploads from a failed batch", async () => {
    const cleanup = vi.fn().mockResolvedValue(false);
    const uploader = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValue({
        url: "https://assets.example.com/image.png",
        cleanup,
      });

    await expect(
      convertDecodedFigToEditableHtml(
        {
          format: "kiwi",
          document: editableDocument("abc123"),
          images: Array.from({ length: 2 }, (_, index) => ({
            hash: `cleanup${index}`,
            ext: "png",
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, index]),
          })),
          thumbnail: null,
        },
        {
          originalName: "failed-cleanup.fig",
          ownerEmail: "example@example.com",
          uploader,
        },
      ),
    ).rejects.toThrow(/storage cleanup failed for 1 uploaded image/i);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("deletes server uploads from a failed batch through the active provider", async () => {
    fileUploadMocks.uploadFile.mockReset();
    fileUploadMocks.deleteUploadedFile.mockReset();
    fileUploadMocks.uploadFile
      .mockResolvedValueOnce({
        url: "https://assets.example.com/first.png",
        provider: "s3",
        id: "uploads/first.png",
      })
      .mockRejectedValueOnce(new Error("provider unavailable"));
    fileUploadMocks.deleteUploadedFile.mockResolvedValue(true);

    await expect(
      convertDecodedFigToEditableHtml(
        {
          format: "kiwi",
          document: editableDocument("abc123"),
          images: ["abc123", "extra"].map((hash, index) => ({
            hash,
            ext: "png",
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, index]),
          })),
          thumbnail: null,
        },
        {
          originalName: "failed-server-batch.fig",
          ownerEmail: "example@example.com",
        },
      ),
    ).rejects.toThrow(/file storage was unavailable or rejected the upload/i);
    expect(fileUploadMocks.deleteUploadedFile).toHaveBeenCalledWith("s3", {
      url: "https://assets.example.com/first.png",
      id: "uploads/first.png",
    });
  });

  it("cleans uploaded images when HTML normalization fails", async () => {
    const cleanup = vi.fn().mockResolvedValue(true);
    const uploader = vi.fn().mockResolvedValue({
      url: "https://assets.example.com/image.png",
      cleanup,
    });

    await expect(
      convertShared(
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
          originalName: "normalize-failure.fig",
          ownerEmail: "example@example.com",
          uploader,
          normalizeHtml: () => {
            throw new Error("normalizer failed");
          },
        },
      ),
    ).rejects.toThrow("normalizer failed");
    expect(cleanup).toHaveBeenCalledOnce();
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
