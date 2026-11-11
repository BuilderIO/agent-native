import { expect, it, vi } from "vitest";

const openS3Recording = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("./s3-upload-provider.js", () => ({
  fetchS3ObjectByUrl: vi.fn(),
  openS3Recording,
}));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

import {
  loadRecordingMediaFile,
  type PublicAgentRecording,
} from "./public-agent-context.js";

it("opens a recording above the download limit with scoped bounded range reads", async () => {
  const size = 513 * 1024 * 1024;
  const ranges: string[] = [];
  openS3Recording.mockResolvedValue(async (range: string) => {
    ranges.push(range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) throw new Error("unbounded range");
    const start = Number(match[1]);
    const end = Number(match[2]);
    return new Response(Buffer.alloc(end - start + 1, 42), {
      status: 206,
      headers: {
        etag: '"stable"',
        "content-range": `bytes ${start}-${end}/${size}`,
      },
    });
  });
  const media = await loadRecordingMediaFile({
    id: "synthetic-recording",
    ownerEmail: "owner@example.test",
    storageMode: "own",
    videoUrl:
      "https://storage.example.test/clips/synthetic-recording/video.mp4",
    videoFormat: "mp4",
    videoSizeBytes: size,
  } as PublicAgentRecording);
  try {
    const response = await fetch(media.path, {
      headers: { Range: "bytes=0-15" },
    });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.alloc(16, 42),
    );
    expect(openS3Recording).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        recordingId: "synthetic-recording",
        storageMode: "own",
      }),
    );
    expect(ranges).toContain("bytes=0-15");
  } finally {
    await media.cleanup();
  }
});
