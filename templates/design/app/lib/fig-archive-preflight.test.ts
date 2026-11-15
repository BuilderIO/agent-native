import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { BROWSER_FIG_LIMITS } from "../../server/lib/fig-file-limits.js";
import { preflightFigArchive } from "./fig-archive-preflight";

const MB = 1024 * 1024;

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

/** A Zstandard frame header that declares `contentSize` decompressed bytes. */
function zstdChunk(contentSize: number): Uint8Array {
  const header = new Uint8Array(4 + 1 + 8 + 4);
  header.set([0x28, 0xb5, 0x2f, 0xfd], 0);
  header[4] = 0xe0; // single segment, 8-byte content size
  new DataView(header.buffer).setBigUint64(5, BigInt(contentSize), true);
  return header;
}

function kiwi(...chunks: Uint8Array[]): Uint8Array {
  const parts = [new TextEncoder().encode("fig-kiwi"), u32(48)];
  for (const chunk of chunks) parts.push(u32(chunk.length), chunk);
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const schema = new Uint8Array([1, 2, 3, 4]);

function figZip(
  canvas: Uint8Array,
  images: Record<string, Uint8Array> = {},
): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {
    "canvas.fig": [canvas, { level: 0 }],
  };
  for (const [name, bytes] of Object.entries(images)) {
    entries[`images/${name}`] = [bytes, { level: 0 }];
  }
  return zipSync(entries);
}

function asFile(bytes: Uint8Array): File {
  return new File([new Uint8Array(bytes)], "Design.fig");
}

describe("preflightFigArchive", () => {
  it("accepts a file within every browser limit", async () => {
    const file = asFile(
      figZip(kiwi(schema, zstdChunk(40 * MB)), {
        a: new Uint8Array(1024),
      }),
    );

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "fits",
    });
  });

  it("refuses a document that unpacks past the per-chunk limit", async () => {
    const file = asFile(figZip(kiwi(schema, zstdChunk(600 * MB))));

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "too-large",
      limit: "inflatedChunkBytes",
    });
  });

  it("refuses chunks that together unpack past the total limit", async () => {
    const file = asFile(
      figZip(kiwi(schema, zstdChunk(400 * MB), zstdChunk(400 * MB))),
    );

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "too-large",
      limit: "inflatedBytes",
    });
  });

  it("refuses embedded images over the image budget", async () => {
    const file = asFile(
      figZip(kiwi(schema, zstdChunk(MB)), { a: new Uint8Array(2048) }),
    );

    await expect(
      preflightFigArchive(file, { ...BROWSER_FIG_LIMITS, imageBytes: 1024 }),
    ).resolves.toEqual({ status: "too-large", limit: "imageBytes" });
  });

  it("refuses a zip with more entries than the decoder reads", async () => {
    const file = asFile(
      figZip(kiwi(schema, zstdChunk(MB)), {
        a: new Uint8Array(1),
        b: new Uint8Array(1),
      }),
    );

    await expect(
      preflightFigArchive(file, { ...BROWSER_FIG_LIMITS, zipEntries: 2 }),
    ).resolves.toEqual({ status: "too-large", limit: "zipEntries" });
  });

  it("refuses a file over the raw size limit without reading it", async () => {
    const file = asFile(new Uint8Array(16));
    Object.defineProperty(file, "size", { value: 3 * 1024 * MB });

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "too-large",
      limit: "fileBytes",
    });
  });

  it("checks a bare fig-kiwi file the same way", async () => {
    const file = asFile(kiwi(schema, zstdChunk(600 * MB)));

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "too-large",
      limit: "inflatedChunkBytes",
    });
  });

  it("reads only headers, not the stored image bytes", async () => {
    const file = asFile(
      figZip(kiwi(schema, zstdChunk(600 * MB)), {
        a: new Uint8Array(8 * MB),
      }),
    );
    let bytesRead = 0;
    const slice = file.slice.bind(file);
    file.slice = (start?: number, end?: number) => {
      bytesRead += (end ?? file.size) - (start ?? 0);
      return slice(start, end);
    };

    await expect(preflightFigArchive(file)).resolves.toMatchObject({
      status: "too-large",
    });
    expect(bytesRead).toBeLessThan(128 * 1024);
  });

  it("refuses a kiwi file with more chunks than the decoder reads instead of scanning part of it", async () => {
    const chunks = Array.from({ length: 4_097 }, () => new Uint8Array(1));
    const file = asFile(kiwi(...chunks));

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "unreadable",
      reason: ".fig file has too many binary chunks.",
    });
  });

  it("never allocates the directory size an archive declares", async () => {
    const bytes = figZip(kiwi(schema, zstdChunk(MB)), {
      a: new Uint8Array(MB),
    });
    const view = new DataView(bytes.buffer);
    const eocd = bytes.length - 22;
    // Claims everything before the end record is directory.
    view.setUint32(eocd + 12, eocd, true);
    view.setUint32(eocd + 16, 0, true);
    const file = asFile(bytes);
    let largestRead = 0;
    const slice = file.slice.bind(file);
    file.slice = (start?: number, end?: number) => {
      largestRead = Math.max(largestRead, (end ?? file.size) - (start ?? 0));
      return slice(start, end);
    };

    await expect(preflightFigArchive(file)).resolves.toMatchObject({
      status: "unreadable",
    });
    expect(largestRead).toBeLessThanOrEqual(128 * 1024);
  });

  it("reports a zip without canvas.fig as unreadable", async () => {
    const file = asFile(
      zipSync({ "images/a": [new Uint8Array(4), { level: 0 }] }),
    );

    await expect(preflightFigArchive(file)).resolves.toEqual({
      status: "unreadable",
      reason: ".fig zip is missing canvas.fig.",
    });
  });

  it("reports a kiwi file without a document chunk as unreadable", async () => {
    await expect(preflightFigArchive(asFile(kiwi(schema)))).resolves.toEqual({
      status: "unreadable",
      reason: ".fig file is missing its document chunk.",
    });
  });

  it("reports a file it cannot parse as unreadable, not as fitting", async () => {
    await expect(
      preflightFigArchive(asFile(new TextEncoder().encode("not a fig file"))),
    ).resolves.toMatchObject({ status: "unreadable" });
  });
});
