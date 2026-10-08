import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUploadFile = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn((...args: unknown[]) => args));
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());
const mockUploadedAssets = vi.hoisted(() => ({
  id: "uploaded_assets.id",
  filename: "uploaded_assets.filename",
  url: "uploaded_assets.url",
  type: "uploaded_assets.type",
  size: "uploaded_assets.size",
  provider: "uploaded_assets.provider",
  uploadSessionId: "uploaded_assets.upload_session_id",
  ownerEmail: "uploaded_assets.owner_email",
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mockUploadFile,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => mockGetRequestOrgId(),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...args: unknown[]) => args,
  desc: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => mockEq(...args),
  notLike: (...args: unknown[]) => args,
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    insert: () => ({ values: mockValues }),
    select: () => ({
      from: () => ({ where: () => ({ limit: mockSelectLimit }) }),
    }),
  }),
  schema: { uploadedAssets: mockUploadedAssets },
}));

import {
  canSaveAsUploadedAsset,
  canSaveAsUploadedVideoAsset,
  uploadImageAsset,
  uploadVideoAsset,
} from "./assets";
import { uploadedAssetUrlForBasePath } from "./assets-url";

beforeEach(() => {
  mockUploadFile.mockReset();
  mockUploadFile.mockResolvedValue({
    provider: "builder",
    url: "https://cdn.builder.io/logo.svg",
  });
  mockValues.mockReset();
  mockValues.mockResolvedValue(undefined);
  mockSelectLimit.mockReset();
  mockSelectLimit.mockResolvedValue([]);
  mockEq.mockClear();
  mockGetRequestOrgId.mockReset();
  mockGetRequestOrgId.mockReturnValue(undefined);
  mockRunWithRequestContext.mockReset();
  mockRunWithRequestContext.mockImplementation(
    async (_context: unknown, callback: () => unknown) => callback(),
  );
});

describe("uploadedAssetUrl", () => {
  it("returns root-relative upload URLs without a configured base path", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "")).toBe(
      "/uploads/logo.png",
    );
  });

  it("prefixes upload URLs with APP_BASE_PATH", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "/slides/")).toBe(
      "/slides/uploads/logo.png",
    );
  });
});

describe("uploaded asset validation", () => {
  it("allows SVG assets", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "logo.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedAsset({
        originalName: "preamble.svg",
        data: Buffer.from(
          '<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg" />',
        ),
      }),
    ).toBe(true);
  });

  it("strips the standard SVG 1.1 doctype before uploading Excalidraw SVGs", async () => {
    const svg = Buffer.from(
      '<?xml version="1.0" standalone="no"?>\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
        '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
        '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 20"><path d="M0 0h38" /></svg>',
    );
    const strippedSvg = new TextEncoder().encode(
      svg
        .toString("utf8")
        .replace(
          /<!DOCTYPE svg PUBLIC "-\/\/W3C\/\/DTD SVG 1\.1\/\/EN" "http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd">/,
          "",
        ),
    );

    expect(
      canSaveAsUploadedAsset({ originalName: "arrow.svg", data: svg }),
    ).toBe(true);
    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "arrow.svg",
        data: svg,
        type: "image/svg+xml",
      }),
    ).resolves.toMatchObject({
      type: "image/svg+xml",
      size: strippedSvg.length,
    });
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: strippedSvg, filename: "arrow.svg" }),
    );
  });

  it("allows parameterized safe raster data URLs inside SVG assets", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "logo.svg",
        data: Buffer.from(
          '<svg><image href="data:image/png;charset=binary;base64,AQID" /></svg>',
        ),
      }),
    ).toBe(true);
  });

  it("rejects SVGs with active content or external references", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "script.svg",
        data: Buffer.from('<svg onload="alert(1)" />'),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "remote.svg",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "unquoted-remote.svg",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href=https://example.com/x.png /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "namespaced-script.svg",
        data: Buffer.from(
          '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "encoded-css.svg",
        data: Buffer.from(
          "<svg><style>&#64;import&#32;url&#40;https://example.com/style.css&#41;;</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "escaped-css.svg",
        data: Buffer.from(
          "<svg><style>u\\72l(https://example.com/style.css){}</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "escaped-newline-css.svg",
        data: Buffer.from(
          "<svg><style>url(https://example.com/font\\" +
            "\n.woff2)</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "image-set-css.svg",
        data: Buffer.from(
          '<svg><style>rect{fill:image-set("https://example.com/pixel" 1x)}</style><rect /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "image-css.svg",
        data: Buffer.from(
          '<svg><style>rect{fill:image("https://example.com/pixel")}</style><rect /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "animate-transform.svg",
        data: Buffer.from(
          '<svg><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "commented-css.svg",
        data: Buffer.from(
          '<svg><style>@im/**/port "https://example.com/style.css";</style></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "xml-base.svg",
        data: Buffer.from(
          '<svg xml:base="https://example.com/"><use href="#icon" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "external-entity.svg",
        data: Buffer.from(
          '<!DOCTYPE svg [<!ENTITY remote SYSTEM "https://example.com/evil">]>' +
            "<svg>&remote;</svg>",
        ),
      }),
    ).toBe(false);
  });

  it("normalizes SVG MIME before sending it to the upload provider", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "logo.svg",
        data: svg,
        type: "application/octet-stream",
      }),
    ).resolves.toMatchObject({ type: "image/svg+xml" });

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: svg,
        filename: "logo.svg",
        mimeType: "image/svg+xml",
        ownerEmail: "owner@example.com",
      }),
    );
  });

  it("keeps the active organization while creating the public asset", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');
    mockGetRequestOrgId.mockReturnValue("active-org");

    await uploadImageAsset({
      email: "owner@example.com",
      originalName: "logo.svg",
      data: svg,
      type: "image/svg+xml",
    });

    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "active-org" },
      expect.any(Function),
    );
  });
});

