import { deflateSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  getDb: vi.fn(),
  assertAccess: vi.fn(),
  getRequestUserEmail: vi.fn(),
  resolveStorage: vi.fn(),
  storeBytes: vi.fn(),
  discardPrivateBlobs: vi.fn(),
  verificationMismatch: false,
  selectCount: 0,
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
  fail: (message: string, options: Record<string, unknown> = {}) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return { ...actual, assertAccess: mocks.assertAccess };
});
vi.mock("../server/db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/db/index.js")>();
  return { ...actual, getDb: mocks.getDb };
});
vi.mock("../server/lib/replay-screenshot-blobs.js", () => ({
  discardPrivateBlobs: mocks.discardPrivateBlobs,
  resolveReplayScreenshotStorage: mocks.resolveStorage,
  storeReplayScreenshotBytesAsPrivateBlob: mocks.storeBytes,
}));

import action from "./stage-journey-canvas-frames.js";

const crc32 = (data: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (name: string, body: Buffer) => {
  const type = Buffer.from(name, "ascii");
  const chunk = Buffer.alloc(body.length + 12);
  chunk.writeUInt32BE(body.length, 0);
  type.copy(chunk, 4);
  body.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, body])), body.length + 8);
  return chunk;
};

const png = (width: number, height: number, pixelValue = 0) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    const start = row * (width * 4 + 1);
    rows[start] = 0;
    rows[start + 1] = pixelValue;
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

function input(image = png(4, 3)) {
  return {
    designId: "design-1",
    importId: "import-1",
    allowEncryptedPublicUploadFallback: true,
    frames: [
      {
        frameKey: "node-1\u00000",
        replayId: "replay-1",
        app: "slides",
        route: "/home",
        offsetMs: 1200,
        width: 4,
        height: 3,
        capturedAt: "2026-10-08T12:00:00.000Z",
        pngBase64: image.toString("base64"),
      },
    ],
  };
}

const run = action.run as (
  value: unknown,
  context?: unknown,
) => Promise<unknown>;

