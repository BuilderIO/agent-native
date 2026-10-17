import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  queueBackgroundAiRequest: vi.fn(),
  withAiRequestStatusInstructions: vi.fn(
    ({ message }: { message: string }) => message,
  ),
  db: { select: vi.fn() },
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mocks.db,
  schema: {
    recordings: { id: "recordings.id" },
    recordingTranscripts: { recordingId: "recordingTranscripts.recordingId" },
  },
}));

vi.mock("./lib/ai-request-status.js", () => ({
  queueBackgroundAiRequest: mocks.queueBackgroundAiRequest,
  withAiRequestStatusInstructions: mocks.withAiRequestStatusInstructions,
}));

import removeFillerWords from "./remove-filler-words";

function returnRows(...rows: unknown[][]) {
  let index = 0;
  mocks.db.select.mockImplementation(() => {
    const result = rows[index++];
    return {
      from: () => ({
        where: () => ({
          limit: async () => result,
        }),
      }),
    };
  });
}

describe("remove-filler-words", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAccess.mockResolvedValue(undefined);
    mocks.queueBackgroundAiRequest.mockResolvedValue(undefined);
  });

  it("rejects embed-backed Loom before reading or queueing transcript work", async () => {
    returnRows([
      {
        kind: "video",
        sourceAppName: "Loom",
        videoUrl: "https://www.loom.com/embed/abcdefgh",
      },
    ]);

    await expect(
      removeFillerWords.run({ recordingId: "rec_1" }),
    ).rejects.toMatchObject({
      errorCode: "native_media_required",
      statusCode: 422,
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(1);
    expect(mocks.queueBackgroundAiRequest).not.toHaveBeenCalled();
  });

  it("queues the request for a Clips-hosted video with a ready transcript", async () => {
    returnRows(
      [{ kind: "video", videoUrl: "https://store.example/clip.webm" }],
      [{ status: "ready", segmentsJson: "[]" }],
    );

    await expect(
      removeFillerWords.run({ recordingId: "rec_1" }),
    ).resolves.toMatchObject({ queued: true, recordingId: "rec_1" });
    expect(mocks.queueBackgroundAiRequest).toHaveBeenCalledTimes(1);
  });
});
