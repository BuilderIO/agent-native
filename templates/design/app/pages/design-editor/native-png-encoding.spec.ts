import { crc32, inflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeStraightRgbaPng } from "./native-png-encoding";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function decode(blob: Blob) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 8 + length;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    expect(crc32(bytes.subarray(offset + 4, end))).toBe(
      bytes.readUInt32BE(end),
    );
    chunks.push({ type, data: bytes.subarray(offset + 8, end) });
    offset = end + 4;
    expect(offset).toBeLessThanOrEqual(bytes.length);
  }
  expect(chunks[0]?.type).toBe("IHDR");
  expect(chunks[1]).toEqual({ type: "sRGB", data: Buffer.from([0]) });
  expect(chunks[chunks.length - 1]).toEqual({
    type: "IEND",
    data: Buffer.alloc(0),
  });
  const header = chunks[0]!.data;
  expect([...header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)),
  );
  const stride = width * 4;
  expect(raw.length).toBe(height * (stride + 1));
  const rgba = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const offset = row * (stride + 1);
    expect(raw[offset]).toBe(0);
    raw.copy(rgba, row * stride, offset + 1, offset + 1 + stride);
  }
  return { width, height, rgba };
}

describe("straight RGBA PNG encoding", () => {
  it("preserves partial-alpha colors, hidden colors and every alpha byte exactly", async () => {
    const rgba = Uint8Array.from(
      Array.from({ length: 256 }, (_, alpha) => [
        187,
        187,
        alpha ^ 167,
        alpha,
      ]).flat(),
    );
    const original = rgba.slice();
    const blob = await encodeStraightRgbaPng(
      { width: 16, height: 16, rgba },
      new AbortController().signal,
    );
    expect(blob.type).toBe("image/png");
    const output = await decode(blob);
    expect(output.width).toBe(16);
    expect(output.height).toBe(16);
    expect([...output.rgba]).toEqual([...original]);
    expect(rgba).toEqual(original);
  });

  it("preserves row order across streaming batches for a non-square frame", async () => {
    const rgba = Uint8Array.from(
      Array.from({ length: 37 * 11 * 4 }, (_, index) => (index * 71) & 255),
    );
    const output = await decode(
      await encodeStraightRgbaPng(
        { width: 11, height: 37, rgba },
        new AbortController().signal,
      ),
    );
    expect([output.width, output.height]).toEqual([11, 37]);
    expect([...output.rgba]).toEqual([...rgba]);
  });

  it.each([
    [0, 1, 0],
    [1.5, 2, 12],
    [4097, 1, 0],
    [4096, 4096, 0],
    [2, 2, 15],
    [2, 2, 17],
  ])(
    "refuses invalid or excessive geometry %s×%s and byte length %s",
    async (width, height, length) => {
      await expect(
        encodeStraightRgbaPng(
          { width, height, rgba: new Uint8Array(length) },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "invalid-pixels" });
    },
  );

  it("rejects unavailable compression without substituting canvas encoding", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    await expect(
      encodeStraightRgbaPng(
        { width: 1, height: 1, rgba: new Uint8Array(4) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "compression-unavailable" });
  });

  it("preserves an already canceled operation's reason", async () => {
    const controller = new AbortController();
    const reason = new Error("Canceled original export");
    controller.abort(reason);
    await expect(
      encodeStraightRgbaPng(
        { width: 1, height: 1, rgba: new Uint8Array(4) },
        controller.signal,
      ),
    ).rejects.toBe(reason);
  });

  it("bounds a compressor that never closes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "CompressionStream",
      class extends TransformStream {
        constructor() {
          super({ flush: () => new Promise(() => {}) });
        }
      },
    );
    const pending = encodeStraightRgbaPng(
      { width: 1, height: 1, rgba: new Uint8Array(4) },
      new AbortController().signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({
      code: "encoding-timeout",
    });
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
  });

  it("cancels in-progress compression with the original reason", async () => {
    vi.stubGlobal(
      "CompressionStream",
      class extends TransformStream {
        constructor() {
          super({ flush: () => new Promise(() => {}) });
        }
      },
    );
    const controller = new AbortController();
    const reason = new Error("Canceled running export");
    const pending = encodeStraightRgbaPng(
      { width: 1, height: 1, rgba: new Uint8Array(4) },
      controller.signal,
    );
    const rejection = expect(pending).rejects.toBe(reason);
    await Promise.resolve();
    controller.abort(reason);
    await rejection;
  });

  it("rejects a single oversized compressed emission", async () => {
    vi.stubGlobal(
      "CompressionStream",
      class extends TransformStream {
        constructor() {
          super({
            transform(_bytes, controller) {
              controller.enqueue(new Uint8Array(40_000_000));
            },
          });
        }
      },
    );
    await expect(
      encodeStraightRgbaPng(
        { width: 1, height: 1, rgba: new Uint8Array(4) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "encoding-failed" });
  });

  it("rejects a final synchronous encode step that exceeds the deadline", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(10_001);
    try {
      await expect(
        encodeStraightRgbaPng(
          { width: 1, height: 1, rgba: new Uint8Array(4) },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "encoding-timeout" });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reports a failed compressor as a typed failure", async () => {
    vi.stubGlobal(
      "CompressionStream",
      class extends TransformStream {
        constructor() {
          super({
            transform() {
              throw new Error("Compressor fault");
            },
          });
        }
      },
    );
    await expect(
      encodeStraightRgbaPng(
        { width: 1, height: 1, rgba: new Uint8Array(4) },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "encoding-failed" });
  });
});