describe("stage-journey-canvas-frames", () => {
  beforeEach(() => {
    mocks.row = null;
    mocks.getRequestUserEmail.mockReset().mockReturnValue("actor@example.test");
    mocks.assertAccess.mockReset().mockResolvedValue({
      resource: {
        ownerEmail: "owner@example.test",
        visibility: "private",
        orgId: null,
      },
    });
    mocks.resolveStorage.mockReset().mockResolvedValue({
      kind: "encrypted-public-upload",
    });
    mocks.storeBytes.mockReset().mockImplementation(async ({ data }) => ({
      blobHandle: {
        id: "private-blob-1",
        provider: "private-provider-1",
        opaque: true,
        encrypted: false,
      },
      mimeType: "image/png",
      sizeBytes: data.byteLength,
    }));
    mocks.discardPrivateBlobs.mockReset().mockResolvedValue(undefined);
    mocks.verificationMismatch = false;
    mocks.selectCount = 0;
    mocks.getDb.mockReset().mockReturnValue({
      select: vi.fn(() => {
        const builder = {
          from: vi.fn(() => builder),
          where: vi.fn(() => builder),
          limit: vi.fn(async () => {
            mocks.selectCount += 1;
            if (!mocks.row) return [];
            if (mocks.verificationMismatch && mocks.selectCount === 2) {
              return [{ ...mocks.row, app: "different-frame" }];
            }
            return [mocks.row];
          }),
        };
        return builder;
      }),
      insert: vi.fn(() => ({
        values: vi.fn((row: Record<string, unknown>) => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (mocks.row) return [];
              mocks.row = row;
              return [{ id: row.id }];
            }),
          })),
        })),
      })),
    });
  });

  it("stores native PNGs under Design ownership and keeps raw frame keys out of SQL", async () => {
    const result = (await run(input())) as {
      designId: string;
      importId: string;
      stagedFrames: Array<{ frameKey: string; stagedFrameId: string }>;
    };

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design-1",
      "editor",
    );
    expect(mocks.resolveStorage).toHaveBeenCalledWith(true);
    expect(mocks.storeBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        blobOwnerEmail: "owner@example.test",
        designId: "design-1",
        replayId: "replay-1",
      }),
    );
    expect(result.stagedFrames[0]?.stagedFrameId).toMatch(/^jcu_/);
    expect(result.stagedFrames[0]?.frameKey).toBe("node-1\u00000");
    expect(mocks.row?.route).toBe("/home");
    expect(mocks.row?.blobHandle).toContain("private-blob-1");
    expect(JSON.stringify(mocks.row)).not.toContain("node-1");
  });

  it("returns the same staged id without another blob write on an identical retry", async () => {
    const first = (await run(input())) as {
      stagedFrames: Array<{ stagedFrameId: string }>;
    };
    const second = (await run(input())) as {
      stagedFrames: Array<{ stagedFrameId: string }>;
    };

    expect(second.stagedFrames[0]?.stagedFrameId).toBe(
      first.stagedFrames[0]?.stagedFrameId,
    );
    expect(mocks.storeBytes).toHaveBeenCalledTimes(1);
    expect(mocks.resolveStorage).toHaveBeenCalledTimes(1);
  });

  it("keeps a blob when post-insert verification cannot confirm its committed row", async () => {
    mocks.verificationMismatch = true;

    await expect(run(input())).rejects.toMatchObject({
      errorCode: "journey_frame_stage_verification_failed",
      statusCode: 503,
    });
    expect(mocks.discardPrivateBlobs).not.toHaveBeenCalled();
  });

  it("rejects reuse of an import key for changed PNG data", async () => {
    await run(input());
    const changedData = png(4, 3, 1);

    await expect(run(input(changedData))).rejects.toMatchObject({
      errorCode: "journey_frame_idempotency_conflict",
      statusCode: 409,
    });
    expect(mocks.storeBytes).toHaveBeenCalledTimes(1);
  });

  it("rejects PNG metadata that disagrees with the native IHDR dimensions", async () => {
    await expect(
      run({
        ...input(),
        frames: [{ ...input().frames[0]!, width: 5 }],
      }),
    ).rejects.toMatchObject({
      errorCode: "journey_frame_dimensions_mismatch",
      statusCode: 400,
    });
    expect(mocks.storeBytes).not.toHaveBeenCalled();
  });

  it("rejects a truncated PNG even when its header dimensions are present", async () => {
    const truncated = Buffer.alloc(24);
    truncated.set(Buffer.from("89504e470d0a1a0a", "hex"), 0);
    truncated.writeUInt32BE(13, 8);
    truncated.write("IHDR", 12, "ascii");
    truncated.writeUInt32BE(4, 16);
    truncated.writeUInt32BE(3, 20);

    await expect(run(input(truncated))).rejects.toMatchObject({
      errorCode: "journey_frame_invalid_png",
      statusCode: 400,
    });
    expect(mocks.storeBytes).not.toHaveBeenCalled();
  });

  it("rejects an oversized image batch with an actionable typed error", async () => {
    const oversized = {
      ...input(Buffer.alloc(24, 1)),
      frames: Array.from({ length: 8 }, (_, index) => ({
        ...input(Buffer.alloc(24, 1)).frames[0]!,
        frameKey: `node-${index}\u00000`,
        pngBase64: "A".repeat(615_000),
      })),
    };

    await expect(run(oversized)).rejects.toMatchObject({
      errorCode: "journey_stage_batch_too_large",
      statusCode: 413,
    });
  });

  it("returns a distinct typed error when one frame cannot fit a request", async () => {
    await expect(
      run({
        ...input(),
        frames: [
          {
            ...input().frames[0]!,
            pngBase64: "A".repeat(4_800_001),
          },
        ],
      }),
    ).rejects.toMatchObject({
      errorCode: "journey_frame_payload_too_large",
      statusCode: 413,
    });
  });
});