function uint32Bytes(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function isoBox(type: string, payload: Uint8Array): Buffer {
  return Buffer.concat([
    uint32Bytes(payload.length + 8),
    Buffer.from(type),
    payload,
  ]);
}

function makeAvcSampleDescription(includeConfiguration = true): Buffer {
  const configuration = isoBox(
    "avcC",
    Buffer.from([
      1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 5, 0x67, 0x42, 0, 0x1e, 0x80, 1, 0, 2,
      0x68, 0xc0,
    ]),
  );
  return isoBox(
    "avc1",
    Buffer.concat([
      Buffer.alloc(78),
      ...(includeConfiguration ? [configuration] : []),
    ]),
  );
}

function makeMp4Video(
  options: {
    hasSample?: boolean;
    sampleOffset?: number;
    includeAvcConfiguration?: boolean;
  } = {},
): Buffer {
  const hasSample = options.hasSample ?? true;
  const ftyp = isoBox(
    "ftyp",
    Buffer.concat([Buffer.from("isom"), uint32Bytes(0), Buffer.from("isom")]),
  );
  const mediaData = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  const mdat = isoBox("mdat", mediaData);
  const sampleOffset = options.sampleOffset ?? ftyp.length + 8;
  const sampleCount = hasSample ? 1 : 0;
  const tableEntries = hasSample ? 1 : 0;
  const sampleDescription = makeAvcSampleDescription(
    options.includeAvcConfiguration,
  );
  const stbl = isoBox(
    "stbl",
    Buffer.concat([
      isoBox(
        "stsd",
        Buffer.concat([Buffer.alloc(4), uint32Bytes(1), sampleDescription]),
      ),
      isoBox(
        "stts",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(tableEntries),
          ...(hasSample ? [uint32Bytes(1), uint32Bytes(1000)] : []),
        ]),
      ),
      isoBox(
        "stsc",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(tableEntries),
          ...(hasSample
            ? [uint32Bytes(1), uint32Bytes(1), uint32Bytes(1)]
            : []),
        ]),
      ),
      isoBox(
        "stsz",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(hasSample ? mediaData.length : 0),
          uint32Bytes(sampleCount),
        ]),
      ),
      isoBox(
        "stco",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(tableEntries),
          ...(hasSample ? [uint32Bytes(sampleOffset)] : []),
        ]),
      ),
    ]),
  );
  const track = isoBox(
    "trak",
    Buffer.concat([
      isoBox("tkhd", Buffer.alloc(84)),
      isoBox(
        "mdia",
        Buffer.concat([
          isoBox("mdhd", Buffer.alloc(24)),
          isoBox(
            "hdlr",
            Buffer.concat([
              Buffer.alloc(8),
              Buffer.from("vide"),
              Buffer.alloc(12),
            ]),
          ),
          isoBox("minf", stbl),
        ]),
      ),
    ]),
  );
  const moov = isoBox(
    "moov",
    Buffer.concat([isoBox("mvhd", Buffer.alloc(100)), track]),
  );
  return Buffer.concat([ftyp, mdat, moov]);
}

