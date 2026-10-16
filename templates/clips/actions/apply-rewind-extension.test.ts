import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
  isBound: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));
vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  sql: (...args: unknown[]) => args,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => mocks.selectRows.shift() ?? [],
      }),
    }),
    transaction: (...args: unknown[]) => mocks.transaction(...args),
  }),
  schema: {
    recordings: { id: "recordings.id", visibility: "recordings.visibility" },
    recordingTranscripts: { recordingId: "transcripts.recordingId" },
    recordingComments: { recordingId: "comments.recordingId" },
    recordingReactions: { recordingId: "reactions.recordingId" },
  },
}));
vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(),
}));
vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  ownerEmailMatches: (...args: unknown[]) => args,
}));
vi.mock("../server/lib/s3-upload-provider.js", () => ({
  isS3ObjectUrlBoundToRecording: (...args: unknown[]) => mocks.isBound(...args),
}));
vi.mock("./make-recording-private-for-rewind.js", () => ({
  assertNoDirectRecordingShares: vi.fn(),
}));

import action from "./apply-rewind-extension.js";

const request = {
  requestId: "request-1",
  recordingId: "recording-1",
  preRollRecordingId: "pre-roll-1",
  seconds: 30,
  status: "ready",
  requestedAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

function recording(id: string, storageMode: "own" | "hosted" | null) {
  return {
    id,
    visibility: "private",
    storageMode,
    durationMs: 10_000,
    editsJson: "{}",
    chaptersJson: "[]",
  };
}

async function run() {
  return action.run({
    recordingId: "recording-1",
    requestId: "request-1",
    preRollRecordingId: "pre-roll-1",
    videoUrl: "https://storage.example/clips/victim-1/clip.mp4",
    durationMs: 40_000,
    addedMs: 30_000,
  });
}

describe("apply-rewind-extension hosted media binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows = [
      [recording("recording-1", "hosted")],
      [recording("pre-roll-1", null)],
      [],
    ];
    mocks.readAppState.mockResolvedValue(request);
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.isBound.mockResolvedValue(false);
  });

  it.each([false, null])(
    "rejects a hosted URL with a different recording binding (%s)",
    async (binding) => {
      mocks.isBound.mockResolvedValue(binding);

      await expect(run()).rejects.toThrow(
        "The Rewind upload is not bound to its recording.",
      );

      expect(mocks.isBound).toHaveBeenCalledWith(
        "https://storage.example/clips/victim-1/clip.mp4",
        "recording-1",
        { storageMode: "hosted" },
      );
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.writeAppState).not.toHaveBeenCalled();
    },
  );
});