function makeFragmentedMp4Video(
  options: {
    dataOffset?: number;
    tfhdTrackId?: number;
    defaultSampleSize?: number;
    includeAvcConfiguration?: boolean;
  } = {},
): Buffer {
  const ftyp = isoBox(
    "ftyp",
    Buffer.concat([Buffer.from("isom"), uint32Bytes(0), Buffer.from("isom")]),
  );
  const trackHeader = Buffer.alloc(84);
  trackHeader.writeUInt32BE(1, 12);
  const sampleDescription = makeAvcSampleDescription(
    options.includeAvcConfiguration,
  );
  const sampleTable = isoBox(
    "stbl",
    Buffer.concat([
      isoBox(
        "stsd",
        Buffer.concat([Buffer.alloc(4), uint32Bytes(1), sampleDescription]),
      ),
      isoBox("stts", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
      isoBox("stsc", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
      isoBox(
        "stsz",
        Buffer.concat([Buffer.alloc(4), uint32Bytes(0), uint32Bytes(0)]),
      ),
      isoBox("stco", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
    ]),
  );
  const track = isoBox(
    "trak",
    Buffer.concat([
      isoBox("tkhd", trackHeader),
      isoBox(
        "mdia",
        Buffer.concat([
          isoBox("mdhd", Buffer.alloc(24)),
          isoBox(
            "hdlr",
            Buffer.concat([
              Buffer.alloc(8),
              Buffer.from("vide"),
              Buffer.alloc(12),
            ]),
          ),
          isoBox("minf", sampleTable),
        ]),
      ),
    ]),
  );
  const movieExtends = isoBox(
    "mvex",
    isoBox(
      "trex",
      Buffer.concat([
        Buffer.alloc(4),
        uint32Bytes(1),
        uint32Bytes(1),
        uint32Bytes(1000),
        uint32Bytes(options.defaultSampleSize ?? 4),
        uint32Bytes(0),
      ]),
    ),
  );
  const moov = isoBox(
    "moov",
    Buffer.concat([isoBox("mvhd", Buffer.alloc(100)), track, movieExtends]),
  );
  const makeMoof = (dataOffset: number) =>
    isoBox(
      "moof",
      Buffer.concat([
        isoBox("mfhd", Buffer.concat([Buffer.alloc(4), uint32Bytes(1)])),
        isoBox(
          "traf",
          Buffer.concat([
            isoBox(
              "tfhd",
              Buffer.concat([
                Buffer.from([0x00, 0x02, 0x00, 0x00]),
                uint32Bytes(options.tfhdTrackId ?? 1),
              ]),
            ),
            isoBox("tfdt", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
            isoBox(
              "trun",
              Buffer.concat([
                Buffer.from([0x00, 0x00, 0x00, 0x01]),
                uint32Bytes(1),
                uint32Bytes(dataOffset),
              ]),
            ),
          ]),
        ),
      ]),
    );
  const initialMoof = makeMoof(0);
  const dataOffset = options.dataOffset ?? initialMoof.length + 8;
  const moof = makeMoof(dataOffset);
  const mdat = isoBox("mdat", Buffer.from([0, 0, 0, 1]));
  return Buffer.concat([ftyp, moov, moof, mdat]);
}

function ebmlId(id: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(id);
  let first = 0;
  while (first < 3 && bytes[first] === 0) first++;
  return bytes.subarray(first);
}

function ebmlSize(size: number): Buffer {
  if (size < 0x7f) return Buffer.from([0x80 | size]);
  if (size < 0x3fff) {
    return Buffer.from([0x40 | (size >> 8), size & 0xff]);
  }
  throw new Error("Test EBML element is too large");
}

function ebmlElement(
  id: number,
  payload: Uint8Array,
  unknownSize = false,
): Buffer {
  return Buffer.concat([
    ebmlId(id),
    unknownSize ? Buffer.from([0xff]) : ebmlSize(payload.length),
    payload,
  ]);
}

function ebmlInteger(id: number, value: number, width = 1): Buffer {
  const payload = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index--) {
    payload[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return ebmlElement(id, payload);
}

function makeWebmVideo(
  options: {
    unknownSegmentSize?: boolean;
    unknownClusterSize?: boolean;
    duplicateInfoAfterCluster?: boolean;
    nestedInfoInBlockGroup?: boolean;
    segmentSiblingTagsAfterCluster?: boolean;
  } = {},
): Buffer {
  const info = ebmlElement(
    0x1549a966,
    Buffer.concat([
      ebmlInteger(0x2ad7b1, 1_000_000, 3),
      ebmlElement(0x4d80, Buffer.from("Slides test")),
      ebmlElement(0x5741, Buffer.from("Slides test")),
    ]),
  );
  const video = ebmlElement(
    0xe0,
    Buffer.concat([ebmlInteger(0xb0, 16), ebmlInteger(0xba, 16)]),
  );
  const track = ebmlElement(
    0xae,
    Buffer.concat([
      ebmlInteger(0xd7, 1),
      ebmlInteger(0x73c5, 1),
      ebmlInteger(0x83, 1),
      ebmlElement(0x86, Buffer.from("V_VP8")),
      video,
    ]),
  );
  const tracks = ebmlElement(0x1654ae6b, track);
  const block = Buffer.from([0x81, 0x00, 0x00, 0x80, 0x01]);
  const cluster = ebmlElement(
    0x1f43b675,
    Buffer.concat([
      ebmlInteger(0xe7, 0),
      options.nestedInfoInBlockGroup
        ? ebmlElement(0xa0, Buffer.concat([ebmlElement(0xa1, block), info]))
        : ebmlElement(0xa3, block),
    ]),
    options.unknownClusterSize,
  );
  const tags = ebmlElement(
    0x1254c367,
    ebmlElement(
      0x7373,
      ebmlElement(
        0x67c8,
        Buffer.concat([
          ebmlElement(0x45a3, Buffer.from("Slides")),
          ebmlElement(0x4487, Buffer.from("Video")),
        ]),
      ),
    ),
  );
  const segment = ebmlElement(
    0x18538067,
    Buffer.concat([
      info,
      tracks,
      cluster,
      ...(options.segmentSiblingTagsAfterCluster ? [tags] : []),
      ...(options.duplicateInfoAfterCluster ? [info] : []),
    ]),
    options.unknownSegmentSize,
  );
  const header = ebmlElement(
    0x1a45dfa3,
    Buffer.concat([
      ebmlInteger(0x4286, 1),
      ebmlInteger(0x42f7, 1),
      ebmlInteger(0x42f2, 4),
      ebmlInteger(0x42f3, 8),
      ebmlElement(0x4282, Buffer.from("webm")),
      ebmlInteger(0x4287, 2),
      ebmlInteger(0x4285, 2),
    ]),
  );
  return Buffer.concat([header, segment]);
}

describe("uploaded video validation", () => {
  const mp4 = makeMp4Video();
  const fragmentedMp4 = makeFragmentedMp4Video();
  const webm = makeWebmVideo();

  it("accepts structurally complete containers and rejects mismatched extensions", () => {
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.mp4", data: mp4 }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.webm", data: webm }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: fragmentedMp4,
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
        }),
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.mp4", data: webm }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.mov", data: mp4 }),
    ).toBe(false);
  });

  it("requires MP4 sample data ranges and AVC sample descriptions", () => {
    const malformedMp4 = Buffer.from(mp4);
    malformedMp4[3] = 0xff;

    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeMp4Video({ hasSample: false }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeMp4Video({ sampleOffset: mp4.length }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: malformedMp4,
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeMp4Video({ includeAvcConfiguration: false }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ dataOffset: 0 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ tfhdTrackId: 2 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ defaultSampleSize: 0 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ defaultSampleSize: 5 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ includeAvcConfiguration: false }),
      }),
    ).toBe(false);
  });

  it("rejects truncated containers and unknown-size clusters that swallow siblings", () => {
    const signatureOnlyMp4 = Buffer.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0,
    ]);
    const signatureOnlyWebm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: signatureOnlyMp4,
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: signatureOnlyWebm,
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: mp4.subarray(0, 100),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: webm.subarray(0, 100),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
          duplicateInfoAfterCluster: true,
        }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
          nestedInfoInBlockGroup: true,
        }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
          segmentSiblingTagsAfterCluster: true,
        }),
      }),
    ).toBe(true);
  });

  it("stores video files in the configured object storage with the active org", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "uploads/provider-object-1.mp4",
      url: "https://cdn.example.com/clip.mp4",
    });

    const uploaded = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
    });
    expect(uploaded).toMatchObject({
      filename: "clip.mp4",
      type: "video/mp4",
      size: mp4.length,
      url: "https://cdn.example.com/clip.mp4",
    });
    expect(uploaded.id).not.toBe("uploads/provider-object-1.mp4");
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: uploaded.id,
        providerObjectId: "uploads/provider-object-1.mp4",
      }),
    );

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: mp4,
        filename: "clip.mp4",
        mimeType: "video/mp4",
        ownerEmail: "owner@example.com",
      }),
    );
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "active-org" },
      expect.any(Function),
    );
  });

  it("returns the existing uploaded video for a completed upload session", async () => {
    const completed = {
      id: "video-asset-1",
      filename: "clip.mp4",
      url: "https://cdn.example.com/clip.mp4",
      type: "video/mp4",
      size: 4,
      provider: "s3",
    };
    mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([completed]);
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "uploads/provider-object-1.mp4",
      url: completed.url,
    });

    const first = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
      uploadSessionId: "session-1",
    });
    const replay = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
      uploadSessionId: "session-1",
    });

    expect(replay).toEqual(completed);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: first.id,
        ownerEmail: "owner@example.com",
        uploadSessionId: "session-1",
      }),
    );
  });

  it("scopes completed upload lookup to the authenticated owner", async () => {
    mockSelectLimit.mockResolvedValueOnce([]);

    await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
      uploadSessionId: "session-1",
    });

    expect(mockSelectLimit).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith(
      mockUploadedAssets.ownerEmail,
      "owner@example.com",
    );
    expect(mockEq).toHaveBeenCalledWith(
      mockUploadedAssets.uploadSessionId,
      "session-1",
    );
  });
});
